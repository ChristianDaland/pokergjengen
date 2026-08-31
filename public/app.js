// Tilkobl til WebSocket / Socket.io server
const socket = io();

// Globale variabler for aktiv sesjon og historikk
let connectedPlayers = [];
let activeSession = null;
let currentRoundGameType = localStorage.getItem('defaultGameType') || 'Omaha';
let eliminatedOrder = []; // Rekkefølge på utslåtte spillere
let playerHands = {};     // Skannede/tastede hender per spiller
let boardCards = "";      // Felleskort på bordet
let historicalSessions = []; // Lagrede spillekvelder for Topp 10 & Eksport

// Poengskala per omgang (5-spillers arrangement)
const pointScale = [10, 6, 2, 1, 0];

// Hamburgermenystyring
const menuToggleBtn = document.getElementById('menu-toggle-btn');
const closeMenuBtn = document.getElementById('close-menu-btn');
const sideMenu = document.getElementById('side-menu');

menuToggleBtn.addEventListener('click', () => {
  sideMenu.classList.remove('hidden');
});

closeMenuBtn.addEventListener('click', () => {
  sideMenu.classList.add('hidden');
});

// Modal-håndtering
function openModal(modalId) {
  sideMenu.classList.add('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById(modalId).classList.remove('hidden');

  // Oppdater innhold i modaler ved åpning
  if (modalId === 'top10-modal') {
    renderTop10();
  } else if (modalId === 'notes-modal') {
    syncNotesModal();
  }
}

function closeAllModals() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

// Innstillinger for standard pokertype og dynamisk QR-kode generering
document.addEventListener('DOMContentLoaded', () => {
  const defaultType = localStorage.getItem('defaultGameType') || 'Omaha';
  const selectElem = document.getElementById('default-game-type');
  if (selectElem) selectElem.value = defaultType;
  
  const pregameSelect = document.getElementById('game-type-select');
  if (pregameSelect) pregameSelect.value = defaultType;

  // Generer QR-kode automatisk basert på nåværende domene/adresse
  const qrContainer = document.getElementById('qrcode');
  if (qrContainer) {
    const mobileUrl = `${window.location.origin}/mobile.html`;
    new QRCode(qrContainer, {
      text: mobileUrl,
      width: 140,
      height: 140,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  }
});

function saveDefaultGameType(value) {
  localStorage.setItem('defaultGameType', value);
}

// Mottak av spillere som logger inn via mobil
socket.on('playerJoined', (data) => {
  if (!connectedPlayers.includes(data.playerName)) {
    connectedPlayers.push(data.playerName);
    renderConnectedPlayers();
  }
});

// Mottak av skannede kort fra mobilen
socket.on('cardsScanned', (data) => {
  if (data.playerName && data.cards) {
    const cardString = Array.isArray(data.cards) ? data.cards.join(' ') : data.cards;
    playerHands[data.playerName] = cardString;
    
    const inputElem = document.getElementById(`hand-${data.playerName}`);
    if (inputElem) inputElem.value = cardString;
  }
});

// Tegn ut tilkoblede spillere i Pre-Game
function renderConnectedPlayers() {
  const container = document.getElementById('connected-players-list');
  const startBtn = document.getElementById('start-game-btn');

  if (connectedPlayers.length === 0) {
    container.innerHTML = `<span class="no-players-msg">Ingen spillere har logget inn ennå...</span>`;
    startBtn.disabled = true;
    return;
  }

  container.innerHTML = connectedPlayers.map(player => `
    <span class="player-chip">✓ ${player}</span>
  `).join('');

  startBtn.disabled = false;
}

// Start Spillekveld (Overgang fra Fase 1 til Fase 2)
function startSpillekveld() {
  const host = document.getElementById('host-select').value;
  const gameTypeSelect = document.getElementById('game-type-select').value;
  const notes = document.getElementById('pregame-notes').value;

  if (!host) {
    alert('Vennligst velg kveldens vert!');
    return;
  }

  currentRoundGameType = gameTypeSelect;

  activeSession = {
    date: new Date().toISOString().split('T')[0],
    host: host,
    notes: notes,
    players: [...connectedPlayers],
    currentRound: 1,
    rounds: []
  };

  socket.emit('startSession', activeSession);

  switchPhase('phase-activegame');
  initActiveGamePhase();
}

// Bytte av pokertype per omgang i Fase 2
function setRoundGameType(type) {
  currentRoundGameType = type;
  document.getElementById('btn-mode-omaha').classList.toggle('active', type === 'Omaha');
  document.getElementById('btn-mode-texas').classList.toggle('active', type === "Texas Hold'em");
}

function updateBoardCards(val) {
  boardCards = val.trim();
}

function updatePlayerHand(player, val) {
  playerHands[player] = val.trim();
}

// Generer spillerrutenett ved start av Fase 2
function initActiveGamePhase() {
  document.getElementById('current-round-num').innerText = activeSession.currentRound;
  setRoundGameType(currentRoundGameType);
  eliminatedOrder = [];
  playerHands = {};
  boardCards = "";
  
  const boardInput = document.getElementById('board-cards-input');
  if (boardInput) boardInput.value = "";

  const grid = document.getElementById('active-players-grid');
  grid.innerHTML = activeSession.players.map(player => `
    <div class="player-status-card" id="card-${player}">
      <div class="player-name">${player}</div>
      <div class="switch-container">
        <span class="status-label" id="label-${player}">Aktiv</span>
        <label class="switch">
          <input type="checkbox" onchange="togglePlayerEliminated('${player}', this.checked)">
          <span class="slider"></span>
        </label>
      </div>
      <div class="hand-input-box">
        <input type="text" id="hand-${player}" placeholder="Hånd (f.eks. Ah Kd)" onchange="updatePlayerHand('${player}', this.value)">
      </div>
    </div>
  `).join('');
}

// Utslåing via vippebryter
function togglePlayerEliminated(player, isEliminated) {
  const card = document.getElementById(`card-${player}`);
  const label = document.getElementById(`label-${player}`);

  if (isEliminated) {
    card.classList.add('eliminated');
    label.innerText = 'Utslått';
    if (!eliminatedOrder.includes(player)) {
      eliminatedOrder.push(player);
    }
  } else {
    card.classList.remove('eliminated');
    label.innerText = 'Aktiv';
    eliminatedOrder = eliminatedOrder.filter(p => p !== player);
  }
}

// Solve hand via pokersolver
function solveHand(cardsArray) {
  try {
    if (typeof Hand !== 'undefined' && cardsArray.length >= 5) {
      return Hand.solve(cardsArray);
    }
  } catch (e) {
    console.warn("Klarte ikke evaluere hånd:", e);
  }
  return null;
}

// Avslutt omgang
function finishRound() {
  const activePlayers = activeSession.players.filter(p => !eliminatedOrder.includes(p));
  const boardArray = boardCards ? boardCards.split(' ').filter(c => c) : [];

  let activePlayerResults = [];

  if (boardArray.length >= 3 && typeof Hand !== 'undefined') {
    let evaluatedHands = [];

    activePlayers.forEach(player => {
      const pCards = playerHands[player] ? playerHands[player].split(' ').filter(c => c) : [];
      const totalCards = [...pCards, ...boardArray];
      
      if (totalCards.length >= 5) {
        const solved = solveHand(totalCards);
        evaluatedHands.push({
          player: player,
          solved: solved,
          handName: solved ? solved.name + " (" + solved.descr + ")" : "Ukjent hånd"
        });
      } else {
        evaluatedHands.push({ player: player, solved: null, handName: "Kort mangler" });
      }
    });

    evaluatedHands.sort((a, b) => {
      if (a.solved && b.solved) {
        const winners = Hand.winners([a.solved, b.solved]);
        if (winners.length === 1 && winners[0] === a.solved) return -1;
        if (winners.length === 1 && winners[0] === b.solved) return 1;
      }
      return 0;
    });

    activePlayerResults = evaluatedHands;
  } else {
    activePlayerResults = activePlayers.map(player => ({
      player: player,
      solved: null,
      handName: "Vant uten showdown (Folded)"
    }));
  }

  const roundRanking = [
    ...activePlayerResults.map(p => p.player),
    ...[...eliminatedOrder].reverse()
  ];

  const roundResults = roundRanking.map((player, index) => {
    const activeInfo = activePlayerResults.find(p => p.player === player);
    return {
      player: player,
      rank: index + 1,
      points: pointScale[index] || 0,
      handDescription: activeInfo ? activeInfo.handName : "Utslått underveis"
    };
  });

  const roundData = {
    roundNumber: activeSession.currentRound,
    gameType: currentRoundGameType,
    board: boardCards,
    results: roundResults
  };

  activeSession.rounds.push(roundData);

  // Vis resultat i Fase 3
  document.getElementById('post-round-num').innerText = activeSession.currentRound;
  document.getElementById('post-round-gametype').innerText = `Modus: ${currentRoundGameType}`;
  document.getElementById('post-round-board').innerText = boardCards ? `Felleskort: ${boardCards}` : "Ingen felleskort registrert";
  
  const resultsContainer = document.getElementById('round-results-list');
  resultsContainer.innerHTML = roundResults.map(r => `
    <div class="result-row ${r.rank === 1 ? 'winner' : ''}">
      <span class="result-rank">${r.rank}. plass</span>
      <div class="result-player-info">
        <span><strong>${r.player}</strong></span>
        <span class="hand-description">${r.handDescription}</span>
      </div>
      <span class="result-points">+${r.points} p</span>
    </div>
  `).join('');

  switchPhase('phase-postround');
}

// Neste omgang
function nextRound() {
  activeSession.currentRound += 1;
  switchPhase('phase-activegame');
  initActiveGamePhase();
}

// Fasestyring
function switchPhase(phaseId) {
  document.querySelectorAll('.phase-section').forEach(sec => {
    sec.classList.remove('active-phase');
    sec.classList.add('hidden');
  });

  const targetPhase = document.getElementById(phaseId);
  targetPhase.classList.remove('hidden');
  targetPhase.classList.add('active-phase');
}

/* --- HAMBURGERMENY FUNKSJONER --- */

// 1. Topp 10 Hall of Fame
function renderTop10() {
  const container = document.getElementById('top10-content');
  
  // Aggreger poeng per spiller
  const totals = {};
  
  // Inkluder historiske sesjoner pluss nåværende aktive sesjon
  const allSessions = [...historicalSessions];
  if (activeSession) allSessions.push(activeSession);

  allSessions.forEach(session => {
    session.rounds.forEach(round => {
      round.results.forEach(res => {
        if (!totals[res.player]) {
          totals[res.player] = { points: 0, wins: 0, roundsPlayed: 0 };
        }
        totals[res.player].points += res.points;
        totals[res.player].roundsPlayed += 1;
        if (res.rank === 1) totals[res.player].wins += 1;
      });
    });
  });

  const sorted = Object.keys(totals)
    .map(player => ({ player, ...totals[player] }))
    .sort((a, b) => b.points - a.points);

  let html = "";

  if (sorted.length === 0) {
    html = `<p style="color:#94a3b8; font-style:italic;">Ingen omganger er registrert ennå.</p>`;
  } else {
    html = `
      <table class="hall-of-fame-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Spiller</th>
            <th>Omganger</th>
            <th>Seire</th>
            <th>Poeng</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((item, idx) => `
            <tr class="${idx === 0 ? 'leader' : ''}">
              <td>${idx + 1}</td>
              <td><strong>${item.player}</strong></td>
              <td>${item.roundsPlayed}</td>
              <td>🏆 ${item.wins}</td>
              <td class="points-col">${item.points} p</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  container.innerHTML = html;
}

// 2. Kveldsnotater / Dagbok
function syncNotesModal() {
  const textarea = document.getElementById('modal-notes');
  if (activeSession) {
    textarea.value = activeSession.notes || "";
  } else {
    textarea.value = document.getElementById('pregame-notes').value || "";
  }
}

function saveNotesFromModal() {
  const val = document.getElementById('modal-notes').value;
  if (activeSession) {
    activeSession.notes = val;
  }
  document.getElementById('pregame-notes').value = val;
  closeAllModals();
}

// 3. Eksport av Data til CSV/Excel
function exportToCSV() {
  const allSessions = [...historicalSessions];
  if (activeSession) allSessions.push(activeSession);

  if (allSessions.length === 0) {
    alert("Ingen data å eksportere ennå!");
    return;
  }

  let csvRows = [];
  csvRows.push(["Dato", "Vert", "Omgang", "Pokertype", "Plassering", "Spiller", "Poeng", "Hånd/Beskrivelse", "Kveldsnotater"]);

  allSessions.forEach(session => {
    session.rounds.forEach(round => {
      round.results.forEach(res => {
        csvRows.push([
          `"${session.date}"`,
          `"${session.host}"`,
          round.roundNumber,
          `"${round.gameType}"`,
          res.rank,
          `"${res.player}"`,
          res.points,
          `"${res.handDescription.replace(/"/g, '""')}"`,
          `"${(session.notes || '').replace(/"/g, '""')}"`
        ]);
      });
    });
  });

  const csvString = csvRows.map(e => e.join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `loland_poker_export_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}