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
  const colorSelect = document.getElementById('colorSelect');
  const joinBtn = document.getElementById('joinBtn');
  const newGameBtn = document.getElementById('newGameBtn');

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
    turn: 'w',
    fen: '8/8/8/8/8/8/8/8 w - - 0 1',
    selected: null,
    legalMoves: [],
    pendingTarget: null,
    connected: false,
    status: 'Not connected'
  };

  joinBtn.addEventListener('click', () => {
    const roomId = roomInput.value.trim();
    const name = nameInput.value.trim() || 'Guest';
    const pref = colorSelect.value;
    errorText.textContent = '';

    socket.emit('joinRoom', {
      roomId,
      name,
      preferredSide: pref === 'auto' ? null : pref
    });
  });

  newGameBtn.addEventListener('click', () => {
    if (!app.connected) return;
    socket.emit('resetGame');
  });

  socket.on('connect', () => {
    app.connected = true;
    stateText.textContent = 'Connected. Join a room.';
  });

  socket.on('disconnect', () => {
    app.connected = false;
    stateText.textContent = 'Disconnected from server.';
  });

  socket.on('joined', ({ roomId, side }) => {
    app.roomId = roomId;
    app.side = side;
    roomText.textContent = `Room: ${roomId}`;
    roleText.textContent = `Role: ${toRoleLabel(side)}`;
    errorText.textContent = '';
  });

  socket.on('gameState', (state) => {
    app.fen = state.fen;
    app.turn = state.turn;
    app.status = state.status;
    app.selected = null;
    app.legalMoves = [];

    turnText.textContent = `Turn: ${state.turn === 'w' ? 'White' : 'Black'}`;
    stateText.textContent = state.status;
    ruleText.textContent = `White: ${state.players.white} | Black: ${state.players.black} | Spectators: ${state.spectators}`;

    drawBoard();
  });

  socket.on('legalMoves', ({ from, moves }) => {
    if (!app.selected || app.selected !== from) return;
    app.legalMoves = moves;
    drawBoard();
  });

  socket.on('errorMsg', (msg) => {
    errorText.textContent = msg;
  });

  function drawBoard() {
    boardEl.innerHTML = '';
    const pieceBySquare = parseFenPieces(app.fen);

    for (let rank = 8; rank >= 1; rank -= 1) {
      for (let fileIdx = 0; fileIdx < 8; fileIdx += 1) {
        const file = files[fileIdx];
        const squareName = `${file}${rank}`;
        const row = 8 - rank;
        const col = fileIdx;

        const square = document.createElement('button');
        square.className = `square ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
        square.dataset.square = squareName;

        if (app.selected === squareName) {
          square.classList.add('selected');
        }

        const legal = app.legalMoves.find((m) => m.to === squareName);
        if (legal) {
          if (legal.flags.includes('c') || legal.flags.includes('e')) {
            square.classList.add('capture');
          } else {
            square.classList.add('legal');
          }
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
    const fromRank = Number(app.selected[1]);
    const toRank = Number(toSquare[1]);
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

  drawBoard();
})();
