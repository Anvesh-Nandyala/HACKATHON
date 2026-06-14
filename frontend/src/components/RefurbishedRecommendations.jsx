import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Personalized Recommendations for Certified Refurbished Products.
 * Shows AI-ranked refurbished items with savings and trust badges.
 */
export default function RefurbishedRecommendations() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    fetch(`${import.meta.env.VITE_API_BASE || ''}/api/recommendations/refurbished`, { headers })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setItems(data.items || []))
      .catch(() => {});
  }, []);

  if (items.length === 0) return null;

  return (
    <div style={{ margin: '20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <span style={{ fontSize: '20px' }}>🔧</span>
        <h3 style={{ margin: 0, fontSize: '16px' }}>Certified Refurbished — Recommended for You</h3>
      </div>

      <div style={{
        display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px',
        scrollbarWidth: 'thin',
      }}>
        {items.map(item => (
          <Link to={`/product/${item.productId}`} key={item.productId} style={{
            minWidth: '210px', background: 'white', borderRadius: '10px',
            border: '1px solid #e3f2fd', padding: '12px', textDecoration: 'none',
            color: 'inherit', position: 'relative', flexShrink: 0,
          }}>
            {/* Certified badge */}
            <div style={{
              position: 'absolute', top: '8px', left: '8px',
              background: '#1565c0', color: 'white', fontSize: '9px',
              padding: '2px 6px', borderRadius: '10px', fontWeight: 700,
              letterSpacing: '0.3px',
            }}>
              ✓ CERTIFIED REFURBISHED
            </div>

            {/* Savings badge */}
            {item.savingsPercent > 0 && (
              <div style={{
                position: 'absolute', top: '8px', right: '8px',
                background: '#4caf50', color: 'white', fontSize: '10px',
                padding: '2px 6px', borderRadius: '10px', fontWeight: 600,
              }}>
                Save {item.savingsPercent}%
              </div>
            )}

            <div style={{
              height: '80px', background: '#f5f5f5', borderRadius: '6px',
              marginTop: '20px', marginBottom: '8px', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: '24px',
            }}>
              🔧
            </div>

            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '2px' }}>
              {item.brand} {item.model}
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px' }}>
              {item.category} • Grade {item.grade || '?'} • {item.conditionScore || '?'}/100
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '15px', fontWeight: 700, color: '#1565c0' }}>
                  ₹{item.recommendedPrice}
                </span>
                {item.originalPrice > item.recommendedPrice && (
                  <span style={{ fontSize: '11px', color: '#999', textDecoration: 'line-through', marginLeft: '4px' }}>
                    ₹{item.originalPrice}
                  </span>
                )}
              </div>
            </div>

            {item.relevanceScore && item.relevanceScore > 0.7 && (
              <div style={{
                marginTop: '6px', fontSize: '10px', color: '#7b1fa2',
                background: '#f3e5f5', padding: '2px 6px', borderRadius: '4px',
                display: 'inline-block',
              }}>
                🎯 AI-matched for you
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
