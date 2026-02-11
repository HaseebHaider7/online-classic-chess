const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      chess: new Chess(),
      players: { w: null, b: null },
      names: { w: 'Waiting...', b: 'Waiting...' },
      spectators: new Set()
    });
  }
  return rooms.get(roomId);
}

function roomChannel(id) {
  return `room:${id}`;
}

function statusFrom(chess) {
  if (!chess.isGameOver()) return `${chess.turn() === 'w' ? 'White' : 'Black'} to move`;
  if (chess.isCheckmate()) return `Checkmate. ${chess.turn() === 'w' ? 'Black' : 'White'} wins.`;
  if (chess.isStalemate()) return 'Draw by stalemate.';
  if (chess.isThreefoldRepetition()) return 'Draw by threefold repetition.';
  if (chess.isInsufficientMaterial()) return 'Draw by insufficient material.';
  return 'Draw.';
}

function emitState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  io.to(roomChannel(roomId)).emit('gameState', {
    roomId,
    fen: room.chess.fen(),
    turn: room.chess.turn(),
    status: statusFrom(room.chess),
    players: {
      white: room.names.w,
      black: room.names.b
    },
    spectators: room.spectators.size
  });
}

function chooseSide(room, preferred) {
  if (preferred === 'w' && !room.players.w) return 'w';
  if (preferred === 'b' && !room.players.b) return 'b';
  if (!room.players.w) return 'w';
  if (!room.players.b) return 'b';
  return 'spectator';
}

io.on('connection', (socket) => {
  socket.data.roomId = null;
  socket.data.side = null;

  socket.on('joinRoom', ({ roomId, name, preferredSide }) => {
    const cleanRoom = String(roomId || '').trim().toLowerCase().slice(0, 24);
    const cleanName = String(name || 'Guest').trim().slice(0, 24) || 'Guest';
    if (!cleanRoom) {
      socket.emit('errorMsg', 'Room code is required.');
      return;
    }

    const room = getRoom(cleanRoom);
    const side = chooseSide(room, preferredSide);

    socket.join(roomChannel(cleanRoom));
    socket.data.roomId = cleanRoom;
    socket.data.side = side;

    if (side === 'w' || side === 'b') {
      room.players[side] = socket.id;
      room.names[side] = cleanName;
    } else {
      room.spectators.add(socket.id);
    }

    socket.emit('joined', { roomId: cleanRoom, side });
    emitState(cleanRoom);
  });

  socket.on('requestLegalMoves', ({ from }) => {
    const roomId = socket.data.roomId;
    const side = socket.data.side;
    if (!roomId || (side !== 'w' && side !== 'b')) return;

    const room = rooms.get(roomId);
    if (!room || room.players[side] !== socket.id || room.chess.turn() !== side) return;

    const all = room.chess.moves({ verbose: true });
    const legal = all
      .filter((m) => m.from === from)
      .map((m) => ({ to: m.to, promotion: m.promotion || null, flags: m.flags }));

    socket.emit('legalMoves', { from, moves: legal });
  });

  socket.on('makeMove', ({ from, to, promotion }) => {
    const roomId = socket.data.roomId;
    const side = socket.data.side;
    if (!roomId || (side !== 'w' && side !== 'b')) return;

    const room = rooms.get(roomId);
    if (!room) return;
    if (room.players[side] !== socket.id) {
      socket.emit('errorMsg', 'You are not controlling this side.');
      return;
    }
    if (room.chess.turn() !== side) {
      socket.emit('errorMsg', 'It is not your turn.');
      return;
    }

    let move = null;
    try {
      move = room.chess.move({ from, to, promotion: promotion || 'q' });
    } catch {
      socket.emit('errorMsg', 'Illegal move.');
      return;
    }

    if (!move) {
      socket.emit('errorMsg', 'Illegal move.');
      return;
    }

    emitState(roomId);
  });

  socket.on('resetGame', () => {
    const roomId = socket.data.roomId;
    const side = socket.data.side;
    if (!roomId || (side !== 'w' && side !== 'b')) return;

    const room = rooms.get(roomId);
    if (!room) return;
    room.chess = new Chess();
    emitState(roomId);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const side = socket.data.side;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    if (side === 'w' || side === 'b') {
      if (room.players[side] === socket.id) {
        room.players[side] = null;
        room.names[side] = 'Waiting...';
      }
    } else {
      room.spectators.delete(socket.id);
    }

    if (!room.players.w && !room.players.b && room.spectators.size === 0) {
      rooms.delete(roomId);
      return;
    }

    emitState(roomId);
  });
});

app.use(express.static(path.join(__dirname)));

server.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
