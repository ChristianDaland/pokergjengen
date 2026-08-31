const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Spilltilstand i minnet (eller hente fra fil/database)
let gameState = {
  host: 'Odd Christian',
  mode: "Texas Hold'em",
  phase: 'VENTING',
  communityCards: [],
  players: [],
  winner: null
};

// Statistikk-lagring i minnet
let stats = {}; 

io.on('connection', (socket) => {
  console.log('Ny tilkobling:', socket.id);

  // Send nåværende status umiddelbart når noen kobler seg til
  socket.emit('game_state', gameState);
  socket.emit('players_updated', gameState.players);

  // 1. HAÅNDTER NÅR SPILLERE BLIR MED VIA MOBIL
  socket.on('join_game', (data) => {
    const playerName = typeof data === 'string' ? data : data.name;
    
    // Sjekk om spilleren allerede eksisterer
    let existingPlayer = gameState.players.find(p => p.id === socket.id || p.name === playerName);
    
    if (!existingPlayer) {
      const newPlayer = {
        id: socket.id,
        name: playerName,
        points: 0,
        cards: []
      };
      gameState.players.push(newPlayer);
    }

    // Oppdater statistikk-oversikt hvis spilleren er ny
    if (!stats[playerName]) {
      stats[playerName] = { name: playerName, wins: 0 };
    }

    // KRITISK: Send oppdatert spillerliste til ALLE tilkoblede skjermer
    io.emit('players_updated', gameState.players);
    io.emit('game_state', gameState);
  });

  // 2. HÅNDTER STATISTIKK-FORESPØRSEL (Fikser "Laster...")
  socket.on('get_stats', () => {
    const statsArray = Object.values(stats);
    socket.emit('stats_data', statsArray);
  });

  // Håndter oppdatering av vert
  socket.on('update_info', (data) => {
    if (data.host) gameState.host = data.host;
    io.emit('game_state', gameState);
  });

  // Håndter start på ny runde
  socket.on('start_next_round', () => {
    gameState.phase = 'IGANG';
    // Eksempel på utdeling / nullstilling av runde-kort
    io.emit('game_state', gameState);
  });

  // Håndter bytte av spillmodus
  socket.on('toggle_game_mode', () => {
    gameState.mode = gameState.mode === "Texas Hold'em" ? 'Omaha' : "Texas Hold'em";
    io.emit('game_state', gameState);
  });

  // Håndter nullstilling
  socket.on('reset_game', () => {
    gameState.players = [];
    gameState.communityCards = [];
    gameState.winner = null;
    gameState.phase = 'VENTING';
    io.emit('game_state', gameState);
    io.emit('players_updated', gameState.players);
  });

  // Håndter at noen kobler fra
  socket.on('disconnect', () => {
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    io.emit('players_updated', gameState.players);
    io.emit('game_state', gameState);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server kjører på port ${PORT}`);
});