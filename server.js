// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Initialiser Socket.io med CORS-støtte
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Server statiske filer fra rotmappen
app.use(express.static(__dirname));

// Eksplisitte routes for å forhindre "Cannot GET /"
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/mobile', (req, res) => {
  res.sendFile(path.join(__dirname, 'mobile.html'));
});

// Global tilstand for spillet
let players = {};
let gameState = {
  phase: 'VENTING', // VENTING, PRE-FLOP, FLOP, TURN, RIVER, SHOWDOWN
  pot: 0,
  communityCards: [],
  currentTurn: null
};

// Hjelpefunksjon for å sende oppdatert tilstand til alle klienter
function updateAll() {
  const playersArray = Object.values(players);
  io.emit('game_state_update', { gameState, players: playersArray });
  io.emit('state_update', { 
    ...gameState, 
    players: playersArray, 
    sessionStarted: gameState.phase !== 'VENTING' 
  });
}

// Socket.io tilkoblinger og hendelser
io.on('connection', (socket) => {
  // Send initial tilstand til ny tilkoblet mobil eller storskjerm
  updateAll();

  // Spiller blir med fra mobil
  socket.on('join_game', (data) => {
    // Håndter om data er en streng (f.eks. fra mobile.html) eller et objekt
    const name = typeof data === 'string' ? data : (data?.name || 'Anonym');

    players[socket.id] = {
      id: socket.id,
      name: name,
      points: 1000,
      cards: [],
      folded: false,
      isEliminated: false,
      connected: true
    };
    updateAll();
  });

  // Start nytt spill / runde fra storskjerm
  socket.on('start_game', () => {
    gameState.phase = 'PRE-FLOP';
    gameState.pot = 0;
    gameState.communityCards = [];

    // Tilbakestill spillere for ny runde
    Object.keys(players).forEach((id) => {
      players[id].folded = false;
      players[id].cards = [];
    });

    updateAll();
  });

  // Håndter neste fase i spillet
  socket.on('next_phase', (nextPhase) => {
    if (nextPhase) {
      gameState.phase = nextPhase;
    } else {
      const phases = ['VENTING', 'PRE-FLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN'];
      const currentIndex = phases.indexOf(gameState.phase);
      if (currentIndex < phases.length - 1) {
        gameState.phase = phases[currentIndex + 1];
      }
    }
    updateAll();
  });

  // Håndter kasting av kort fra mobil
  socket.on('player_fold', () => {
    if (players[socket.id]) {
      players[socket.id].folded = true;
      updateAll();
    }
  });

  // Spiller kobler fra
  socket.on('disconnect', () => {
    delete players[socket.id];
    updateAll();
  });
});

// Start serveren på angitt port (Render setter process.env.PORT automatisk)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server kjører på port ${PORT}`);
});