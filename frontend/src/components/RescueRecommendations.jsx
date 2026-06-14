import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Rescue Recommendations — "Save This Item" personalized row.
 * Shows items about to be recycled with urgency countdown.
 */
export default function RescueRecommendations() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_BASE || ''}/api/recommendations/rescue`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setItems(data.items || []))
      .catch(() => {});
  }, []);

  if (items.length === 0) return null;

  return (
    <div style={{ margin: '20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <span style={{ fontSize: '20px' }}>🆘</span>
        <h3 style={{ margin: 0, fontSize: '16px' }}>Rescue These Items</h3>
        <span style={{ fontSize: '12px', color: '#888' }}>Being recycled soon if not purchased</span>
      </div>

      <div style={{
        display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px',
        scrollbarWidth: 'thin',
      }}>
        {items.map(item => (
          <Link to={`/product/${item.productId}`} key={item.productId} style={{
            minWidth: '200px', background: 'white', borderRadius: '10px',
            border: '1px solid #ffcdd2', padding: '12px', textDecoration: 'none',
            color: 'inherit', position: 'relative', flexShrink: 0,
          }}>
            {/* Urgency badge */}
            <div style={{
              position: 'absolute', top: '8px', right: '8px',
              background: '#ff5722', color: 'white', fontSize: '10px',
              padding: '2px 6px', borderRadius: '10px', fontWeight: 600,
            }}>
              ⏰ {item.hoursRemaining}h left
            </div>

            <div style={{
              height: '80px', background: '#f5f5f5', borderRadius: '6px',
              marginBottom: '8px', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: '24px',
            }}>
              {item.destination === 'recycle' ? '♻️' : '🎁'}
            </div>

            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '2px' }}>
              {item.brand} {item.model}
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
              {item.category} • Grade {item.grade || '?'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#2e7d32' }}>
                ₹{item.recommendedPrice || '—'}
              </span>
              <span style={{ fontSize: '10px', color: '#4caf50' }}>
                🌱 Saves {item.co2SavedKg}kg CO₂
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
