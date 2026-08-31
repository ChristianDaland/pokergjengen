const socket = io();

socket.on('state_update', (data) => {
  render(data);
});

function toggleMenu() {
  const menu = document.getElementById('dropdown-menu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

function startSession() {
  const hostName = document.getElementById('host-select').value;
  const gameMode = document.getElementById('mode-select').value;
  socket.emit('start_session', { hostName, gameMode });
}

function resetSession() {
  toggleMenu();
  socket.emit('reset_session');
}

function setGameMode(mode) {
  socket.emit('set_game_mode', mode);
}

function startNewHand() {
  socket.emit('start_new_hand');
}

function nextPhase() {
  socket.emit('next_phase');
}

function formatCardHTML(cardString) {
  if (!cardString || cardString.length < 2) return '';
  
  const value = cardString.slice(0, -1).replace('T', '10');
  const suit = cardString.slice(-1).toLowerCase();

  let symbol = suit;
  let color = 'white';

  if (suit === 's') { symbol = '♠'; color = '#f8fafc'; }
  if (suit === 'h') { symbol = '♥'; color = '#ef4444'; }
  if (suit === 'd') { symbol = '♦'; color = '#38bdf8'; }
  if (suit === 'c') { symbol = '♣'; color = '#22c55e'; }

  return `
    <div style="background: #ffffff; color: #0f172a; width: 50px; height: 75px; border-radius: 6px; display: inline-flex; flex-direction: column; justify-content: space-between; padding: 5px; font-weight: bold; border: 1px solid #cbd5e1; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
      <div style="text-align: left; font-size: 1rem; color: ${color === '#f8fafc' ? '#0f172a' : color};">${value}</div>
      <div style="text-align: center; font-size: 1.3rem; color: ${color === '#f8fafc' ? '#0f172a' : color};">${symbol}</div>
    </div>
  `;
}

function render(state) {
  const setupView = document.getElementById('setup-view');
  const boardView = document.getElementById('board-view');
  const phaseElem = document.getElementById('current-phase');

  // Vis enten Oppsett (QR-kode) eller Spillbord basert på om spillekvelden er startet
  if (!state.sessionStarted) {
    setupView.style.display = 'block';
    boardView.style.display = 'none';

    const lobbyElem = document.getElementById('lobby-players-list');
    if (state.players && state.players.length > 0) {
      lobbyElem.innerHTML = state.players.map(p => `
        <span style="display: inline-block; background: #334155; color: #22c55e; padding: 6px 12px; border-radius: 15px; margin: 4px; font-weight: bold; font-style: normal;">
          ✓ ${p.name}
        </span>
      `).join('');
    } else {
      lobbyElem.innerHTML = '<span style="color: #94a3b8; font-style: italic;">Ingen spillere har logget inn ennå...</span>';
    }

  } else {
    setupView.style.display = 'none';
    boardView.style.display = 'block';

    phaseElem.innerText = `${state.phase} (${state.gameMode})`;

    // Tegn felleskort
    const boardElem = document.getElementById('board-cards');
    if (state.board && state.board.length > 0) {
      boardElem.innerHTML = state.board.map(card => formatCardHTML(card)).join('');
    } else {
      boardElem.innerHTML = `<span style="color: #4ade80; font-style: italic;">Ingen kort på bordet...</span>`;
    }

    // Vinnermelding
    const winnerBox = document.getElementById('winner-box');
    if (state.winnerInfo) {
      winnerBox.style.display = 'block';
      winnerBox.innerHTML = `🏆 Vinner: <strong>${state.winnerInfo.winnerName}</strong> <br><small style="font-size: 1rem; font-weight: normal;">${state.winnerInfo.descr}</small>`;
    } else {
      winnerBox.style.display = 'none';
    }

    // Spillere rundt bordet
    const playersGrid = document.getElementById('players-grid');
    playersGrid.innerHTML = '';

    if (state.players && state.players.length > 0) {
      state.players.forEach(p => {
        const isFolded = p.folded;
        const cardsHTML = p.cards && p.cards.length > 0 
          ? p.cards.map(c => formatCardHTML(c)).join('')
          : `<span style="color: #64748b; font-size: 0.85rem;">[Skjulte kort]</span>`;

        playersGrid.innerHTML += `
          <div style="background: ${isFolded ? '#1e293b' : '#334155'}; border: 2px solid ${p.role ? '#ffd700' : '#475569'}; padding: 15px; border-radius: 10px; opacity: ${isFolded ? '0.5' : '1'}; text-align: center;">
            <div style="font-size: 0.8rem; color: #ffd700; font-weight: bold; min-height: 18px;">${p.role || ''}</div>
            <div style="font-size: 1.2rem; font-weight: bold; color: #f8fafc; margin: 4px 0;">${p.name}</div>
            <div style="font-size: 0.8rem; color: ${p.connected ? '#22c55e' : '#ef4444'}; margin-bottom: 6px;">
              ${p.connected ? '🟢 Tilkoblet' : '🔴 Frakoblet'}
            </div>
            <div style="display: flex; gap: 4px; justify-content: center;">${cardsHTML}</div>
          </div>
        `;
      });
    }
  }
}