import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function productName(item) {
  return item.name || [item.brand, item.model].filter(Boolean).join(' ') || item.category || 'Product';
}

export default function RefurbishedRecommendations() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let mounted = true;
    api.getRefurbishedRecommendations()
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
          <h3>Certified Refurbished - Recommended for You</h3>
          <p>Verified products ranked by quality, savings, and relevance.</p>
        </div>
      </div>

      <div className="recommendation-row">
        {items.map(item => (
          <Link to={`/product/${item.productId}`} key={item.productId} className="recommendation-card refurbished-card">
            <div className="recommendation-badge certified">Certified Refurbished</div>
            {item.savingsPercent > 0 && (
              <div className="recommendation-badge savings">Save {item.savingsPercent}%</div>
            )}
            <div className="recommendation-image">{item.category}</div>
            <h4>{productName(item)}</h4>
            <p>{item.category} / Grade {item.grade || 'N/A'} / {item.conditionScore || 'N/A'}/100</p>
            <div className="recommendation-card-footer">
              <strong>${item.recommendedPrice || 'N/A'}</strong>
              {item.originalPrice > item.recommendedPrice && <span className="strike">${item.originalPrice}</span>}
            </div>
            {item.aiMatched && (
              <div className="ai-match-tag">AI-matched for you</div>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
