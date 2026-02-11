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

function statusFrom(chess) {
  if (!chess.isGameOver()) return `${chess.turn() === 'w' ? 'White' : 'Black'} to move`;
  if (chess.isCheckmate()) return `Checkmate. ${chess.turn() === 'w' ? 'Black' : 'White'} wins.`;
  if (chess.isStalemate()) return 'Draw by stalemate.';
  if (chess.isThreefoldRepetition()) return 'Draw by threefold repetition.';
  if (chess.isInsufficientMaterial()) return 'Draw by insufficient material.';
  return 'Draw.';
}

function sideLabel(side) {
  return side === 'w' ? 'White' : 'Black';
}

function makePlayer(name, socketId, isAI = false) {
  return {
    name,
    socketId,
    isAI
  };
}

function createRoom(roomId, mode, ownerName, preferredSide, ownerSocketId) {
  const roomMode = mode === 'ai' ? 'ai' : 'pvp';
  const ownerSide = preferredSide === 'b' ? 'b' : preferredSide === 'w' ? 'w' : 'w';
  const aiSide = ownerSide === 'w' ? 'b' : 'w';

  const room = {
    id: roomId,
    mode: roomMode,
    chess: new Chess(),
    players: {
      w: null,
      b: null
    },
    spectators: new Set(),
    aiTimer: null,
    aiNonce: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  if (roomMode === 'ai') {
    room.players[ownerSide] = makePlayer(ownerName, ownerSocketId, false);
    room.players[aiSide] = makePlayer('AI', null, true);
  } else {
    room.players[ownerSide] = makePlayer(ownerName, ownerSocketId, false);
  }

  rooms.set(roomId, room);
  return room;
}

function sanitizeRoomId(value) {
  return String(value || '').trim().toLowerCase().slice(0, 24);
}

function sanitizeName(value) {
  return String(value || 'Guest').trim().slice(0, 24) || 'Guest';
}

function canControlSide(room, socketId, side) {
  const p = room.players[side];
  return !!p && !p.isAI && p.socketId === socketId;
}

function roomHasHuman(room) {
  return ['w', 'b'].some((s) => room.players[s] && !room.players[s].isAI);
}

function roomHasTwoHumans(room) {
  return ['w', 'b'].filter((s) => room.players[s] && !room.players[s].isAI).length === 2;
}

function aiSideInRoom(room) {
  if (room.players.w?.isAI) return 'w';
  if (room.players.b?.isAI) return 'b';
  return null;
}

function challengeableRoomList() {
  const items = [];
  for (const room of rooms.values()) {
    if (room.mode !== 'ai') continue;
    if (room.chess.isGameOver()) continue;

    const aiSide = aiSideInRoom(room);
    if (!aiSide) continue;

    const humanSide = aiSide === 'w' ? 'b' : 'w';
    const human = room.players[humanSide];
    if (!human || human.isAI) continue;

    items.push({
      roomId: room.id,
      host: human.name,
      openSide: aiSide,
      turn: room.chess.turn(),
      status: statusFrom(room.chess)
    });
  }

  items.sort((a, b) => a.roomId.localeCompare(b.roomId));
  return items;
}

function emitRoomList() {
  io.emit('roomList', challengeableRoomList());
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
    spectators: room.spectators.size
  });
}

function chooseSideForPvP(room, preferredSide) {
  if (preferredSide === 'w' && !room.players.w) return 'w';
  if (preferredSide === 'b' && !room.players.b) return 'b';
  if (!room.players.w) return 'w';
  if (!room.players.b) return 'b';
  return 'spectator';
}

function joinAiRoom(room, socket, name, preferredSide) {
  const aiSide = aiSideInRoom(room);

  if (aiSide) {
    if (preferredSide && preferredSide !== 'auto' && preferredSide !== aiSide) {
      return { error: `Only ${sideLabel(aiSide)} is available in this AI room.` };
    }
    room.players[aiSide] = makePlayer(name, socket.id, false);
    return { side: aiSide };
  }

  const side = chooseSideForPvP(room, preferredSide);
  if (side === 'spectator') return { side };
  room.players[side] = makePlayer(name, socket.id, false);
  return { side };
}

function scheduleAiMove(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.mode !== 'ai') return;

  const side = room.chess.turn();
  const current = room.players[side];
  if (!current || !current.isAI) return;
  if (room.chess.isGameOver()) return;

  if (room.aiTimer) clearTimeout(room.aiTimer);
  room.aiNonce += 1;
  const nonce = room.aiNonce;

  room.aiTimer = setTimeout(() => {
    const liveRoom = rooms.get(roomId);
    if (!liveRoom) return;
    if (liveRoom.aiNonce !== nonce) return;
    if (liveRoom.mode !== 'ai') return;
    if (liveRoom.chess.turn() !== side) return;

    const turnPlayer = liveRoom.players[side];
    if (!turnPlayer || !turnPlayer.isAI) return;

    const moves = liveRoom.chess.moves({ verbose: true });
    if (!moves.length) {
      emitState(roomId);
      emitRoomList();
      return;
    }

    const move = moves[Math.floor(Math.random() * moves.length)];
    liveRoom.chess.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
    liveRoom.updatedAt = Date.now();

    emitState(roomId);
    emitRoomList();
    scheduleAiMove(roomId);
  }, 380);
}

function cleanupRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const humans = ['w', 'b'].filter((s) => room.players[s] && !room.players[s].isAI).length;
  if (humans === 0 && room.spectators.size === 0) {
    if (room.aiTimer) clearTimeout(room.aiTimer);
    rooms.delete(roomId);
  }
}

io.on('connection', (socket) => {
  socket.data.roomId = null;
  socket.data.side = null;
  socket.data.role = null;

  socket.emit('roomList', challengeableRoomList());

  socket.on('joinRoom', ({ roomId, name, preferredSide, mode }) => {
    const cleanRoom = sanitizeRoomId(roomId);
    const cleanName = sanitizeName(name);
    const pref = preferredSide === 'w' || preferredSide === 'b' ? preferredSide : 'auto';
    const requestedMode = mode === 'ai' ? 'ai' : 'pvp';

    if (!cleanRoom) {
      socket.emit('errorMsg', 'Room code is required.');
      return;
    }

    let room = rooms.get(cleanRoom);
    if (!room) {
      room = createRoom(cleanRoom, requestedMode, cleanName, pref, socket.id);
    } else if (room.mode !== requestedMode) {
      socket.emit('errorMsg', `Room exists as ${room.mode.toUpperCase()}. Choose that mode to join.`);
      return;
    }

    socket.join(roomChannel(cleanRoom));
    socket.data.roomId = cleanRoom;

    let result;
    if (room.mode === 'ai') {
      result = joinAiRoom(room, socket, cleanName, pref);
    } else {
      const side = chooseSideForPvP(room, pref);
      if (side === 'spectator') {
        result = { side: 'spectator' };
      } else {
        room.players[side] = makePlayer(cleanName, socket.id, false);
        result = { side };
      }
    }

    if (result?.error) {
      socket.leave(roomChannel(cleanRoom));
      socket.data.roomId = null;
      socket.emit('errorMsg', result.error);
      return;
    }

    socket.data.side = result.side;
    socket.data.role = result.side === 'spectator' ? 'spectator' : 'player';

    if (result.side === 'spectator') {
      room.spectators.add(socket.id);
    }

    room.updatedAt = Date.now();

    socket.emit('joined', {
      roomId: cleanRoom,
      side: result.side,
      mode: room.mode
    });

    emitState(cleanRoom);
    emitRoomList();
    scheduleAiMove(cleanRoom);
  });

  socket.on('getRoomList', () => {
    socket.emit('roomList', challengeableRoomList());
  });

  socket.on('requestLegalMoves', ({ from }) => {
    const roomId = socket.data.roomId;
    const side = socket.data.side;
    if (!roomId || (side !== 'w' && side !== 'b')) return;

    const room = rooms.get(roomId);
    if (!room) return;
    if (!canControlSide(room, socket.id, side)) return;
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
    if (!canControlSide(room, socket.id, side)) {
      socket.emit('errorMsg', 'You are not controlling this side.');
      return;
    }
    if (room.chess.turn() !== side) {
      socket.emit('errorMsg', 'It is not your turn.');
      return;
    }

    let move;
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

    room.updatedAt = Date.now();
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
    if (!canControlSide(room, socket.id, side)) return;

    room.chess = new Chess();
    room.updatedAt = Date.now();

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
      const current = room.players[side];
      if (current && !current.isAI && current.socketId === socket.id) {
        if (room.mode === 'ai') {
          const otherSide = side === 'w' ? 'b' : 'w';
          const other = room.players[otherSide];
          if (other && !other.isAI) {
            room.players[side] = makePlayer('AI', null, true);
          } else {
            room.players[side] = null;
          }
        } else {
          room.players[side] = null;
        }
      }
    }

    room.updatedAt = Date.now();
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
