import React, { useEffect, useState } from 'react';
import { api } from '../api';

export default function MyProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMyProducts()
      .then(data => setProducts(data.products || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const getStatusBadge = (status) => {
    const map = {
      pending_verification: { class: 'badge-yellow', label: 'Verifying' },
      verified: { class: 'badge-blue', label: 'Verified' },
      listed: { class: 'badge-green', label: 'Listed' },
      reserved: { class: 'badge-orange', label: 'Reserved' },
      sold: { class: 'badge-green', label: 'Sold' },
      donated: { class: 'badge-blue', label: 'Donated' },
      recycled: { class: 'badge-blue', label: 'Recycled' },
      expired: { class: 'badge-red', label: 'Expired' },
    };
    const info = map[status] || { class: 'badge-yellow', label: status };
    return <span className={`badge ${info.class}`}>{info.label}</span>;
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>My Products</h1>

      {products.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}>
          <p>No products yet. Submit your first product to get started.</p>
        </div>
      )}

      <div className="card-grid">
        {products.map(product => (
          <div key={product.productId} className="card product-card">
            <div className="product-card-header">
              <div>
                <div className="product-card-title">{product.brand} {product.model}</div>
                {getStatusBadge(product.status)}
              </div>
              {product.verification && (
                <span className={`grade grade-${product.verification.grade}`}>
                  {product.verification.grade}
                </span>
              )}
            </div>

            {product.priceEstimate && (
              <div className="product-card-price">${product.priceEstimate.recommendedPrice}</div>
            )}

            {product.routingDecision && (
              <div style={{ marginTop: '0.5rem' }}>
                <span className={`route-badge route-${product.routingDecision.destination}`}>
                  Route: {product.routingDecision.destination}
                </span>
              </div>
            )}

            <div className="product-card-meta">
              <span>{new Date(product.createdAt).toLocaleDateString()}</span>
              <span>{product.category}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
