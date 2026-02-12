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
const AI_DEPTH_BY_LEVEL = {
  easy: 1,
  medium: 2,
  hard: 3
};

const PIECE_VALUES = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0
};

// Piece-square tables from White's perspective.
const PST = {
  p: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0]
  ],
  n: [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50]
  ],
  b: [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20]
  ],
  r: [
    [0, 0, 0, 5, 5, 0, 0, 0],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0]
  ],
  q: [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 5, 0, -10],
    [-10, 0, 5, 5, 5, 5, 5, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20]
  ],
  k: [
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-20, -30, -30, -40, -40, -30, -30, -20],
    [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20],
    [20, 30, 10, 0, 0, 10, 30, 20]
  ]
};

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

function normalizeAiLevel(value) {
  return value === 'easy' || value === 'hard' ? value : 'medium';
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
      aiLevel: room.mode === 'ai' ? room.aiLevel || 'medium' : null,
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

function evaluateBoard(chess) {
  if (chess.isCheckmate()) return -100000;
  if (chess.isDraw()) return 0;

  let score = 0;
  const board = chess.board();

  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const piece = board[r][c];
      if (!piece) continue;

      const base = PIECE_VALUES[piece.type];
      const pstRow = piece.color === 'w' ? r : 7 - r;
      const pst = PST[piece.type][pstRow][c];
      const signed = piece.color === 'w' ? 1 : -1;
      score += signed * (base + pst);
    }
  }

  // Small mobility bonus.
  const turn = chess.turn();
  const mobility = chess.moves().length;
  score += (turn === 'w' ? 1 : -1) * mobility * 2;

  return score;
}

function orderedMoves(chess) {
  const moves = chess.moves({ verbose: true });
  moves.sort((a, b) => {
    const aScore = (a.captured ? 100 : 0) + (a.promotion ? 80 : 0) + (a.san.includes('+') ? 30 : 0);
    const bScore = (b.captured ? 100 : 0) + (b.promotion ? 80 : 0) + (b.san.includes('+') ? 30 : 0);
    return bScore - aScore;
  });
  return moves;
}

function negamax(chess, depth, alpha, beta, colorSign) {
  if (depth === 0 || chess.isGameOver()) {
    return colorSign * evaluateBoard(chess);
  }

  let best = -Infinity;
  const moves = orderedMoves(chess);

  for (const move of moves) {
    chess.move(move);
    const score = -negamax(chess, depth - 1, -beta, -alpha, -colorSign);
    chess.undo();

    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }

  return best;
}

function chooseBestMove(chess, depth) {
  const legal = orderedMoves(chess);
  if (!legal.length) return null;

  const turn = chess.turn();
  const colorSign = turn === 'w' ? 1 : -1;

  const searchDepth = legal.length <= 18 ? depth + 1 : depth;

  let bestMove = legal[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const move of legal) {
    chess.move(move);
    const score = -negamax(chess, searchDepth - 1, -beta, -alpha, -colorSign);
    chess.undo();

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    if (score > alpha) alpha = score;
  }

  return bestMove;
}

function chooseAiMove(chess, aiLevel) {
  const legal = orderedMoves(chess);
  if (!legal.length) return null;

  if (aiLevel === 'easy') {
    if (Math.random() < 0.75) {
      return legal[Math.floor(Math.random() * legal.length)];
    }
    const captures = legal.filter((m) => m.captured);
    if (captures.length) return captures[Math.floor(Math.random() * captures.length)];
    return legal[Math.floor(Math.random() * legal.length)];
  }

  const depth = AI_DEPTH_BY_LEVEL[aiLevel] || AI_DEPTH_BY_LEVEL.medium;
  return chooseBestMove(chess, depth);
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

    const move = chooseAiMove(live.chess, live.aiLevel || 'medium');
    if (!move) {
      emitState(roomId);
      emitRoomList();
      return;
    }

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

  socket.on('startAiGame', ({ name, preferredSide, aiLevel }) => {
    const cleanName = sanitizeName(name);
    const desired = preferredSide === 'b' ? 'b' : preferredSide === 'w' ? 'w' : 'w';
    const ai = desired === 'w' ? 'b' : 'w';
    const level = normalizeAiLevel(aiLevel);

    let roomId = generateAiRoomId();
    while (rooms.has(roomId)) roomId = generateAiRoomId();

    const room = {
      id: roomId,
      mode: 'ai',
      aiLevel: level,
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
        aiLevel: null,
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
