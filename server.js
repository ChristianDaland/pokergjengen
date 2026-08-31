const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let fullDeck = [];
let gameState = {
  host: 'Odd Christian',
  mode: "Texas Hold'em",
  phase: 'VENTING', // VENTING, PREFLOP, FLOP, TURN, RIVER, SHOWDOWN
  communityCards: [],
  players: [],
  winner: null
};

let stats = {}; 

function createDeck() {
  const suits = ['h', 'd', 'c', 's'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  let deck = [];
  for (let s of suits) {
    for (let v of values) {
      deck.push(v + s);
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

io.on('connection', (socket) => {
  socket.emit('game_state', gameState);
  socket.emit('players_updated', gameState.players);

  socket.on('join_game', (data) => {
    const playerName = typeof data === 'string' ? data : data.name;
    let existingPlayer = gameState.players.find(p => p.name === playerName);
    
    if (existingPlayer) {
      existingPlayer.id = socket.id;
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

  // Start ny runde / Del ut spillerkort (Preflop)
  socket.on('start_next_round', () => {
    if (gameState.players.length === 0) return;

    fullDeck = createDeck();
    gameState.phase = 'PREFLOP';
    gameState.winner = null;
    gameState.communityCards = [];

    const cardsPerPlayer = gameState.mode === 'Omaha' ? 4 : 2;

    gameState.players.forEach(player => {
      player.cards = [];
      for (let i = 0; i < cardsPerPlayer; i++) {
        player.cards.push(fullDeck.pop());
      }
      io.to(player.id).emit('your_cards', player.cards);
    });

    io.emit('game_state', gameState);
    io.emit('players_updated', gameState.players);
  });

  // Neste steg i bordet (Flop -> Turn -> River)
  socket.on('next_phase', () => {
    if (gameState.phase === 'PREFLOP') {
      // Del ut 3 kort (Flop)
      gameState.communityCards.push(fullDeck.pop(), fullDeck.pop(), fullDeck.pop());
      gameState.phase = 'FLOP';
    } else if (gameState.phase === 'FLOP') {
      // Del ut 4. kort (Turn)
      gameState.communityCards.push(fullDeck.pop());
      gameState.phase = 'TURN';
    } else if (gameState.phase === 'TURN') {
      // Del ut 5. kort (River)
      gameState.communityCards.push(fullDeck.pop());
      gameState.phase = 'RIVER';
    }

    io.emit('game_state', gameState);
  });

  socket.on('toggle_game_mode', () => {
    gameState.mode = gameState.mode === "Texas Hold'em" ? 'Omaha' : "Texas Hold'em";
    io.emit('game_state', gameState);
  });

  socket.on('reset_game', () => {
    gameState.players = [];
    gameState.communityCards = [];
    gameState.winner = null;
    gameState.phase = 'VENTING';
    io.emit('game_state', gameState);
    io.emit('players_updated', gameState.players);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server kjører på port ${PORT}`));