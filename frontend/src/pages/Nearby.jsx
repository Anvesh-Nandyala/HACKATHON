import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function productName(product) {
  return [product.brand, product.model].filter(Boolean).join(' ') || product.category;
}

function formatPurchaseDate(value) {
  if (!value) return 'Date not provided';
  return new Date(value).toLocaleDateString();
}

function qualityText(product) {
  return product.conditionScore ? `${product.conditionScore}/100` : 'Pending';
}

function pickupWindow() {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export default function Nearby({ user, buyerLocation }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [message, setMessage] = useState('');
  const [reservingId, setReservingId] = useState(null);
  const [reservedIds, setReservedIds] = useState([]);
  const [filters, setFilters] = useState({
    radiusKm: 10,
    sortBy: 'distance',
    category: '',
  });

  const search = async (nextFilters = filters) => {
    setLoading(true);
    setMessage('');
    try {
      const result = await api.discoverNearby({
        latitude: buyerLocation?.latitude || 40.7128,
        longitude: buyerLocation?.longitude || -74.006,
        radiusKm: nextFilters.radiusKm,
        sortBy: nextFilters.sortBy,
        limit: 50,
        ...(nextFilters.category && { category: nextFilters.category }),
      });
      const userProducts = result.products || [];
      setProducts(userProducts);
      setTotalCount(userProducts.length);
    } catch (err) {
      setMessage(err.message || 'Could not load nearby products.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { search(); }, [buyerLocation]);

  const reserve = async (product) => {
    setReservingId(product.productId);
    setMessage('');
    try {
      await api.reserveProduct({
        productId: product.productId,
        agreedPrice: product.recommendedPrice,
        pickupWindow: pickupWindow(),
      });
      setReservedIds(ids => [...ids, product.productId]);
      setProducts(items => items.filter(item => item.productId !== product.productId));
      setTotalCount(count => Math.max(0, count - 1));
      setMessage(`${productName(product)} reserved for pickup. Open Pickups to see your OTP.`);
    } catch (err) {
      setMessage(err.message || 'Could not reserve this product.');
    } finally {
      setReservingId(null);
    }
  };

  const openProduct = (product) => {
    window.open(`/#/product/${product.productId}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div>
      <div style={{
        background: '#047857',
        borderRadius: 'var(--radius)',
        padding: '2rem 2.5rem',
        color: 'white',
        marginBottom: '1.5rem',
      }}>
        <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>Products Near You</h1>
        <p style={{ opacity: 0.9 }}>
          Products uploaded by people in your area.
          Self-pickup only. Earn Green Credits on every purchase.
        </p>
      </div>

      <div className="info-strip" style={{ marginBottom: '1.5rem' }}>
        <div className="info-strip-item">
          <div className="icon">AI</div>
          <strong>AI Verified</strong>
          <span>Quality checked by AI</span>
        </div>
        <div className="info-strip-item">
          <div className="icon">Local</div>
          <strong>Local Pickup</strong>
          <span>No shipping needed</span>
        </div>
        <div className="info-strip-item">
          <div className="icon">Credits</div>
          <strong>Green Credits</strong>
          <span>Earn rewards for buying</span>
        </div>
        <div className="info-strip-item">
          <div className="icon">Deals</div>
          <strong>Great Deals</strong>
          <span>Save compared with retail</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 130 }}>
          <label>Distance</label>
          <select value={filters.radiusKm} onChange={e => setFilters({ ...filters, radiusKm: parseFloat(e.target.value) })}>
            <option value="2">Within 2 km</option>
            <option value="5">Within 5 km</option>
            <option value="10">Within 10 km</option>
            <option value="25">Within 25 km</option>
            <option value="50">Within 50 km</option>
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 130 }}>
          <label>Category</label>
          <select value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })}>
            <option value="">All Categories</option>
            <option value="electronics">Electronics</option>
            <option value="clothing">Clothing</option>
            <option value="furniture">Furniture</option>
            <option value="appliances">Appliances</option>
            <option value="sports">Sports</option>
            <option value="toys">Toys</option>
            <option value="tools">Tools</option>
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 130 }}>
          <label>Sort By</label>
          <select value={filters.sortBy} onChange={e => setFilters({ ...filters, sortBy: e.target.value })}>
            <option value="distance">Nearest First</option>
            <option value="price">Price: Low to High</option>
            <option value="condition">Best Quality</option>
            <option value="recency">Newest Listed</option>
          </select>
        </div>
        <button className="btn btn-green" onClick={() => search()} disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
        <span style={{ fontSize: '0.85rem', color: 'var(--gray-500)' }}>{totalCount} products found</span>
      </div>

      {message && <div className="status-message">{message}</div>}
      {loading && <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>Finding products near you...</p>}

      {!loading && products.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <h3>No products nearby yet</h3>
          <p style={{ color: 'var(--gray-500)', margin: '0.5rem 0 1.5rem' }}>
            Be the first to list a product in your area.
          </p>
          {user ? (
            <Link to="/submit" className="btn btn-green">List a Product</Link>
          ) : (
            <Link to="/register" className="btn btn-green">Sign Up to Sell</Link>
          )}
        </div>
      )}

      <div className="product-grid">
        {products.map(product => {
          const discount = product.originalPrice
            ? Math.round(((product.originalPrice - product.recommendedPrice) / product.originalPrice) * 100)
            : 0;
          const isBusy = reservingId === product.productId;
          const isDone = reservedIds.includes(product.productId);

          return (
            <div
              key={product.productId}
              className="product-card"
              onClick={() => openProduct(product)}
              role="button"
              tabIndex={0}
              onKeyDown={event => event.key === 'Enter' && openProduct(product)}
            >
              {product.condition === 'refurbished' && <span className="product-card-badge">Refurbished</span>}
              <span className="product-card-distance">{product.distance} km away</span>
              <div className="product-card-image product-card-text-image">{product.category}</div>
              <div className="product-card-title">{productName(product)}</div>
              <div className="product-card-rating">
                <span>Quality: {qualityText(product)}</span>
                {product.grade && (
                  <span className={`grade-badge grade-${product.grade}`} style={{ marginLeft: 'auto' }}>{product.grade}</span>
                )}
              </div>
              <div className="product-card-price">
                ${product.recommendedPrice}
                {discount > 0 && (
                  <>
                    <span className="original">${product.originalPrice}</span>
                    <span className="discount">-{discount}%</span>
                  </>
                )}
              </div>
              <div className="product-card-eco">Earn {Math.round(product.recommendedPrice * 0.05)} Green Credits</div>
              <div className="product-card-meta">
                Self-pickup / {product.category} / Purchased: {formatPurchaseDate(product.purchaseDate)}
              </div>
              {user ? (
                <button
                  className="btn-buy"
                  onClick={(event) => {
                    event.stopPropagation();
                    reserve(product);
                  }}
                  disabled={isBusy || isDone}
                >
                  {isBusy ? 'Working...' : isDone ? 'Reserved' : 'Reserve for Pickup'}
                </button>
              ) : (
                <Link
                  to="/login"
                  className="btn-buy"
                  onClick={event => event.stopPropagation()}
                  style={{ display: 'block', textAlign: 'center', textDecoration: 'none', color: 'var(--gray-900)' }}
                >
                  Sign in to Reserve
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {products.length > 0 && (
        <div style={{ background: 'white', borderRadius: 'var(--radius)', padding: '2rem', marginTop: '2rem', textAlign: 'center', boxShadow: 'var(--shadow)' }}>
          <h3>Have something to sell?</h3>
          <p style={{ color: 'var(--gray-500)', margin: '0.5rem 0 1rem', fontSize: '0.9rem' }}>
            List your pre-owned items and connect with buyers in your area.
          </p>
          <Link to={user ? "/submit" : "/register"} className="btn btn-green">
            {user ? 'List a Product' : 'Sign Up to Sell'}
          </Link>
        </div>
      )}
    </div>
  );
}
