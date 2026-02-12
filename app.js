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
  const boardShellEl = document.querySelector('.board-shell');
  const boardWrapEl = document.querySelector('.board-wrap');

  const nameInput = document.getElementById('nameInput');
  const colorSelect = document.getElementById('colorSelect');
  const aiLevelSelect = document.getElementById('aiLevelSelect');
  const roomInput = document.getElementById('roomInput');

  const playAiBtn = document.getElementById('playAiBtn');
  const joinRoomBtn = document.getElementById('joinRoomBtn');
  const resetBtn = document.getElementById('resetBtn');
  const refreshRoomsBtn = document.getElementById('refreshRoomsBtn');

  const turnText = document.getElementById('turnText');
  const stateText = document.getElementById('stateText');
  const ruleText = document.getElementById('ruleText');
  const roomText = document.getElementById('roomText');
  const roleText = document.getElementById('roleText');
  const errorText = document.getElementById('errorText');
  const roomsList = document.getElementById('roomsList');

  const promotionModal = document.getElementById('promotionModal');
  const promotionChoices = document.getElementById('promotionChoices');

  const app = {
    roomId: null,
    side: null,
    role: null,
    mode: null,
    turn: 'w',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    selected: null,
    legalMoves: [],
    pendingTarget: null,
    connected: false,
    rooms: [],
    viewSide: 'w',
    prevTurn: 'w',
    prevMoveSan: null
  };

  const toastEl = document.createElement('div');
  toastEl.id = 'toast';
  document.body.appendChild(toastEl);

  playAiBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Guest';
    const preferredSide = colorSelect.value;
    const aiLevel = aiLevelSelect ? aiLevelSelect.value : 'medium';
    errorText.textContent = '';
    socket.emit('startAiGame', { name, preferredSide, aiLevel });
  });

  joinRoomBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Guest';
    const roomId = roomInput.value.trim();
    const preferredSide = colorSelect.value;

    if (!roomId) {
      errorText.textContent = 'Enter room code for human room.';
      return;
    }

    errorText.textContent = '';
    socket.emit('joinHumanRoom', { roomId, name, preferredSide });
  });

  resetBtn.addEventListener('click', () => {
    socket.emit('resetGame');
  });

  refreshRoomsBtn.addEventListener('click', () => {
    socket.emit('requestRoomList');
  });

  socket.on('connect', () => {
    app.connected = true;
    stateText.textContent = 'Connected';
    socket.emit('requestRoomList');
  });

  socket.on('disconnect', () => {
    app.connected = false;
    stateText.textContent = 'Disconnected';
  });

  socket.on('joined', ({ roomId, side, mode }) => {
    app.roomId = roomId;
    app.side = side === 'spectator' ? null : side;
    app.role = side === 'spectator' ? 'spectator' : 'player';
    app.mode = mode;

    app.viewSide = app.side === 'b' ? 'b' : 'w';

    roomText.textContent = `Room: ${roomId}`;
    roleText.textContent = `Role: ${toRoleLabel(side)} | Mode: ${mode.toUpperCase()}`;
    showToast(`Joined ${roomId} as ${toRoleLabel(side)}.`, 1600);
    drawBoard();
  });

  socket.on('gameState', (state) => {
    const previousTurn = app.turn;
    const previousMove = app.prevMoveSan;

    app.fen = state.fen;
    app.turn = state.turn;
    app.mode = state.mode;

    if (app.side === 'b') app.viewSide = 'b';
    if (app.side === 'w') app.viewSide = 'w';

    turnText.textContent = `Turn: ${state.turn === 'w' ? 'White' : 'Black'}`;
    const myTurn = app.role === 'player' && app.side && state.turn === app.side;
    stateText.textContent = myTurn ? `${state.status} | Your move` : state.status;
    updateStatusVisual(state.status);
    ruleText.textContent = `White: ${state.players.white} (${state.playerTypes.white}) | Black: ${state.players.black} (${state.playerTypes.black}) | Spectators: ${state.spectators}`;

    app.selected = null;
    app.legalMoves = [];
    app.prevTurn = previousTurn;
    app.prevMoveSan = state.lastMoveSan || null;

    handleMoveNotifications(state, previousTurn, previousMove);
    drawBoard();
  });

  socket.on('roomList', (rooms) => {
    app.rooms = Array.isArray(rooms) ? rooms : [];
    drawRoomList();
  });

  socket.on('legalMoves', ({ from, moves }) => {
    if (!app.selected || app.selected !== from) return;
    app.legalMoves = moves;
    drawBoard();
  });

  socket.on('errorMsg', (msg) => {
    errorText.textContent = msg;
    showToast(msg, 2200);
  });

  function handleMoveNotifications(state, previousTurn, previousMove) {
    if (!state.lastMoveSan) return;
    if (state.lastMoveSan === previousMove && state.turn === previousTurn) return;

    if (app.role === 'player' && app.side) {
      if (state.mode === 'ai') {
        if (state.turn === app.side) {
          showToast(`AI played ${state.lastMoveSan}. Your move.`, 2400);
          maybeBrowserNotify('Your move', `AI played ${state.lastMoveSan}.`);
        }
      } else if (state.mode === 'pvp') {
        if (state.lastMoveBy && state.lastMoveBy !== app.side && state.turn === app.side) {
          showToast(`Opponent played ${state.lastMoveSan}. Your turn.`, 2600);
          maybeBrowserNotify('Your turn', `Opponent played ${state.lastMoveSan}.`);
        }
      }
    }
  }

  function updateBoardFitFromViewport() {
    if (!boardShellEl) return;
    boardShellEl.style.removeProperty('--board-runtime-width');
  }

  function showToast(message, duration = 1800) {
    if (!message) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, duration);
  }

  function maybeBrowserNotify(title, body) {
    if (typeof window.Notification === 'undefined') return;
    if (!document.hidden) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
      return;
    }
    if (Notification.permission === 'default') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') new Notification(title, { body });
      }).catch(() => {});
    }
  }

  function updateStatusVisual(status) {
    const text = String(status || '').toLowerCase();
    const isGameOver = text.includes('checkmate') || text.includes('draw') || text.includes('stalemate');
    stateText.classList.toggle('game-over', isGameOver);
  }

  function drawRoomList() {
    roomsList.innerHTML = '';

    if (!app.rooms.length) {
      const p = document.createElement('p');
      p.className = 'rooms-empty';
      p.textContent = 'No active rooms yet.';
      roomsList.appendChild(p);
      return;
    }

    for (const room of app.rooms) {
      const card = document.createElement('div');
      card.className = 'room-card';

      const info = document.createElement('div');
      info.className = 'room-card-info';
      const levelInfo = room.mode === 'ai' ? ` | Level: ${escapeHtml((room.aiLevel || 'medium').toUpperCase())}` : '';
      info.innerHTML = `<strong>${escapeHtml(room.roomId)}</strong><span>${room.mode.toUpperCase()}${levelInfo} | White: ${escapeHtml(room.white)} | Black: ${escapeHtml(room.black)}</span>`;

      const actions = document.createElement('div');
      actions.className = 'room-actions';

      const playBtn = document.createElement('button');
      playBtn.className = 'small-btn';
      playBtn.textContent = room.canPlay ? 'Play' : 'Full';
      playBtn.disabled = !room.canPlay;
      playBtn.addEventListener('click', () => {
        socket.emit('joinListedRoom', {
          roomId: room.roomId,
          action: 'play',
          preferredSide: colorSelect.value,
          name: nameInput.value.trim() || 'Guest'
        });
      });

      const watchBtn = document.createElement('button');
      watchBtn.className = 'small-btn';
      watchBtn.textContent = 'Spectate';
      watchBtn.addEventListener('click', () => {
        socket.emit('joinListedRoom', {
          roomId: room.roomId,
          action: 'spectate',
          preferredSide: 'auto',
          name: nameInput.value.trim() || 'Guest'
        });
      });

      actions.appendChild(playBtn);
      actions.appendChild(watchBtn);

      card.appendChild(info);
      card.appendChild(actions);
      roomsList.appendChild(card);
    }
  }

  function orientedRanks() {
    return app.viewSide === 'b' ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  }

  function orientedFiles() {
    return app.viewSide === 'b' ? ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'] : ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  }

  function drawBoard() {
    if (!boardEl) return;

    boardEl.innerHTML = '';
    const pieceBySquare = parseFenPieces(app.fen);
    const ranks = orientedRanks();
    const fileOrder = orientedFiles();

    for (let row = 0; row < 8; row += 1) {
      const rank = ranks[row];
      for (let col = 0; col < 8; col += 1) {
        const file = fileOrder[col];
        const squareName = `${file}${rank}`;

        const square = document.createElement('button');
        square.className = `square ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
        square.dataset.square = squareName;

        if (app.selected === squareName) square.classList.add('selected');

        const legal = app.legalMoves.find((m) => m.to === squareName);
        if (legal) {
          square.classList.add(legal.flags.includes('c') || legal.flags.includes('e') ? 'capture' : 'legal');
        }

        // Coordinates on the edge of the board (inside edge squares).
        if (row === 7) {
          const fileTag = document.createElement('span');
          fileTag.className = 'edge-label edge-file';
          fileTag.textContent = file;
          square.appendChild(fileTag);
        }
        if (col === 0) {
          const rankTag = document.createElement('span');
          rankTag.className = 'edge-label edge-rank';
          rankTag.textContent = String(rank);
          square.appendChild(rankTag);
        }

        const piece = pieceBySquare.get(squareName);
        if (piece) square.appendChild(createPieceNode(piece, `piece ${piece[0] === 'w' ? 'white' : 'black'}`));

        square.addEventListener('click', () => onSquareClick(squareName, piece));
        boardEl.appendChild(square);
      }
    }

  }

  function onSquareClick(squareName, piece) {
    if (!app.roomId || !app.side || app.role !== 'player') return;
    if (app.turn !== app.side) return;

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
      btn.appendChild(createPieceNode(`${app.side}${p.toUpperCase()}`, 'promo-piece'));
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
        map.set(`${files[fileIdx]}${rank}`, `${color}${piece}`);
        fileIdx += 1;
      }
    }

    return map;
  }

  function createPieceNode(pieceKey, className) {
    if (className.includes('promo-piece')) {
      const promo = document.createElement('img');
      promo.className = className;
      promo.src = PIECE_IMAGES[pieceKey];
      promo.alt = pieceKey;
      promo.draggable = false;
      promo.onerror = () => {
        const fallback = document.createElement('span');
        fallback.className = `${className} piece-fallback`;
        fallback.textContent = PIECE_FALLBACK[pieceKey] || '?';
        promo.replaceWith(fallback);
      };
      return promo;
    }

    const wrap = document.createElement('div');
    wrap.className = className;

    const img = document.createElement('img');
    img.className = 'piece-glyph';
    img.src = PIECE_IMAGES[pieceKey];
    img.alt = pieceKey;
    img.draggable = false;
    img.onerror = () => {
      const fallback = document.createElement('div');
      fallback.className = 'piece-fallback';
      fallback.textContent = PIECE_FALLBACK[pieceKey] || '?';
      wrap.replaceChildren(fallback);
    };

    wrap.appendChild(img);
    return wrap;
  }

  function toRoleLabel(side) {
    if (side === 'w') return 'Player (White)';
    if (side === 'b') return 'Player (Black)';
    return 'Spectator';
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  socket.emit('requestRoomList');
  updateBoardFitFromViewport();
  window.addEventListener('resize', updateBoardFitFromViewport);
  window.addEventListener('orientationchange', () => {
    setTimeout(updateBoardFitFromViewport, 50);
  });
  window.addEventListener('load', () => {
    setTimeout(updateBoardFitFromViewport, 30);
  });
  setTimeout(updateBoardFitFromViewport, 80);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateBoardFitFromViewport);
    window.visualViewport.addEventListener('scroll', updateBoardFitFromViewport);
  }
  drawRoomList();
  drawBoard();
})();
