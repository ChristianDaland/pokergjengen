const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const FIXED_PLAYERS = ['Kai', 'Ronny', 'Einar', 'Joakim', 'Odd Christian'];

let session = {
  active: false,
  date: new Date().toISOString().split('T')[0],
  host: 'Odd Christian',
  mode: "Texas Hold'em",
  presentPlayers: [...FIXED_PLAYERS],
  notes: '',
  round: 1,
  phase: 'PRE_GAME' // PRE_GAME, ACTIVE_GAME, POST_ROUND
};

let deck = [];
let gameState = {
  communityCards: [],
  players: [], // { name, active, eliminated, rank, points, totalPoints, cards }
  roundEliminatedCount: 0
};

let history = []; // Lagrede sesjoner
let top10AllTime = [];

function createDeck() {
  const suits = ['h', 'd', 'c', 's'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  let d = [];
  for (let s of suits) {
    for (let v of values) d.push(v + s);
  }
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

io.on('connection', (socket) => {
  socket.emit('session_update', session);
  socket.emit('game_state', gameState);

  // Pre-Game Setup
  socket.on('setup_session', (data) => {
    session.host = data.host;
    session.mode = data.mode;
    session.presentPlayers = data.presentPlayers;
    session.notes = data.notes;
    io.emit('session_update', session);
  });

  socket.on('start_spillekveld', () => {
    session.active = true;
    session.phase = 'ACTIVE_GAME';
    session.round = 1;

    deck = createDeck();
    gameState.communityCards = [];
    gameState.roundEliminatedCount = 0;
    gameState.players = session.presentPlayers.map(name => ({
      name,
      active: true,
      eliminated: false,
      rank: null,
      points: 0,
      totalPoints: 0,
      cards: []
    }));

    // Del ut kort
    const cardsCount = session.mode === 'Omaha' ? 4 : 2;
    gameState.players.forEach(p => {
      p.cards = [deck.pop(), deck.pop()];
      if (cardsCount === 4) p.cards.push(deck.pop(), deck.pop());
    });

    io.emit('session_update', session);
    io.emit('game_state', gameState);
  });

  // Vippebryter (Slå ut / gjeninnsett spiller)
  socket.on('toggle_player_status', (playerName) => {
    let player = gameState.players.find(p => p.name === playerName);
    if (!player) return;

    if (!player.eliminated) {
      // Slå ut spiller -> tildel laveste ledige plassering
      player.eliminated = true;
      player.active = false;
      const rankAssigned = gameState.players.length - gameState.roundEliminatedCount;
      player.rank = rankAssigned;
      gameState.roundEliminatedCount++;

      // Poengskala: 1.plass=10, 2.=6, 3.=2, 4.=1, 5.=0
      const pointTable = { 1: 10, 2: 6, 3: 2, 4: 1, 5: 0 };
      player.points = pointTable[rankAssigned] || 0;
      player.totalPoints += player.points;
    } else {
      // Vipp tilbake til grønn (Feilretting)
      player.eliminated = false;
      player.active = true;
      player.totalPoints -= player.points;
      player.points = 0;
      player.rank = null;
      gameState.roundEliminatedCount--;
    }

    // Sjekk om kun 1 spiller står igjen (Siste er vinner)
    const activePlayers = gameState.players.filter(p => !p.eliminated);
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      winner.rank = 1;
      winner.points = 10;
      winner.totalPoints += 10;
      session.phase = 'POST_ROUND';
    }

    io.emit('session_update', session);
    io.emit('game_state', gameState);
  });

  // Åpne neste kort på bordet
  socket.on('next_community_card', () => {
    if (gameState.communityCards.length === 0) {
      gameState.communityCards.push(deck.pop(), deck.pop(), deck.pop()); // Flop
    } else if (gameState.communityCards.length < 5) {
      gameState.communityCards.push(deck.pop()); // Turn / River
    }
    io.emit('game_state', gameState);
  });

  // Start neste omgang
  socket.on('next_round', () => {
    session.round++;
    session.phase = 'ACTIVE_GAME';
    deck = createDeck();
    gameState.communityCards = [];
    gameState.roundEliminatedCount = 0;

    const cardsCount = session.mode === 'Omaha' ? 4 : 2;
    gameState.players.forEach(p => {
      p.eliminated = false;
      p.active = true;
      p.rank = null;
      p.points = 0;
      p.cards = [];
      for (let i = 0; i < cardsCount; i++) p.cards.push(deck.pop());
    });

    io.emit('session_update', session);
    io.emit('game_state', gameState);
  });

  // Eksporter CSV-data
  socket.on('export_csv', () => {
    let csv = "SessionDate,Year,Month,Host,Player,Round,Rank,Points\n";
    history.forEach(s => {
      const year = s.date.split('-')[0];
      const month = s.date.split('-')[1];
      s.players.forEach(p => {
        csv += `${s.date},${year},${month},${s.host},${p.name},${s.round},${p.rank || ''},${p.totalPoints}\n`;
      });
    });
    socket.emit('csv_data', csv);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server kjører på port ${PORT}`));