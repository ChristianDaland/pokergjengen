// server.js

// Hjælp til å sende oppdatert tilstand i et format frontend forventer
function updateAll() {
  const playersArray = Object.values(players);
  io.emit('game_state_update', { gameState, players: playersArray });
  io.emit('state_update', { 
    ...gameState, 
    players: playersArray, 
    sessionStarted: gameState.phase !== 'VENTING' 
  });
}

// Socket handling
io.on('connection', (socket) => {
  // Send initial tilstand til ny tilkoblet mobil/skjerm
  updateAll();

  socket.on('join_game', (data) => {
    // Håndter om data er en streng (fra mobile.html) eller et objekt
    const name = typeof data === 'string' ? data : (data?.name || 'Anonym');

    players[socket.id] = {
      id: socket.id,
      name: name,
      points: 0,
      cards: [],
      folded: false,
      isEliminated: false,
      connected: true
    };
    updateAll();
  });

  // Håndter kasting av kort fra mobil
  socket.on('player_fold', () => {
    if (players[socket.id]) {
      players[socket.id].folded = true;
      updateAll();
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    updateAll();
  });
  
  // ... resten av server.js (next_phase, start_game osv.)
});