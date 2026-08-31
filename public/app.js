const socket = io();

// Mottagelse av full spilletilstand fra server.js
socket.on('state_update', (data) => {
  renderGame(data);
});

// Sett spillemodus (TEXAS eller OMAHA)
function setGameMode(mode) {
  socket.emit('set_game_mode', mode);
}

// Start ny hånd og del ut kort internt på serveren
function startNewHand() {
  socket.emit('start_new_hand');
}

// Bla videre til neste fase (PREFLOP -> FLOP -> TURN -> RIVER -> SHOWDOWN)
function nextPhase() {
  socket.emit('next_phase');
}

// Kast en spiller sin hånd (hvis verten trykker kasting for noen)
function foldPlayer() {
  socket.emit('player_fold');
}

// Hjelpefunksjon for å vise fine kortfarger
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
    <div style="background: #ffffff; color: #0f172a; width: 55px; height: 80px; border-radius: 6px; display: inline-flex; flex-direction: column; justify-content: space-between; padding: 5px; font-weight: bold; border: 1px solid #cbd5e1; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
      <div style="text-align: left; font-size: 1.1rem; color: ${color === '#f8fafc' ? '#0f172a' : color};">${value}</div>
      <div style="text-align: center; font-size: 1.4rem; color: ${color === '#f8fafc' ? '#0f172a' : color};">${symbol}</div>
    </div>
  `;
}

// Tegner opp alt på hovedskjermen
function renderGame(state) {
  // 1. Oppdater fase og modus
  const phaseElem = document.getElementById('current-phase');
  const modeText = state.gameMode ? ` (${state.gameMode})` : '';
  phaseElem.innerText = `${state.phase}${modeText}`;

  // 2. Tegn felleskort (Board)
  const boardElem = document.getElementById('board-cards');
  if (state.board && state.board.length > 0) {
    boardElem.innerHTML = state.board.map(card => formatCardHTML(card)).join('');
  } else {
    boardElem.innerHTML = `<span style="color: #4ade80; font-style: italic;">Ingen kort på bordet...</span>`;
  }

  // 3. Vinnermelding / Showdown display
  const winnerBox = document.getElementById('winner-box');
  if (state.winnerInfo) {
    winnerBox.style.display = 'block';
    winnerBox.innerHTML = `🏆 Vinner: <strong>${state.winnerInfo.winnerName}</strong> <br><small style="font-size: 1rem; font-weight: normal;">${state.winnerInfo.descr}</small>`;
  } else {
    winnerBox.style.display = 'none';
  }

  // 4. Tegn opp spillere
  const playersGrid = document.getElementById('players-grid');
  playersGrid.innerHTML = '';

  if (!state.players || state.players.length === 0) {
    playersGrid.innerHTML = `<div style="color: #94a3b8; grid-column: 1/-1;">Ingen spillere har logget inn fra mobil enda...</div>`;
    return;
  }

  state.players.forEach(p => {
    const isFolded = p.folded;
    const cardsHTML = p.cards && p.cards.length > 0 
      ? p.cards.map(c => formatCardHTML(c)).join('')
      : `<span style="color: #64748b; font-size: 0.85rem;">[Skjulte kort]</span>`;

    const cardContainer = `<div style="display: flex; gap: 5px; justify-content: center; margin-top: 10px;">${cardsHTML}</div>`;

    playersGrid.innerHTML += `
      <div style="background: ${isFolded ? '#1e293b' : '#334155'}; border: 2px solid ${p.role ? '#ffd700' : '#475569'}; padding: 15px; border-radius: 10px; opacity: ${isFolded ? '0.5' : '1'}; text-align: center;">
        <div style="font-size: 0.8rem; color: #ffd700; font-weight: bold; min-height: 18px;">${p.role || ''}</div>
        <div style="font-size: 1.2rem; font-weight: bold; color: #f8fafc; margin: 4px 0;">${p.name}</div>
        <div style="font-size: 0.8rem; color: ${p.connected ? '#22c55e' : '#ef4444'};">
          ${p.connected ? '🟢 Tilkoblet' : '🔴 Frakoblet'} ${isFolded ? '(Kastet)' : ''}
        </div>
        ${cardContainer}
      </div>
    `;
  });
}