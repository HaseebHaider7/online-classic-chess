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

function roomChannel(id) {
  return `room:${id}`;
}

function sanitizeName(value) {
  return String(value || 'Guest').trim().slice(0, 24) || 'Guest';
}

function sanitizeRoomId(value) {
  return String(value || '').trim().toLowerCase().slice(0, 24);
}

function makePlayer(name, socketId, isAI = false) {
  return { name, socketId, isAI };
}

function statusFrom(chess) {
  if (!chess.isGameOver()) return `${chess.turn() === 'w' ? 'White' : 'Black'} to move`;
  if (chess.isCheckmate()) return `Checkmate. ${chess.turn() === 'w' ? 'Black' : 'White'} wins.`;
  if (chess.isStalemate()) return 'Draw by stalemate.';
  if (chess.isThreefoldRepetition()) return 'Draw by threefold repetition.';
  if (chess.isInsufficientMaterial()) return 'Draw by insufficient material.';
  return 'Draw.';
}

function generateAiRoomId() {
  const seed = Math.random().toString(36).slice(2, 8);
  return `ai-${seed}`;
}

function sideLabel(side) {
  return side === 'w' ? 'White' : 'Black';
}

function countHumanPlayers(room) {
  let count = 0;
  if (room.players.w && !room.players.w.isAI) count += 1;
  if (room.players.b && !room.players.b.isAI) count += 1;
  return count;
}

function aiSide(room) {
  if (room.players.w?.isAI) return 'w';
  if (room.players.b?.isAI) return 'b';
  return null;
}

function emitState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  io.to(roomChannel(roomId)).emit('gameState', {
    roomId,
    mode: room.mode,
    fen: room.chess.fen(),
    turn: room.chess.turn(),
    status: statusFrom(room.chess),
    players: {
      white: room.players.w ? room.players.w.name : 'Waiting...',
      black: room.players.b ? room.players.b.name : 'Waiting...'
    },
    playerTypes: {
      white: room.players.w?.isAI ? 'ai' : room.players.w ? 'human' : 'empty',
      black: room.players.b?.isAI ? 'ai' : room.players.b ? 'human' : 'empty'
    },
    spectators: room.spectators.size,
    lastMoveSan: room.lastMoveSan || null,
    lastMoveBy: room.lastMoveBy || null
  });
}

function roomSummaryList() {
  const out = [];
  for (const room of rooms.values()) {
    const openSides = [];

    if (!room.players.w || (room.mode === 'ai' && room.players.w.isAI)) openSides.push('w');
    if (!room.players.b || (room.mode === 'ai' && room.players.b.isAI)) openSides.push('b');

    out.push({
      roomId: room.id,
      mode: room.mode,
      white: room.players.w ? room.players.w.name : 'Waiting...',
      black: room.players.b ? room.players.b.name : 'Waiting...',
      openSides,
      status: statusFrom(room.chess),
      spectators: room.spectators.size,
      canPlay: openSides.length > 0,
      canSpectate: true
    });
  }

  out.sort((a, b) => a.roomId.localeCompare(b.roomId));
  return out;
}

function emitRoomList() {
  io.emit('roomList', roomSummaryList());
}

function canControl(room, side, socketId) {
  const p = room.players[side];
  return !!p && !p.isAI && p.socketId === socketId;
}

function scheduleAiMove(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.mode !== 'ai') return;
  if (room.chess.isGameOver()) return;

  const side = room.chess.turn();
  const sidePlayer = room.players[side];
  if (!sidePlayer || !sidePlayer.isAI) return;

  if (room.aiTimer) clearTimeout(room.aiTimer);
  room.aiTimer = setTimeout(() => {
    const live = rooms.get(roomId);
    if (!live || live.mode !== 'ai' || live.chess.isGameOver()) return;

    const turnSide = live.chess.turn();
    const turnPlayer = live.players[turnSide];
    if (!turnPlayer || !turnPlayer.isAI) return;

    const legal = live.chess.moves({ verbose: true });
    if (!legal.length) {
      emitState(roomId);
      emitRoomList();
      return;
    }

    const move = legal[Math.floor(Math.random() * legal.length)];
    const played = live.chess.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
    live.lastMoveSan = played?.san || null;
    live.lastMoveBy = side;

    emitState(roomId);
    emitRoomList();
    scheduleAiMove(roomId);
  }, 420);
}

function cleanupRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const humans = countHumanPlayers(room);
  if (humans === 0 && room.spectators.size === 0) {
    if (room.aiTimer) clearTimeout(room.aiTimer);
    rooms.delete(roomId);
  }
}

io.on('connection', (socket) => {
  socket.data.roomId = null;
  socket.data.side = null;
  socket.data.role = null;

  socket.emit('roomList', roomSummaryList());

  socket.on('startAiGame', ({ name, preferredSide }) => {
    const cleanName = sanitizeName(name);
    const desired = preferredSide === 'b' ? 'b' : preferredSide === 'w' ? 'w' : 'w';
    const ai = desired === 'w' ? 'b' : 'w';

    let roomId = generateAiRoomId();
    while (rooms.has(roomId)) roomId = generateAiRoomId();

    const room = {
      id: roomId,
      mode: 'ai',
      chess: new Chess(),
      players: { w: null, b: null },
      spectators: new Set(),
      aiTimer: null,
      lastMoveSan: null,
      lastMoveBy: null
    };

    room.players[desired] = makePlayer(cleanName, socket.id, false);
    room.players[ai] = makePlayer('AI', null, true);
    rooms.set(roomId, room);

    socket.join(roomChannel(roomId));
    socket.data.roomId = roomId;
    socket.data.side = desired;
    socket.data.role = 'player';

    socket.emit('joined', { roomId, side: desired, mode: 'ai' });
    emitState(roomId);
    emitRoomList();
    scheduleAiMove(roomId);
  });

  socket.on('joinHumanRoom', ({ roomId, name, preferredSide }) => {
    const cleanRoom = sanitizeRoomId(roomId);
    const cleanName = sanitizeName(name);
    const pref = preferredSide === 'w' || preferredSide === 'b' ? preferredSide : 'auto';

    if (!cleanRoom) {
      socket.emit('errorMsg', 'Room code is required for human rooms.');
      return;
    }

    let room = rooms.get(cleanRoom);
    if (!room) {
      room = {
        id: cleanRoom,
        mode: 'pvp',
        chess: new Chess(),
        players: { w: null, b: null },
        spectators: new Set(),
        aiTimer: null,
        lastMoveSan: null,
        lastMoveBy: null
      };
      rooms.set(cleanRoom, room);
    }

    if (room.mode !== 'pvp') {
      socket.emit('errorMsg', 'This room is AI mode. Use room list to join it.');
      return;
    }

    let side = null;
    if (pref === 'w' && !room.players.w) side = 'w';
    if (pref === 'b' && !room.players.b) side = 'b';
    if (!side && !room.players.w) side = 'w';
    if (!side && !room.players.b) side = 'b';

    socket.join(roomChannel(cleanRoom));
    socket.data.roomId = cleanRoom;

    if (!side) {
      room.spectators.add(socket.id);
      socket.data.side = null;
      socket.data.role = 'spectator';
      socket.emit('joined', { roomId: cleanRoom, side: 'spectator', mode: 'pvp' });
    } else {
      room.players[side] = makePlayer(cleanName, socket.id, false);
      socket.data.side = side;
      socket.data.role = 'player';
      socket.emit('joined', { roomId: cleanRoom, side, mode: 'pvp' });
    }

    emitState(cleanRoom);
    emitRoomList();
  });

  socket.on('joinListedRoom', ({ roomId, action, preferredSide, name }) => {
    const cleanRoom = sanitizeRoomId(roomId);
    const cleanName = sanitizeName(name);
    const pref = preferredSide === 'w' || preferredSide === 'b' ? preferredSide : 'auto';

    const room = rooms.get(cleanRoom);
    if (!room) {
      socket.emit('errorMsg', 'Room no longer exists.');
      emitRoomList();
      return;
    }

    socket.join(roomChannel(cleanRoom));
    socket.data.roomId = cleanRoom;

    if (action === 'spectate') {
      room.spectators.add(socket.id);
      socket.data.side = null;
      socket.data.role = 'spectator';
      socket.emit('joined', { roomId: cleanRoom, side: 'spectator', mode: room.mode });
      emitState(cleanRoom);
      emitRoomList();
      return;
    }

    let side = null;

    if (room.mode === 'pvp') {
      if (pref === 'w' && !room.players.w) side = 'w';
      if (pref === 'b' && !room.players.b) side = 'b';
      if (!side && !room.players.w) side = 'w';
      if (!side && !room.players.b) side = 'b';

      if (!side) {
        socket.emit('errorMsg', 'No free player slot. Join as spectator.');
        return;
      }

      room.players[side] = makePlayer(cleanName, socket.id, false);
    } else {
      const openAiSide = aiSide(room);
      if (!openAiSide) {
        socket.emit('errorMsg', 'AI room is already full with two humans.');
        return;
      }

      if (pref !== 'auto' && pref !== openAiSide) {
        socket.emit('errorMsg', `Only ${sideLabel(openAiSide)} is open in this room.`);
        return;
      }

      side = openAiSide;
      room.players[side] = makePlayer(cleanName, socket.id, false);
    }

    socket.data.side = side;
    socket.data.role = 'player';
    socket.emit('joined', { roomId: cleanRoom, side, mode: room.mode });

    emitState(cleanRoom);
    emitRoomList();
    scheduleAiMove(cleanRoom);
  });

  socket.on('requestRoomList', () => {
    socket.emit('roomList', roomSummaryList());
  });

  socket.on('requestLegalMoves', ({ from }) => {
    const roomId = socket.data.roomId;
    const side = socket.data.side;
    if (!roomId || (side !== 'w' && side !== 'b')) return;

    const room = rooms.get(roomId);
    if (!room) return;
    if (!canControl(room, side, socket.id)) return;
    if (room.chess.turn() !== side) return;

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
    if (!canControl(room, side, socket.id)) {
      socket.emit('errorMsg', 'You are not controlling this side.');
      return;
    }
    if (room.chess.turn() !== side) {
      socket.emit('errorMsg', 'It is not your turn.');
      return;
    }

    try {
      const move = room.chess.move({ from, to, promotion: promotion || 'q' });
      if (!move) {
        socket.emit('errorMsg', 'Illegal move.');
        return;
      }
      room.lastMoveSan = move.san;
      room.lastMoveBy = side;
    } catch {
      socket.emit('errorMsg', 'Illegal move.');
      return;
    }

    emitState(roomId);
    emitRoomList();
    scheduleAiMove(roomId);
  });

  socket.on('resetGame', () => {
    const roomId = socket.data.roomId;
    const side = socket.data.side;
    if (!roomId || (side !== 'w' && side !== 'b')) return;

    const room = rooms.get(roomId);
    if (!room) return;
    if (!canControl(room, side, socket.id)) return;

    room.chess = new Chess();
    room.lastMoveSan = null;
    room.lastMoveBy = null;
    emitState(roomId);
    emitRoomList();
    scheduleAiMove(roomId);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const side = socket.data.side;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    room.spectators.delete(socket.id);

    if (side === 'w' || side === 'b') {
      const p = room.players[side];
      if (p && !p.isAI && p.socketId === socket.id) {
        if (room.mode === 'ai') {
          const humansLeft = countHumanPlayers(room) - 1;
          if (humansLeft > 0) {
            room.players[side] = makePlayer('AI', null, true);
          } else {
            room.players[side] = null;
          }
        } else {
          room.players[side] = null;
        }
      }
    }

    cleanupRoomIfEmpty(roomId);
    if (rooms.has(roomId)) {
      emitState(roomId);
      emitRoomList();
      scheduleAiMove(roomId);
    } else {
      emitRoomList();
    }
  });
});

app.use(express.static(path.join(__dirname)));

server.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
