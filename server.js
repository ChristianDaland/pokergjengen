const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Hand = require('pokersolver').Hand;
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- POSTGRESQL DATABASE KOBLING ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const DEFAULT_PLAYERS = ['Einar', 'Kai', 'Ronny', 'Joakim', 'Odd Christian'];

async function initDB() {
  try {
    // 1. Tabell for hånd-historikk
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hand_history (
        id SERIAL PRIMARY KEY,
        player VARCHAR(100),
        hand VARCHAR(100),
        hand_rank INT DEFAULT 0,
        hand_score BIGINT DEFAULT 0,
        game_mode VARCHAR(20),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      ALTER TABLE hand_history ADD COLUMN IF NOT EXISTS hand_rank INT DEFAULT 0;
      ALTER TABLE hand_history ADD COLUMN IF NOT EXISTS hand_score BIGINT DEFAULT 0;
    `);

    // 2. Tabell for dynamisk spillerliste
    await pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL
      );
    `);

    const countRes = await pool.query('SELECT COUNT(*) FROM players');
    if (parseInt(countRes.rows[0].count, 10) === 0) {
      for (const name of DEFAULT_PLAYERS) {
        await pool.query('INSERT INTO players (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
      }
      console.log("Satte inn standardspillere i databasen.");
    }

    console.log("Database-tabeller er klare!");
  } catch (err) {
    console.error("Feil ved opprettelse av databasetabeller:", err);
  }
}
initDB();
// -----------------------------------

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

// Genererer en unikk matematisk score basert på kortverdiene i den løste hånden
function calculateHandScore(solvedHand) {
  if (!solvedHand) return 0;
  
  // Hovedrangering (0-9) multipliseres med en stor faktormengde
  let baseRank = solvedHand.rank || 0;
  let score = BigInt(baseRank) * BigInt(10000000000);

  // pokersolver setter 'values' som numeriske verdier (2-14) sortert etter viktighet
  if (solvedHand.values && Array.isArray(solvedHand.values)) {
    let multiplier = BigInt(100000000);
    for (let val of solvedHand.values) {
      score += BigInt(val) * multiplier;
      multiplier /= BigInt(15);
    }
  }

  return score.toString();
}

function evaluatePlayerHand(playerCards, boardCards, gameMode) {
  if (gameMode === 'TEXAS') {
    return Hand.solve([...playerCards, ...boardCards]);
  } else {
    let bestHand = null;
    for (let i = 0; i < playerCards.length; i++) {
      for (let j = i + 1; j < playerCards.length; j++) {
        const hand2 = [playerCards[i], playerCards[j]];

        for (let b1 = 0; b1 < boardCards.length; b1++) {
          for (let b2 = b1 + 1; b2 < boardCards.length; b2++) {
            for (let b3 = b2 + 1; b3 < boardCards.length; b3++) {
              const board3 = [boardCards[b1], boardCards[b2], boardCards[b3]];
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
  gameMode: null,
  phase: 'VENTING',
  board: [],
  deck: [],
  winnerInfo: null,
  dealerIndex: 0,
  gameNight: {
    host: '',
    location: '',
    date: new Date().toISOString().split('T')[0]
  }
};

let players = {};
const disconnectTimeouts = {};

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

async function sendPresetPlayers(targetSocket = null) {
  try {
    const res = await pool.query('SELECT name FROM players ORDER BY id ASC');
    const playerNames = res.rows.map(r => r.name);
    if (targetSocket) {
      targetSocket.emit('preset_players', playerNames);
    } else {
      io.emit('preset_players', playerNames);
    }
  } catch (err) {
    console.error("Feil ved henting av spillere:", err);
    if (targetSocket) targetSocket.emit('preset_players', DEFAULT_PLAYERS);
  }
}

function formatToNorwegianTime(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  
  const options = {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  };

  const parts = new Intl.DateTimeFormat('nb-NO', options).formatToParts(d);
  const hash = {};
  parts.forEach(p => hash[p.type] = p.value);

  return `${hash.year}-${hash.month}-${hash.day} ${hash.hour}:${hash.minute}`;
}

io.on('connection', (socket) => {
  sendPresetPlayers(socket);

  socket.on('join_game', (name) => {
    const cleanName = name ? name.trim() : 'Spiller';
    
    let existingPlayerKey = Object.keys(players).find(
      key => players[key].name.toLowerCase() === cleanName.toLowerCase()
    );

    if (existingPlayerKey) {
      const playerData = players[existingPlayerKey];
      delete players[existingPlayerKey];
      
      if (disconnectTimeouts[existingPlayerKey]) {
        clearTimeout(disconnectTimeouts[existingPlayerKey]);
        delete disconnectTimeouts[existingPlayerKey];
      }

      playerData.id = socket.id;
      playerData.connected = true;
      players[socket.id] = playerData;
    } else {
      const seatNumber = Object.keys(players).length + 1;
      players[socket.id] = {
        id: socket.id,
        name: cleanName,
        seat: seatNumber,
        cards: [],
        folded: false,
        role: '',
        connected: true,
        points: 0
      };
    }

    updateAll();
  });

  socket.on('set_gamenight', (data) => {
    gameState.gameNight.host = data.host || '';
    gameState.gameNight.location = data.location || '';
    updateAll();
  });

  socket.on('set_game_mode', (mode) => {
    gameState.gameMode = mode;
    if (!mode) {
      gameState.phase = 'VENTING';
      gameState.board = [];
      gameState.winnerInfo = null;
    } else {
      randomizePlayerSeats();
    }
    updateAll();
  });

  socket.on('start_new_hand', () => {
    startNewHandLogic();
    updateAll();
  });

  socket.on('next_phase', async () => {
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
      activePlayers[0].points = (activePlayers[0].points || 0) + 1;
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
        winners.forEach(w => {
          w.player.points = (w.player.points || 0) + 1;
        });
      } else {
        winnerText = winners[0].player.name;
        winners[0].player.points = (winners[0].player.points || 0) + 2;
      }

      const rawDescr = winners[0] ? winners[0].solved.descr : 'Ukjent hånd';
      const translatedHand = translateHandDescription(rawDescr);
      const handRank = winners[0] && winners[0].solved ? (winners[0].solved.rank || 0) : 0;
      const handScore = winners[0] && winners[0].solved ? calculateHandScore(winners[0].solved) : '0';

      gameState.winnerInfo = {
        winnerName: winnerText,
        descr: translatedHand,
        foldedWin: false
      };

      try {
        await pool.query(
          'INSERT INTO hand_history (player, hand, hand_rank, hand_score, game_mode) VALUES ($1, $2, $3, $4, $5)',
          [winnerText, translatedHand, handRank, handScore, gameState.gameMode]
        );
      } catch (dbErr) {
        console.error("Feil ved lagring av vinnerhånd til DB:", dbErr);
      }
    }
    updateAll();
  });

  socket.on('player_fold', () => {
    if (players[socket.id]) {
      players[socket.id].folded = true;
      const activePlayers = Object.values(players).filter(p => !p.folded);
      if (activePlayers.length === 1 && gameState.phase !== 'VENTING') {
        gameState.phase = 'FINISHED';
        gameState.winnerInfo = {
          winnerName: activePlayers[0].name,
          descr: 'Alle andre kastet seg',
          foldedWin: true
        };
        activePlayers[0].points = (activePlayers[0].points || 0) + 1;
      }
      updateAll();
    }
  });

  socket.on('get_top10', async (data) => {
    const period = data ? data.period : 'tonight';
    let timeQuery = '';

    if (period === 'tonight') {
      timeQuery = "WHERE created_at >= (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Oslo')::date AT TIME ZONE 'Europe/Oslo'";
    } else if (period === 'month') {
      timeQuery = "WHERE created_at >= date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Oslo') AT TIME ZONE 'Europe/Oslo'";
    } else if (period === 'year') {
      timeQuery = "WHERE created_at >= date_trunc('year', CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Oslo') AT TIME ZONE 'Europe/Oslo'";
    }

    try {
      // Sorterer nå først på hand_rank DESC, deretter den eksakte hand_score DESC, og til slutt id DESC
      const res = await pool.query(`
        SELECT player AS "playerName", hand AS "handDescr", created_at AS "rawDate"
        FROM hand_history 
        ${timeQuery}
        ORDER BY hand_rank DESC, hand_score DESC, id DESC 
        LIMIT 10
      `);

      const formattedRows = res.rows.map(r => ({
        playerName: r.playerName,
        handDescr: r.handDescr,
        date: formatToNorwegianTime(r.rawDate)
      }));

      socket.emit('top10_data', formattedRows);
    } catch (err) {
      console.error("Feil ved henting av Topp 10 fra DB:", err);
      socket.emit('top10_data', []);
    }
  });

  socket.on('admin_get_players', async () => {
    try {
      const res = await pool.query('SELECT * FROM players ORDER BY id ASC');
      socket.emit('admin_players_list', res.rows);
    } catch (err) {
      console.error("Feil ved henting av admin spillere:", err);
    }
  });

  socket.on('admin_add_player', async (name) => {
    if (!name || !name.trim()) return;
    try {
      await pool.query('INSERT INTO players (name) VALUES ($1) ON CONFLICT DO NOTHING', [name.trim()]);
      sendPresetPlayers();
      const res = await pool.query('SELECT * FROM players ORDER BY id ASC');
      socket.emit('admin_players_list', res.rows);
    } catch (err) {
      console.error("Feil ved ny spiller:", err);
    }
  });

  socket.on('admin_delete_player', async (id) => {
    try {
      await pool.query('DELETE FROM players WHERE id = $1', [id]);
      sendPresetPlayers();
      const res = await pool.query('SELECT * FROM players ORDER BY id ASC');
      socket.emit('admin_players_list', res.rows);
    } catch (err) {
      console.error("Feil ved sletting av spiller:", err);
    }
  });

  socket.on('admin_clear_history', async () => {
    try {
      await pool.query('DELETE FROM hand_history');
      console.log("Håndhistorikk er tømt av admin!");
      socket.emit('admin_action_success', 'Håndhistorikk / Topp 10 har blitt tømt!');
    } catch (err) {
      console.error("Feil ved tømming av historikk:", err);
    }
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      players[socket.id].connected = false;
      const disconnectedId = socket.id;

      disconnectTimeouts[disconnectedId] = setTimeout(() => {
        delete players[disconnectedId];
        delete disconnectTimeouts[disconnectedId];
        updateAll();
      }, 45000);

      updateAll();
    }
  });
});

function updateAll() {
  const playerList = Object.values(players);
  const showCardsOnScreen = gameState.phase === 'SHOWDOWN' && gameState.winnerInfo && !gameState.winnerInfo.foldedWin;

  io.emit('state_update', {
    gameMode: gameState.gameMode,
    phase: gameState.phase,
    board: gameState.board,
    winnerInfo: gameState.winnerInfo,
    gameNight: gameState.gameNight,
    players: playerList.map(p => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      role: p.role,
      folded: p.folded,
      connected: p.connected,
      points: p.points || 0,
      cards: showCardsOnScreen && !p.folded ? p.cards : []
    }))
  });

  playerList.forEach(p => {
    if (p.connected) {
      io.to(p.id).emit('player_state', {
        phase: gameState.phase,
        cards: p.cards,
        role: p.role,
        folded: p.folded,
        winnerInfo: gameState.winnerInfo,
        points: p.points || 0
      });
    }
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server kjører på port ${PORT}`));