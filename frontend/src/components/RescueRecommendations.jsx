import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function productName(item) {
  return item.name || [item.brand, item.model].filter(Boolean).join(' ') || item.category || 'Product';
}

export default function RescueRecommendations() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let mounted = true;
    api.getRescueRecommendations()
      .then(data => {
        if (mounted) setItems(data.items || []);
      })
      .catch(() => {
        if (mounted) setItems([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (!items.length) return null;

  return (
    <section className="recommendation-section">
      <div className="recommendation-header">
        <div>
          <h3>Rescue These Items</h3>
          <p>Items about to be recycled or donated.</p>
        </div>
      </div>

      <div className="recommendation-row">
        {items.map(item => (
          <Link to={`/product/${item.productId}`} key={item.productId} className="recommendation-card rescue-card">
            <div className="recommendation-badge danger">{item.hoursRemaining}h left</div>
            <div className="recommendation-image">{item.destination === 'recycle' ? 'Recycle' : 'Donate'}</div>
            <h4>{productName(item)}</h4>
            <p>{item.category} / Grade {item.grade || 'N/A'}</p>
            <div className="recommendation-card-footer">
              <strong>${item.recommendedPrice || 'N/A'}</strong>
              <span>Saves {item.co2SavedKg || 0}kg CO2</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
