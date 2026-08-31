const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const { Hand } = require('pokersolver');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const pool = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'poker_db',
  password: process.env.PGPASSWORD || 'postgres',
  port: process.env.PGPORT || 5432,
});

// Initialiser Databasetabell
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hand_history (
        id SERIAL PRIMARY KEY,
        player VARCHAR(100),
        hand VARCHAR(200),
        hand_rank INT,
        game_mode VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Database hand_history klar.");
  } catch (err) {
    console.error("Feil ved init av DB:", err);
  }
}
initDB();

// Global Spilltilstand
let players = {};
let gameState = {
  phase: 'VENTING', // VENTING, PREFLOP, FLOP, TURN, RIVER, SHOWDOWN, FINISHED
  board: [],
  deck: [],
  gameMode: 'TEXAS',
  winnerInfo: null
};

// Hjjelpefunksjoner for Stokk & Poker
function createDeck() {
  const suits = ['s', 'h', 'd', 'c'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  let deck = [];
  for (let s of suits) {
    for (let v of values) {
      deck.push(v + s);
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function evaluatePlayerHand(playerCards, boardCards, mode) {
  const allCards = [...playerCards, ...boardCards];
  if (mode === 'SHORT_BUS') {
    // Eksempel på spesialmodus om relevant
    return Hand.solve(allCards);
  }
  return Hand.solve(allCards);
}

function translateHandDescription(descr) {
  if (!descr) return 'Ukjent hånd';
  let t = descr;
  t = t.replace(/Full House/g, 'Fullt Hus');
  t = t.replace(/Flush/g, 'Flush');
  t = t.replace(/Straight/g, 'Straight');
  t = t.replace(/Three of a Kind/g, 'Tre like');
  t = t.replace(/Two Pair/g, 'To par');
  t = t.replace(/One Pair/g, 'Ett par');
  t = t.replace(/High Card/g, 'Høyt kort');
  t = t.replace(/Straight Flush/g, 'Straight Flush');
  t = t.replace(/Royal Flush/g, 'Royal Flush');
  t = t.replace(/Four of a Kind/g, 'Fire like');
  t = t.replace(/over/g, 'over');
  return t;
}

function formatToNorwegianTime(dateString) {
  const d = new Date(dateString);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function startNewHandLogic() {
  gameState.deck = createDeck();
  gameState.board = [];
  gameState.winnerInfo = null;
  gameState.phase = 'PREFLOP';

  Object.keys(players).forEach(id => {
    players[id].cards = [gameState.deck.pop(), gameState.deck.pop()];
    players[id].folded = false;
  });
}

function updateAll() {
  io.emit('game_state_update', { gameState, players });
}

// Socket handling
io.on('connection', (socket) => {
  console.log('Spiller koblet til:', socket.id);

  socket.on('join_game', (data) => {
    players[socket.id] = {
      id: socket.id,
      name: data.name || 'Anonym',
      points: 0,
      cards: [],
      folded: false,
      isEliminated: false
    };
    updateAll();
  });

  socket.on('start_game', () => {
    startNewHandLogic();
    updateAll();
  });

  socket.on('fold', () => {
    if (players[socket.id]) {
      players[socket.id].folded = true;
      updateAll();
    }
  });

  socket.on('next_phase', async () => {
    const activePlayers = Object.values(players).filter(p => !p.folded && !p.isEliminated);

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
      
      try {
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
          winners.forEach(w => { w.player.points = (w.player.points || 0) + 1; });
        } else if (winners.length === 1) {
          winnerText = winners[0].player.name;
          winners[0].player.points = (winners[0].player.points || 0) + 2;
        }

        const topWinner = winners[0] || solvedHands[0];
        const rawDescr = topWinner && topWinner.solved ? topWinner.solved.descr : 'Ukjent hånd';
        const translatedHand = translateHandDescription(rawDescr);
        
        // Pokersolver har et internt 'rank' nummer (1 er Royal Flush, 9-10 er High Card osv).
        // Lav verdi betyr HØYERE/BEDRE hånd i pokersolver!
        const handRank = (topWinner && topWinner.solved && topWinner.solved.rank) 
          ? Number(topWinner.solved.rank) 
          : 9999;

        gameState.winnerInfo = {
          winnerName: winnerText,
          descr: translatedHand,
          foldedWin: false
        };

        await pool.query(
          'INSERT INTO hand_history (player, hand, hand_rank, game_mode) VALUES ($1, $2, $3, $4)',
          [winnerText, translatedHand, handRank, gameState.gameMode || 'TEXAS']
        );
      } catch (err) {
        console.error("Feil ved SHOWDOWN evaluation/DB insert:", err);
      }
    }
    updateAll();
  });

  socket.on('get_top10', async (data) => {
    const rawPeriod = (data && data.period) ? String(data.period).toLowerCase() : 'tonight';
    let timeQuery = '';

    if (rawPeriod === 'tonight' || rawPeriod === 'kveld' || rawPeriod === 'kveldens') {
      timeQuery = "WHERE created_at >= NOW() - INTERVAL '24 hours'";
    } else if (rawPeriod === 'month' || rawPeriod === 'måned' || rawPeriod === 'månedens') {
      timeQuery = "WHERE created_at >= NOW() - INTERVAL '30 days'";
    } else if (rawPeriod === 'year' || rawPeriod === 'år' || rawPeriod === 'årets') {
      timeQuery = "WHERE created_at >= NOW() - INTERVAL '1 year'";
    } else if (rawPeriod === 'all' || rawPeriod === 'ever' || rawPeriod === 'evig') {
      timeQuery = "";
    } else {
      timeQuery = "";
    }

    try {
      // ORDER BY hand_rank ASC betyr at 1 (best) kommer øverst, og 9999 nederst!
      const res = await pool.query(`
        SELECT player AS "playerName", hand AS "handDescr", created_at AS "rawDate"
        FROM hand_history 
        ${timeQuery}
        ORDER BY hand_rank ASC, id DESC 
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

  socket.on('disconnect', () => {
    console.log('Spiller koblet fra:', socket.id);
    delete players[socket.id];
    updateAll();
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server kjører på port ${PORT}`);
});