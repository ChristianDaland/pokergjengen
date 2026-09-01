const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Databaseforbindelse (PostgreSQL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/pokerdb',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initiell databasestruktur
pool.query(`
    CREATE TABLE IF NOT EXISTS hand_history (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        game_type VARCHAR(50),
        player VARCHAR(100),
        points INT,
        hand_description TEXT
    );
    CREATE TABLE IF NOT EXISTS game_notes (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        game_date DATE DEFAULT CURRENT_DATE,
        note TEXT
    );
`).catch(err => console.error("Feil ved opprettelse av tabeller:", err));

app.use(express.static(path.join(__dirname, 'public')));

// Spilltilstand
let gameState = {
    gameType: 'Texas Hold\'em',
    players: [],
    communityCards: [],
    pot: 0,
    currentTurn: 0,
    activeRound: false,
    deck: []
};

// Generer og stokk kortstokk
function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let deck = [];
    for (let s of suits) {
        for (let v of values) {
            deck.push({ suit: s, value: v });
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// Enkel evaluering (Kan utvides med fullstendig poker-evaluator)
function evaluatePlayerHand(playerCards, communityCards) {
    // Returnerer et tilfeldig/simulert poengtall for demonstrasjon eller evaluering
    return {
        score: Math.floor(Math.random() * 1000),
        description: "Høyeste kort / Par"
    };
}

io.on('connection', (socket) => {
    console.log('Ny klient tilkoblet:', socket.id);

    // Send initiell tilstand
    socket.emit('state_update', gameState);

    // Oppdater spillinnstillinger
    socket.on('update_settings', (data) => {
        if (data.gameType) gameState.gameType = data.gameType;
        io.emit('state_update', gameState);
    });

    // Registrer spiller
    socket.on('join_game', (data) => {
        const existing = gameState.players.find(p => p.id === socket.id);
        if (!existing) {
            gameState.players.push({
                id: socket.id,
                name: data.name || 'Anonym',
                cards: [],
                folded: false,
                chips: 1000
            });
        }
        io.emit('state_update', gameState);
    });

    // Start ny runde
    socket.on('start_round', () => {
        gameState.deck = createDeck();
        gameState.communityCards = [];
        gameState.pot = 0;
        gameState.activeRound = true;

        const cardsPerPlayer = gameState.gameType.includes('Omaha') ? 4 : 2;

        gameState.players.forEach(player => {
            player.folded = false;
            player.cards = gameState.deck.splice(0, cardsPerPlayer);
        });

        io.emit('state_update', gameState);
    });

    // Del ut felleskort (Flop, Turn, River)
    socket.on('deal_community', (count) => {
        if (gameState.deck.length >= count) {
            const newCards = gameState.deck.splice(0, count);
            gameState.communityCards.push(...newCards);
            io.emit('state_update', gameState);
        }
    });

    // Spillerkasting (Fold)
    socket.on('player_fold', () => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (player) {
            player.folded = true;
            io.emit('state_update', gameState);
        }
    });

    // Avslutt runde / Showdown
    socket.on('showdown', async () => {
        const activePlayers = gameState.players.filter(p => !p.folded);
        if (activePlayers.length === 0) return;

        let bestScore = -1;
        let winners = [];

        activePlayers.forEach(player => {
            const result = evaluatePlayerHand(player.cards, gameState.communityCards);
            if (result.score > bestScore) {
                bestScore = result.score;
                winners = [{ player, desc: result.description }];
            } else if (result.score === bestScore) {
                winners.push({ player, desc: result.description });
            }
        });

        // Lagre historikk separat per vinner dersom potten deles
        const pointsPerWinner = Math.floor(gameState.pot / winners.length) || 100;
        
        for (let w of winners) {
            try {
                await pool.query(
                    `INSERT INTO hand_history (game_type, player, points, hand_description) VALUES ($1, $2, $3, $4)`,
                    [gameState.gameType, w.player.name, pointsPerWinner, w.desc]
                );
            } catch (err) {
                console.error("Feil ved lagring av vinner i hand_history:", err);
            }
        }

        gameState.activeRound = false;
        io.emit('showdown_results', { winners, pot: gameState.pot });
        io.emit('state_update', gameState);
    });

    // Topp 10 - Sortert og filtrert
    socket.on('get_top10', async (data) => {
        try {
            let query = `
                SELECT player, SUM(points) as total_points, COUNT(*) as wins 
                FROM hand_history 
            `;
            let params = [];

            if (data && data.period === 'tonight') {
                // Filtrerer fra starten av gjeldende kalenderdag (00:00)
                query += ` WHERE timestamp >= CURRENT_DATE `;
            }

            query += ` GROUP BY player ORDER BY total_points DESC LIMIT 10`;

            const res = await pool.query(query, params);
            socket.emit('top10_data', res.rows);
        } catch (err) {
            console.error("Feil ved get_top10:", err);
        }
    });

    // Eksporter rådata (CSV)
    socket.on('export_csv', async () => {
        try {
            const res = await pool.query(`SELECT id, timestamp, game_type, player, points, hand_description FROM hand_history ORDER BY id DESC`);
            let csv = "ID,Tidspunkt,Spilltype,Spiller,Poeng,HandBeskrivelse\n";
            res.rows.forEach(r => {
                csv += `"${r.id}","${r.timestamp}","${r.game_type}","${r.player}",${r.points},"${r.hand_description}"\n`;
            });
            socket.emit('csv_data', csv);
        } catch (err) {
            console.error("Feil ved eksportering av CSV:", err);
        }
    });

    // Hent og lagre kveldsnotater
    socket.on('get_notes', async () => {
        try {
            const res = await pool.query(`SELECT * FROM game_notes ORDER BY created_at DESC LIMIT 20`);
            socket.emit('notes_data', res.rows);
        } catch (err) {
            console.error("Feil ved henting av notater:", err);
        }
    });

    socket.on('save_note', async (text) => {
        if (!text || text.trim() === '') return;
        try {
            await pool.query(`INSERT INTO game_notes (note) VALUES ($1)`, [text.trim()]);
            const res = await pool.query(`SELECT * FROM game_notes ORDER BY created_at DESC LIMIT 20`);
            io.emit('notes_data', res.rows);
        } catch (err) {
            console.error("Feil ved lagring av notat:", err);
        }
    });

    // Historisk arkiv
    socket.on('get_history_dates', async () => {
        try {
            const res = await pool.query(`SELECT DISTINCT DATE(timestamp) as game_date FROM hand_history ORDER BY game_date DESC`);
            socket.emit('history_dates_data', res.rows);
        } catch (err) {
            console.error("Feil ved henting av historiske datoer:", err);
        }
    });

    socket.on('get_history_day', async (dateStr) => {
        try {
            const res = await pool.query(
                `SELECT player, SUM(points) as total_points, COUNT(*) as wins 
                 FROM hand_history 
                 WHERE DATE(timestamp) = $1 
                 GROUP BY player 
                 ORDER BY total_points DESC`,
                [dateStr]
            );
            socket.emit('history_day_data', { date: dateStr, rows: res.rows });
        } catch (err) {
            console.error("Feil ved henting av dagsdata:", err);
        }
    });

    socket.on('disconnect', () => {
        gameState.players = gameState.players.filter(p => p.id !== socket.id);
        io.emit('state_update', gameState);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Hybrid Poker Server kjører på port ${PORT}`);
});