(() => {
  const socket = io();

  const PIECE_IMAGES = {
    wK: 'https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg',
    wQ: 'https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg',
    wR: 'https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg',
    wB: 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg',
    wN: 'https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg',
    wP: 'https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg',
    bK: 'https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg',
    bQ: 'https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg',
    bR: 'https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg',
    bB: 'https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg',
    bN: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg',
    bP: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg'
  };

  const PIECE_FALLBACK = {
    wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
    bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟'
  };

  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  const boardEl = document.getElementById('board');
  const nameInput = document.getElementById('nameInput');
  const roomInput = document.getElementById('roomInput');
  const modeSelect = document.getElementById('modeSelect');
  const colorSelect = document.getElementById('colorSelect');
  const joinBtn = document.getElementById('joinBtn');
  const newGameBtn = document.getElementById('newGameBtn');
  const refreshRoomsBtn = document.getElementById('refreshRoomsBtn');
  const roomsList = document.getElementById('roomsList');

  const turnText = document.getElementById('turnText');
  const stateText = document.getElementById('stateText');
  const ruleText = document.getElementById('ruleText');
  const roomText = document.getElementById('roomText');
  const roleText = document.getElementById('roleText');
  const errorText = document.getElementById('errorText');

  const promotionModal = document.getElementById('promotionModal');
  const promotionChoices = document.getElementById('promotionChoices');

  const app = {
    roomId: null,
    side: null,
    mode: 'pvp',
    turn: 'w',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    selected: null,
    legalMoves: [],
    pendingTarget: null,
    connected: false,
    challengeRooms: [],
    viewSide: 'w'
  };

  joinBtn.addEventListener('click', () => {
    const roomId = roomInput.value.trim();
    const name = nameInput.value.trim() || 'Guest';
    const preferredSide = colorSelect.value;
    const mode = modeSelect.value;

    if (!roomId) {
      errorText.textContent = 'Please enter a room code.';
      return;
    }

    errorText.textContent = '';
    socket.emit('joinRoom', {
      roomId,
      name,
      preferredSide,
      mode
    });
  });

  refreshRoomsBtn.addEventListener('click', () => {
    socket.emit('getRoomList');
  });

  newGameBtn.addEventListener('click', () => {
    if (!app.connected) return;
    socket.emit('resetGame');
  });

  socket.on('connect', () => {
    app.connected = true;
    stateText.textContent = 'Connected. Join a room.';
    socket.emit('getRoomList');
  });

  socket.on('disconnect', () => {
    app.connected = false;
    stateText.textContent = 'Disconnected from server.';
  });

  socket.on('joined', ({ roomId, side, mode }) => {
    app.roomId = roomId;
    app.side = side;
    app.mode = mode;
    app.viewSide = side === 'b' ? 'b' : 'w';

    roomText.textContent = `Room: ${roomId}`;
    roleText.textContent = `Role: ${toRoleLabel(side)} | Mode: ${mode.toUpperCase()}`;
    errorText.textContent = '';
    drawBoard();
  });

  socket.on('gameState', (state) => {
    app.fen = state.fen;
    app.turn = state.turn;
    app.mode = state.mode;

    if (app.side === 'b') app.viewSide = 'b';
    else if (app.side === 'w') app.viewSide = 'w';

    turnText.textContent = `Turn: ${state.turn === 'w' ? 'White' : 'Black'}`;
    stateText.textContent = state.status;
    ruleText.textContent = `White: ${state.players.white} (${state.playerTypes.white}) | Black: ${state.players.black} (${state.playerTypes.black}) | Spectators: ${state.spectators}`;

    app.selected = null;
    app.legalMoves = [];
    drawBoard();
  });

  socket.on('roomList', (rooms) => {
    app.challengeRooms = Array.isArray(rooms) ? rooms : [];
    drawRoomList();
  });

  socket.on('legalMoves', ({ from, moves }) => {
    if (!app.selected || app.selected !== from) return;
    app.legalMoves = moves;
    drawBoard();
  });

  socket.on('errorMsg', (msg) => {
    errorText.textContent = msg;
  });

  function drawRoomList() {
    roomsList.innerHTML = '';

    if (!app.challengeRooms.length) {
      const empty = document.createElement('p');
      empty.className = 'rooms-empty';
      empty.textContent = 'No AI rooms available to challenge right now.';
      roomsList.appendChild(empty);
      return;
    }

    for (const room of app.challengeRooms) {
      const card = document.createElement('div');
      card.className = 'room-card';

      const info = document.createElement('div');
      info.className = 'room-card-info';
      info.innerHTML = `<strong>${escapeHtml(room.roomId)}</strong><span>Host: ${escapeHtml(room.host)} | Open: ${room.openSide === 'w' ? 'White' : 'Black'}</span>`;

      const btn = document.createElement('button');
      btn.className = 'small-btn';
      btn.textContent = 'Join as Opponent';
      btn.addEventListener('click', () => {
        const name = nameInput.value.trim() || 'Guest';
        const preferredSide = colorSelect.value;

        socket.emit('joinRoom', {
          roomId: room.roomId,
          name,
          preferredSide,
          mode: 'ai'
        });
      });

      card.appendChild(info);
      card.appendChild(btn);
      roomsList.appendChild(card);
    }
  }

  function drawBoard() {
    boardEl.innerHTML = '';
    const pieceBySquare = parseFenPieces(app.fen);

    const rankOrder = app.viewSide === 'b'
      ? [1, 2, 3, 4, 5, 6, 7, 8]
      : [8, 7, 6, 5, 4, 3, 2, 1];
    const fileOrder = app.viewSide === 'b'
      ? ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']
      : ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    for (let row = 0; row < 8; row += 1) {
      const rank = rankOrder[row];
      for (let col = 0; col < 8; col += 1) {
        const file = fileOrder[col];
        const squareName = `${file}${rank}`;

        const square = document.createElement('button');
        square.className = `square ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
        square.dataset.square = squareName;

        if (app.selected === squareName) {
          square.classList.add('selected');
        }

        const legal = app.legalMoves.find((m) => m.to === squareName);
        if (legal) {
          square.classList.add(legal.flags.includes('c') || legal.flags.includes('e') ? 'capture' : 'legal');
        }

        if (row === 7) {
          const fileTag = document.createElement('span');
          fileTag.className = 'coord coord-file';
          fileTag.textContent = file;
          square.appendChild(fileTag);
        }

        if (col === 0) {
          const rankTag = document.createElement('span');
          rankTag.className = 'coord coord-rank';
          rankTag.textContent = String(rank);
          square.appendChild(rankTag);
        }

        const piece = pieceBySquare.get(squareName);
        if (piece) {
          square.appendChild(createPieceNode(piece, `piece ${piece[0] === 'w' ? 'white' : 'black'}`));
        }

        square.addEventListener('click', () => onSquareClick(squareName, piece));
        boardEl.appendChild(square);
      }
    }
  }

  function onSquareClick(squareName, piece) {
    if (!app.connected || !app.roomId) return;

    const myTurn = app.side === 'w' || app.side === 'b' ? app.turn === app.side : false;
    if (!myTurn) return;

    if (app.selected) {
      const chosen = app.legalMoves.find((m) => m.to === squareName);
      if (chosen) {
        if (needsPromotion(squareName)) {
          app.pendingTarget = squareName;
          showPromotionChoices();
        } else {
          sendMove(app.selected, squareName, null);
        }
        return;
      }
    }

    if (piece && piece[0] === app.side) {
      app.selected = squareName;
      app.legalMoves = [];
      socket.emit('requestLegalMoves', { from: squareName });
      drawBoard();
    } else {
      app.selected = null;
      app.legalMoves = [];
      drawBoard();
    }
  }

  function needsPromotion(toSquare) {
    if (!app.selected) return false;

    const fromRank = Number(app.selected.slice(1));
    const toRank = Number(toSquare.slice(1));
    const pieceBySquare = parseFenPieces(app.fen);
    const piece = pieceBySquare.get(app.selected);

    if (!piece || piece[1] !== 'P') return false;
    return (piece[0] === 'w' && fromRank === 7 && toRank === 8) || (piece[0] === 'b' && fromRank === 2 && toRank === 1);
  }

  function showPromotionChoices() {
    promotionChoices.innerHTML = '';
    for (const p of ['q', 'r', 'b', 'n']) {
      const btn = document.createElement('button');
      btn.className = 'promo-btn';
      const side = app.side;
      btn.appendChild(createPieceNode(`${side}${p.toUpperCase()}`, 'promo-piece'));
      btn.addEventListener('click', () => {
        if (!app.selected || !app.pendingTarget) return;
        sendMove(app.selected, app.pendingTarget, p);
        hidePromotionChoices();
      });
      promotionChoices.appendChild(btn);
    }
    promotionModal.classList.remove('hidden');
  }

  function hidePromotionChoices() {
    promotionModal.classList.add('hidden');
    promotionChoices.innerHTML = '';
    app.pendingTarget = null;
  }

  promotionModal.addEventListener('click', (event) => {
    if (event.target === promotionModal) hidePromotionChoices();
  });

  function sendMove(from, to, promotion) {
    socket.emit('makeMove', { from, to, promotion });
    app.selected = null;
    app.legalMoves = [];
    app.pendingTarget = null;
    drawBoard();
  }

  function parseFenPieces(fen) {
    const map = new Map();
    const rows = fen.split(' ')[0].split('/');

    for (let row = 0; row < 8; row += 1) {
      const rank = 8 - row;
      let fileIdx = 0;

      for (const ch of rows[row]) {
        if (/\d/.test(ch)) {
          fileIdx += Number(ch);
          continue;
        }

        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        const piece = ch.toUpperCase();
        const sq = `${files[fileIdx]}${rank}`;
        map.set(sq, `${color}${piece}`);
        fileIdx += 1;
      }
    }

    return map;
  }

  function toRoleLabel(side) {
    if (side === 'w') return 'Player (White)';
    if (side === 'b') return 'Player (Black)';
    return 'Spectator';
  }

  function createPieceNode(pieceKey, className) {
    if (className.includes('promo-piece')) {
      const promoImg = document.createElement('img');
      promoImg.className = className;
      promoImg.src = PIECE_IMAGES[pieceKey];
      promoImg.alt = pieceKey;
      promoImg.draggable = false;
      promoImg.onerror = () => {
        const fallback = document.createElement('span');
        fallback.className = `${className} piece-fallback`;
        fallback.textContent = PIECE_FALLBACK[pieceKey] || '?';
        promoImg.replaceWith(fallback);
      };
      return promoImg;
    }

    const wrapper = document.createElement('div');
    wrapper.className = className;

    const img = document.createElement('img');
    img.className = 'piece-glyph';
    img.src = PIECE_IMAGES[pieceKey];
    img.alt = pieceKey;
    img.draggable = false;
    img.onerror = () => {
      const fallback = document.createElement('div');
      fallback.className = 'piece-fallback';
      fallback.textContent = PIECE_FALLBACK[pieceKey] || '?';
      wrapper.replaceChildren(fallback);
    };

    wrapper.appendChild(img);
    return wrapper;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  socket.emit('getRoomList');
  drawRoomList();
  drawBoard();
})();
