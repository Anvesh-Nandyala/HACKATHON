import React, { useEffect, useState } from 'react';
import { api } from '../api';

export default function Credits() {
  const [balance, setBalance] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getBalance().catch(() => null),
      api.getHistory().catch(() => ({ actions: [] })),
    ]).then(([bal, hist]) => {
      setBalance(bal);
      setHistory(hist?.actions || []);
      setLoading(false);
    });
  }, []);

  const getTierColor = (tier) => {
    switch (tier) {
      case 'platinum': return '#a78bfa';
      case 'gold': return '#f59e0b';
      case 'silver': return '#9ca3af';
      default: return '#d97706';
    }
  };

  const getTierProgress = () => {
    if (!balance || !balance.tierProgress.nextTierAt) return 100;
    return Math.min(100, (balance.tierProgress.current / balance.tierProgress.nextTierAt) * 100);
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Green Credits</h1>

      {balance && (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{balance.totalCredits}</div>
              <div className="stat-label">Available Credits</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{balance.lifetimeEarned}</div>
              <div className="stat-label">Lifetime Earned</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{balance.co2SavedKg} kg</div>
              <div className="stat-label">CO2 Saved</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: getTierColor(balance.tier), textTransform: 'capitalize' }}>
                {balance.tier}
              </div>
              <div className="stat-label">Current Tier</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <h3>Tier Progress</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--gray-500)' }}>
              <span>{balance.tier}</span>
              <span>{balance.tierProgress.nextTierAt ? `Next: ${balance.tierProgress.nextTierAt} credits` : 'Max tier'}</span>
            </div>
            <div className="tier-bar">
              <div className="tier-fill" style={{ width: `${getTierProgress()}%` }} />
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--gray-500)' }}>
              <span>Bronze: 0</span>
              <span>Silver: 200</span>
              <span>Gold: 500</span>
              <span>Platinum: 1000</span>
            </div>
          </div>
        </>
      )}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3>How to Earn Credits</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <div style={{ fontWeight: 600 }}>Sell</div>
            <div style={{ color: 'var(--green-600)', fontWeight: 700 }}>+50 credits</div>
          </div>
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <div style={{ fontWeight: 600 }}>Buy Local</div>
            <div style={{ color: 'var(--green-600)', fontWeight: 700 }}>+30 credits</div>
          </div>
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <div style={{ fontWeight: 600 }}>Donate</div>
            <div style={{ color: 'var(--green-600)', fontWeight: 700 }}>+40 credits</div>
          </div>
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <div style={{ fontWeight: 600 }}>Recycle</div>
            <div style={{ color: 'var(--green-600)', fontWeight: 700 }}>+20 credits</div>
          </div>
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <div style={{ fontWeight: 600 }}>Avoid Return</div>
            <div style={{ color: 'var(--green-600)', fontWeight: 700 }}>+25 credits</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Recent Activity</h3>
        {history.length === 0 ? (
          <p style={{ color: 'var(--gray-500)', marginTop: '1rem' }}>No activity yet. Start earning credits by submitting products.</p>
        ) : (
          <table style={{ width: '100%', marginTop: '1rem', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--gray-200)' }}>
                <th style={{ padding: '0.5rem' }}>Action</th>
                <th style={{ padding: '0.5rem' }}>Credits</th>
                <th style={{ padding: '0.5rem' }}>CO2 Saved</th>
                <th style={{ padding: '0.5rem' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {history.slice().reverse().map((action, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                  <td style={{ padding: '0.5rem', textTransform: 'capitalize' }}>{action.actionType.replace('_', ' ')}</td>
                  <td style={{ padding: '0.5rem', color: 'var(--green-600)', fontWeight: 600 }}>+{action.creditsAwarded}</td>
                  <td style={{ padding: '0.5rem' }}>{action.co2Saved} kg</td>
                  <td style={{ padding: '0.5rem', color: 'var(--gray-500)' }}>{new Date(action.timestamp).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
