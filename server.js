const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let gameState = {
  host: 'Odd Christian',
  mode: "Texas Hold'em",
  phase: 'VENTING',
  communityCards: [],
  players: [],
  winner: null
};

let stats = {}; 

// Funksjon for å lage og stokke en kortstokk
function createDeck() {
  const suits = ['h', 'd', 'c', 's'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  let deck = [];
  for (let s of suits) {
    for (let v of values) {
      deck.push(v + s);
    }
  }
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

io.on('connection', (socket) => {
  console.log('Ny tilkobling:', socket.id);

  socket.emit('game_state', gameState);
  socket.emit('players_updated', gameState.players);

  // 1. Spiller blir med
  socket.on('join_game', (data) => {
    const playerName = typeof data === 'string' ? data : data.name;
    
    let existingPlayer = gameState.players.find(p => p.name === playerName);
    
    if (existingPlayer) {
      existingPlayer.id = socket.id; // Oppdater socket-ID dersom de resetter tilkoblingen
    } else {
      gameState.players.push({
        id: socket.id,
        name: playerName,
        points: 0,
        cards: []
      });
    }

    if (!stats[playerName]) {
      stats[playerName] = { name: playerName, wins: 0 };
    }

    io.emit('players_updated', gameState.players);
    io.emit('game_state', gameState);
  });

  // 2. Start ny runde & del ut kort
  socket.on('start_next_round', () => {
    if (gameState.players.length === 0) return;

    const deck = createDeck();
    gameState.phase = 'IGANG';
    gameState.winner = null;
    gameState.communityCards = [];

    // Del ut 2 kort til hver spiller
    const cardsPerPlayer = gameState.mode === 'Omaha' ? 4 : 2;

    gameState.players.forEach(player => {
      player.cards = [];
      for (let i = 0; i < cardsPerPlayer; i++) {
        player.cards.push(deck.pop());
      }
      // Send korta privat kun til denne spillerens mobil/socket
      io.to(player.id).emit('your_cards', player.cards);
    });

    // Del ut felleskort på bordet (5 kort)
    for (let i = 0; i < 5; i++) {
      gameState.communityCards.push(deck.pop());
    }

    // Send oppdatert tilstand til alle skjermer
    io.emit('game_state', gameState);
    io.emit('players_updated', gameState.players);
  });

  // 3. Håndter statistikk
  socket.on('get_stats', () => {
    const statsArray = Object.values(stats);
    socket.emit('stats_data', statsArray);
  });

  // 4. Oppdater vert
  socket.on('update_info', (data) => {
    if (data.host) gameState.host = data.host;
    io.emit('game_state', gameState);
  });

  // 5. Bytt spillmodus
  socket.on('toggle_game_mode', () => {
    gameState.mode = gameState.mode === "Texas Hold'em" ? 'Omaha' : "Texas Hold'em";
    io.emit('game_state', gameState);
  });

  // 6. Nullstill spill
  socket.on('reset_game', () => {
    gameState.players = [];
    gameState.communityCards = [];
    gameState.winner = null;
    gameState.phase = 'VENTING';
    io.emit('game_state', gameState);
    io.emit('players_updated', gameState.players);
  });

  socket.on('disconnect', () => {
    console.log('Spiller koblet fra:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server kjører på port ${PORT}`));