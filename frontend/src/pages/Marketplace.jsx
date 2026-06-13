import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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

export default function Marketplace({ user }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [message, setMessage] = useState('');
  const [reservingId, setReservingId] = useState(null);
  const [reservedIds, setReservedIds] = useState([]);
  const [searchParams] = useSearchParams();

  const [filters, setFilters] = useState({
    latitude: 40.7128,
    longitude: -74.0060,
    radiusKm: 50,
    sortBy: searchParams.get('sortBy') || 'distance',
    category: searchParams.get('category') || '',
    q: searchParams.get('q') || '',
  });

  const search = async (nextFilters = filters) => {
    setLoading(true);
    setMessage('');
    try {
      const params = {
        latitude: nextFilters.latitude,
        longitude: nextFilters.longitude,
        radiusKm: nextFilters.radiusKm,
        sortBy: nextFilters.sortBy,
        limit: 40,
      };
      if (nextFilters.category) params.category = nextFilters.category;

      const result = await api.discoverNearby(params);
      let items = result.products || [];
      if (nextFilters.q) {
        const query = nextFilters.q.toLowerCase();
        items = items.filter(p => productName(p).toLowerCase().includes(query) || p.category.toLowerCase().includes(query));
      }
      setProducts(items);
      setTotalCount(items.length);
    } catch (err) {
      setMessage(err.message || 'Could not load products.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const nextFilters = {
      latitude: 40.7128,
      longitude: -74.0060,
      radiusKm: 50,
      sortBy: searchParams.get('sortBy') || 'distance',
      category: searchParams.get('category') || '',
      q: searchParams.get('q') || '',
    };
    setFilters(nextFilters);
    search(nextFilters);
  }, [searchParams]);

  const clearFilters = () => {
    const nextFilters = { ...filters, radiusKm: 50, category: '', q: '' };
    setFilters(nextFilters);
    search(nextFilters);
  };

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

  const getDiscount = (product) => {
    if (!product.recommendedPrice || !product.originalPrice) return 0;
    return Math.round(((product.originalPrice - product.recommendedPrice) / product.originalPrice) * 100);
  };

  const openProduct = (product) => {
    window.open(`/#/product/${product.productId}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div>
      <div className="section-header">
        <h2>User Products</h2>
        <span style={{ fontSize: '0.9rem', color: 'var(--gray-500)' }}>{totalCount} results</span>
      </div>

      <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
          <label>Search</label>
          <input value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} placeholder="Product name" />
        </div>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 120 }}>
          <label>Distance</label>
          <select value={filters.radiusKm} onChange={e => setFilters({ ...filters, radiusKm: parseFloat(e.target.value) })}>
            <option value="1">Within 1 km</option>
            <option value="2">Within 2 km</option>
            <option value="5">Within 5 km</option>
            <option value="10">Within 10 km</option>
            <option value="25">Within 25 km</option>
            <option value="50">Within 50 km</option>
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 120 }}>
          <label>Category</label>
          <select value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })}>
            <option value="">All Categories</option>
            <option value="electronics">Electronics</option>
            <option value="clothing">Clothing</option>
            <option value="furniture">Furniture</option>
            <option value="books">Books</option>
            <option value="toys">Toys</option>
            <option value="appliances">Appliances</option>
            <option value="sports">Sports</option>
            <option value="tools">Tools</option>
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 120 }}>
          <label>Sort By</label>
          <select value={filters.sortBy} onChange={e => setFilters({ ...filters, sortBy: e.target.value })}>
            <option value="distance">Nearest First</option>
            <option value="price">Price: Low to High</option>
            <option value="condition">Best Quality</option>
            <option value="recency">Newest First</option>
          </select>
        </div>
        <button className="btn btn-primary" onClick={() => search()} disabled={loading}>
          {loading ? 'Searching...' : 'Apply Filters'}
        </button>
        <button className="btn btn-secondary" onClick={clearFilters} disabled={loading}>Clear Filters</button>
      </div>

      {message && <div className="status-message">{message}</div>}
      {loading && <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>Finding products near you...</p>}

      {!loading && products.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p style={{ color: 'var(--gray-500)', marginBottom: '1rem' }}>No products found. Try adjusting your filters.</p>
          <button className="btn btn-primary" onClick={clearFilters}>Clear Filters</button>
        </div>
      )}

      <div className="product-grid">
        {products.map(product => {
          const discount = getDiscount(product);
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
              <span className="product-card-distance">{product.distance} km</span>
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
              <div className="product-card-eco">
                Earn {Math.round(product.recommendedPrice * 0.05)} Green Credits
              </div>
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
    </div>
  );
}
