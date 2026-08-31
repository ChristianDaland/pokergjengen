const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Hand = require('pokersolver').Hand;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const SUITS = ['c', 'd', 'h', 's'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

function createDeck() {
  const deck = [];
  for (let s of SUITS) {
    for (let v of VALUES) {
      deck.push(v + s);
    }
  }
  return shuffle(deck);
}

function shuffle(array) {
  let deck = [...array];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function formatForSolver(card) {
  return card;
}

function translateHandDescription(descr) {
  let text = descr;
  text = text.replace(/\bT\b/g, '10');
  text = text.replace(/Straight Flush/g, 'Straight Flush');
  text = text.replace(/Four of a Kind/g, 'Fire like');
  text = text.replace(/Full House/g, 'Fullt Hus');
  text = text.replace(/Flush/g, 'Flush');
  text = text.replace(/Straight/g, 'Straight');
  text = text.replace(/Three of a Kind/g, 'Tre like');
  text = text.replace(/Two Pair/g, 'To Par');
  text = text.replace(/Pair/g, 'Ett Par');
  text = text.replace(/High Card/g, 'Høyt Kort');
  text = text.replace(/Spades/g, 'Spar');
  text = text.replace(/Hearts/g, 'Hjerter');
  text = text.replace(/Diamonds/g, 'Ruter');
  text = text.replace(/Clubs/g, 'Kløver');
  return text;
}

function evaluatePlayerHand(playerCards, boardCards, gameMode) {
  const formattedBoard = boardCards.map(formatForSolver);
  const formattedPlayer = playerCards.map(formatForSolver);

  if (gameMode === 'TEXAS') {
    const allCards = [...formattedPlayer, ...formattedBoard];
    return Hand.solve(allCards);
  } else {
    let bestHand = null;
    for (let i = 0; i < formattedPlayer.length; i++) {
      for (let j = i + 1; j < formattedPlayer.length; j++) {
        const hand2 = [formattedPlayer[i], formattedPlayer[j]];

        for (let b1 = 0; b1 < formattedBoard.length; b1++) {
          for (let b2 = b1 + 1; b2 < formattedBoard.length; b2++) {
            for (let b3 = b2 + 1; b3 < formattedBoard.length; b3++) {
              const board3 = [formattedBoard[b1], formattedBoard[b2], formattedBoard[b3]];
              const combo = Hand.solve([...hand2, ...board3]);
              
              if (!bestHand) {
                bestHand = combo;
              } else {
                const winner = Hand.winners([bestHand, combo]);
                if (winner.includes(combo) && !winner.includes(bestHand)) {
                  bestHand = combo;
                }
              }
            }
          }
        }
      }
    }
    return bestHand;
  }
}

let gameState = {
  sessionStarted: false,
  hostName: 'Odd Christian',
  gameMode: 'OMAHA',
  phase: 'VENTING',
  board: [],
  deck: [],
  winnerInfo: null,
  dealerIndex: 0
};

let players = {};
const disconnectTimeouts = {};

function addPlayerByName(name) {
  const cleanName = name ? name.trim() : 'Spiller';
  let existingKey = Object.keys(players).find(
    k => players[k].name.toLowerCase() === cleanName.toLowerCase()
  );

  if (!existingKey) {
    const seatNumber = Object.keys(players).length + 1;
    const fakeId = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    players[fakeId] = {
      id: fakeId,
      name: cleanName,
      seat: seatNumber,
      cards: [],
      folded: false,
      role: '',
      connected: true
    };
  }
}

function randomizePlayerSeats() {
  const playerArray = Object.values(players);
  if (playerArray.length <= 1) return;

  const shuffled = shuffle(playerArray);
  const newPlayersObj = {};

  shuffled.forEach((p, index) => {
    p.seat = index + 1;
    newPlayersObj[p.id] = p;
  });

  players = newPlayersObj;
  gameState.dealerIndex = 0;
}

function startNewHandLogic() {
  const playerList = Object.values(players);
  if (playerList.length === 0 || !gameState.gameMode) return;

  gameState.deck = createDeck();
  gameState.board = [];
  gameState.phase = 'PREFLOP';
  gameState.winnerInfo = null;

  gameState.dealerIndex = (gameState.dealerIndex + 1) % playerList.length;

  playerList.forEach((p, idx) => {
    p.folded = false;
    p.cards = [];
    
    const relativePos = (idx - gameState.dealerIndex + playerList.length) % playerList.length;

    if (playerList.length === 2) {
      p.role = relativePos === 0 ? 'Lilleblind' : 'Storeblind';
    } else {
      if (relativePos === 0) p.role = 'Dealer';
      else if (relativePos === 1) p.role = 'Lilleblind';
      else if (relativePos === 2) p.role = 'Storeblind';
      else p.role = '';
    }
    
    const cardCount = gameState.gameMode === 'OMAHA' ? 4 : 2;
    for (let i = 0; i < cardCount; i++) {
      p.cards.push(gameState.deck.pop());
    }
  });
}

io.on('connection', (socket) => {

  // Støtte for mobil-event "playerJoined"
  socket.on('playerJoined', (data) => {
    if (data && data.playerName) {
      addPlayerByName(data.playerName);
      updateAll();
    }
  });

  socket.on('join_game', (name) => {
    addPlayerByName(name);
    updateAll();
  });

  socket.on('start_session', (data) => {
    gameState.sessionStarted = true;
    if (data && data.hostName) gameState.hostName = data.hostName;
    if (data && data.gameMode) gameState.gameMode = data.gameMode;
    randomizePlayerSeats();
    updateAll();
  });

  socket.on('reset_session', () => {
    gameState.sessionStarted = false;
    gameState.phase = 'VENTING';
    gameState.board = [];
    gameState.winnerInfo = null;
    players = {};
    updateAll();
  });

  socket.on('set_game_mode', (mode) => {
    gameState.gameMode = mode;
    randomizePlayerSeats();
    updateAll();
  });

  socket.on('start_new_hand', () => {
    startNewHandLogic();
    updateAll();
  });

  socket.on('next_phase', () => {
    const activePlayers = Object.values(players).filter(p => !p.folded);

    if (gameState.phase === 'FINISHED' || gameState.phase === 'SHOWDOWN') {
      startNewHandLogic();
      updateAll();
      return;
    }

    if (activePlayers.length === 1 && gameState.phase !== 'VENTING') {
      gameState.phase = 'FINISHED';
      gameState.winnerInfo = {
        winnerName: activePlayers[0].name,
        descr: 'Alle andre kastet seg',
        foldedWin: true
      };
      updateAll();
      return;
    }

    if (gameState.phase === 'PREFLOP') {
      gameState.phase = 'FLOP';
      gameState.board = [gameState.deck.pop(), gameState.deck.pop(), gameState.deck.pop()];
    } else if (gameState.phase === 'FLOP') {
      gameState.phase = 'TURN';
      gameState.board.push(gameState.deck.pop());
    } else if (gameState.phase === 'TURN') {
      gameState.phase = 'RIVER';
      gameState.board.push(gameState.deck.pop());
    } else if (gameState.phase === 'RIVER') {
      gameState.phase = 'SHOWDOWN';
      
      const solvedHands = activePlayers.map(p => ({
        player: p,
        solved: evaluatePlayerHand(p.cards, gameState.board, gameState.gameMode)
      }));

      const handsOnly = solvedHands.map(sh => sh.solved);
      const winningHands = Hand.winners(handsOnly);
      
      const winners = solvedHands.filter(sh => winningHands.includes(sh.solved));
      
      let winnerText = '';
      if (winners.length > 1) {
        const names = winners.map(w => w.player.name).join(' & ');
        winnerText = `UAVGJOERT / DELING: ${names}`;
      } else {
        winnerText = winners[0].player.name;
      }

      const rawDescr = winners[0] ? winners[0].solved.descr : 'Ukjent hånd';

      gameState.winnerInfo = {
        winnerName: winnerText,
        descr: translateHandDescription(rawDescr),
        foldedWin: false
      };
    }
    updateAll();
  });

  // Send initial-tilstand ved tilkobling
  socket.emit('state_update', buildStatePayload());
});

function buildStatePayload() {
  const playerList = Object.values(players);
  const showCardsOnScreen = gameState.phase === 'SHOWDOWN' && 
                            gameState.winnerInfo && 
                            !gameState.winnerInfo.foldedWin;

  return {
    sessionStarted: gameState.sessionStarted,
    hostName: gameState.hostName,
    gameMode: gameState.gameMode,
    phase: gameState.phase,
    board: gameState.board,
    winnerInfo: gameState.winnerInfo,
    players: playerList.map(p => ({
      name: p.name,
      seat: p.seat,
      role: p.role,
      folded: p.folded,
      connected: p.connected,
      cards: showCardsOnScreen && !p.folded ? p.cards : []
    }))
  };
}

function updateAll() {
  io.emit('state_update', buildStatePayload());
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server kjører på port ${PORT}`));