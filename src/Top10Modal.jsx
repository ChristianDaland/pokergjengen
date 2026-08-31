import React, { useState, useEffect } from 'react';
import './Top10Modal.css'; // Tilpass CSS-stiene hvis du bruker en annen klasse struktur

export default function Top10Modal({ socket, onClose }) {
  const [activeTab, setActiveTab] = useState('tonight');
  const [topList, setTopList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!socket) return;

    const handleTop10Data = (data) => {
      setTopList(data || []);
      setLoading(false);
    };

    socket.on('top10_data', handleTop10Data);

    // Hent data med en gang komponenten lastes inn eller fane endres
    setLoading(true);
    socket.emit('get_top10', { period: activeTab });

    return () => {
      socket.off('top10_data', handleTop10Data);
    };
  }, [socket, activeTab]);

  const handleTabChange = (periodKey) => {
    setActiveTab(periodKey);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content top10-modal">
        <div className="modal-header">
          <h2>📊 Flernivå Topp 10 (Showdown)</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="tab-bar">
          <button 
            className={`tab-btn ${activeTab === 'tonight' ? 'active' : ''}`}
            onClick={() => handleTabChange('tonight')}
          >
            Kveldens
          </button>
          <button 
            className={`tab-btn ${activeTab === 'month' ? 'active' : ''}`}
            onClick={() => handleTabChange('month')}
          >
            Månedens
          </button>
          <button 
            className={`tab-btn ${activeTab === 'year' ? 'active' : ''}`}
            onClick={() => handleTabChange('year')}
          >
            Årets
          </button>
          <button 
            className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => handleTabChange('all')}
          >
            Evig (All-Time)
          </button>
        </div>

        <div className="table-container">
          {loading ? (
            <div className="loading-spinner">Laster toppliste...</div>
          ) : topList.length === 0 ? (
            <div className="empty-message">Ingen showdown-hender registrert i denne perioden ennå.</div>
          ) : (
            <table className="top10-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Spiller</th>
                  <th>Hånd</th>
                  <th>Dato</th>
                </tr>
              </thead>
              <tbody>
                {topList.map((row, index) => (
                  <tr key={index}>
                    <td className="rank-col"><strong>{index + 1}</strong></td>
                    <td className="player-col">{row.playerName}</td>
                    <td className="hand-col">{row.handDescr}</td>
                    <td className="date-col">{row.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}