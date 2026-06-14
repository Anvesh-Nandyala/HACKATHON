import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const STATUSES = [
  'listed',
  'reserved',
  'sold',
  'returned',
  'return_requested',
  'refurbishment_review',
  'recycled',
  'donated',
  'rejected_media_mismatch',
  'hidden',
  'archived',
];

const CATEGORIES = [
  'electronics', 'clothing', 'furniture', 'books', 'toys',
  'appliances', 'sports', 'tools', 'jewelry', 'automotive',
  'home-garden', 'health-beauty', 'office', 'pet-supplies', 'other'
];

function money(value) {
  return value ? `$${value}` : 'N/A';
}

function date(value) {
  return value ? new Date(value).toLocaleDateString() : 'N/A';
}

function statusLabel(status) {
  return String(status || 'unknown').replace(/_/g, ' ');
}

function AdminMediaPreview({ product }) {
  const [media, setMedia] = useState({ images: [], video: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const imageCount = product.media?.imageCount || 0;
  const hasVideo = Boolean(product.media?.hasVideo);

  useEffect(() => {
    let cancelled = false;
    const urls = [];

    async function loadMedia() {
      if (!imageCount && !hasVideo) {
        setMedia({ images: [], video: '' });
        setError('');
        return;
      }

      setLoading(true);
      setError('');
      try {
        const imageIndexes = Array.from({ length: Math.min(imageCount, 4) }, (_, index) => index);
        const images = await Promise.all(
          imageIndexes.map(index => api.getAdminMediaUrl(product.productId, 'image', index))
        );
        urls.push(...images);

        const video = hasVideo
          ? await api.getAdminMediaUrl(product.productId, 'video', 0)
          : '';
        if (video) urls.push(video);

        if (!cancelled) setMedia({ images, video });
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load uploaded media.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMedia();

    return () => {
      cancelled = true;
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [product.productId, imageCount, hasVideo]);

  if (!imageCount && !hasVideo) {
    return <div className="admin-media-empty">No uploaded pictures or video.</div>;
  }

  return (
    <div className="admin-media-section">
      <h3>Uploaded Pictures and Video</h3>
      {loading && <div className="admin-muted">Loading media...</div>}
      {error && <div className="admin-media-error">{error}</div>}
      <div className="admin-media-grid">
        {media.images.map((url, index) => (
          <img
            key={url}
            className="admin-media-thumb"
            src={url}
            alt={`${product.name} upload ${index + 1}`}
          />
        ))}
        {media.video && (
          <video className="admin-media-video" src={media.video} controls />
        )}
      </div>
    </div>
  );
}

function ProductEditor({ product, onSave, onReturn, onResolveReturn, onDelete, busy }) {
  const [draft, setDraft] = useState(() => ({
    status: product.status || 'listed',
    category: product.category || 'electronics',
    brand: product.brand || '',
    model: product.model || '',
    condition: product.condition || 'like-new',
    recommendedPrice: product.recommendedPrice || '',
    adminNote: product.adminNote || '',
    returnReason: product.returnReason || '',
  }));

  useEffect(() => {
    setDraft({
      status: product.status || 'listed',
      category: product.category || 'electronics',
      brand: product.brand || '',
      model: product.model || '',
      condition: product.condition || 'like-new',
      recommendedPrice: product.recommendedPrice || '',
      adminNote: product.adminNote || '',
      returnReason: product.returnReason || '',
    });
  }, [product]);

  const update = field => event => setDraft({ ...draft, [field]: event.target.value });

  const payload = {
    ...draft,
    recommendedPrice: draft.recommendedPrice ? parseFloat(draft.recommendedPrice) : undefined,
  };

  return (
    <div className="admin-expanded-panel">
      <AdminMediaPreview product={product} />
      {product.returnInspection && (
        <div className="admin-media-section">
          <h3>AI Return Inspection</h3>
          <div className="admin-return-grid">
            <div><span>Damage</span><strong>{product.returnInspection.severity}</strong></div>
            <div><span>Decision</span><strong>{product.returnInspection.disposition}</strong></div>
            <div><span>Score</span><strong>{Math.round((product.returnInspection.damageScore || 0) * 100)}%</strong></div>
          </div>
          <p className="admin-muted">{product.returnInspection.recommendation}</p>
          {product.returnInspection.findings?.length > 0 && (
            <ul className="admin-return-findings">
              {product.returnInspection.findings.map((finding, index) => <li key={index}>{finding}</li>)}
            </ul>
          )}
          {product.returnInspection.disposition === 'admin_review' && (
            <div className="admin-editor-actions">
              <button className="btn btn-primary" disabled={busy} onClick={() => onResolveReturn(product.productId, { disposition: 'donate', adminNote: draft.adminNote })}>Donate</button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => onResolveReturn(product.productId, { disposition: 'recycle', adminNote: draft.adminNote })}>Recycle</button>
            </div>
          )}
          {product.returnInspection.disposition !== 'admin_review' && product.status !== 'listed' && (
            <div className="admin-editor-actions">
              <button className="btn btn-primary" disabled={busy} onClick={() => onResolveReturn(product.productId, { disposition: 'refurbish', adminNote: draft.adminNote })}>Relist Refurbished</button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => onResolveReturn(product.productId, { disposition: 'recycle', adminNote: draft.adminNote })}>Recycle</button>
            </div>
          )}
        </div>
      )}
      <div className="admin-editor">
        <div className="form-group">
          <label>Status</label>
          <select value={draft.status} onChange={update('status')}>
            {STATUSES.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Category</label>
          <select value={draft.category} onChange={update('category')}>
            {CATEGORIES.map(category => <option key={category} value={category}>{category.replace(/-/g, ' ')}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Brand</label>
          <input value={draft.brand} onChange={update('brand')} />
        </div>
        <div className="form-group">
          <label>Model</label>
          <input value={draft.model} onChange={update('model')} />
        </div>
        <div className="form-group">
          <label>Condition</label>
          <select value={draft.condition} onChange={update('condition')}>
            <option value="like-new">like new</option>
            <option value="refurbished">refurbished</option>
            <option value="used">used</option>
          </select>
        </div>
        <div className="form-group">
          <label>Price</label>
          <input type="number" min="1" value={draft.recommendedPrice} onChange={update('recommendedPrice')} />
        </div>
        <div className="form-group admin-editor-wide">
          <label>Return Reason</label>
          <input value={draft.returnReason} onChange={update('returnReason')} placeholder="Reason if returned" />
        </div>
        <div className="form-group admin-editor-wide">
          <label>Admin Note</label>
          <textarea rows="2" value={draft.adminNote} onChange={update('adminNote')} />
        </div>
        <div className="admin-editor-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => onSave(product.productId, payload)}>Save</button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => onReturn(product.productId, payload)}>Mark Returned</button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => onSave(product.productId, { status: 'hidden' })}>Hide</button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => onDelete(product.productId)}>Delete</button>
        </div>
      </div>
    </div>
  );
}

function ProductRow({ product, expanded, onExpand, onSave, onReturn, onResolveReturn, onDelete, busy }) {
  return (
    <>
      <tr>
        <td>
          <button className="table-link-button" type="button" onClick={() => onExpand(product.productId)}>
            {product.name}
          </button>
          <div className="admin-muted">{product.productId}</div>
        </td>
        <td>{product.category}</td>
        <td><span className={`admin-status admin-status-${product.status}`}>{statusLabel(product.status)}</span></td>
        <td>{money(product.recommendedPrice)}</td>
        <td>{product.conditionScore ? `${product.conditionScore}/100` : 'N/A'}</td>
        <td>{date(product.createdAt)}</td>
        <td><Link to={`/product/${product.productId}`} target="_blank">Open</Link></td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan="7">
            <ProductEditor
              product={product}
              onSave={onSave}
              onReturn={onReturn}
              onResolveReturn={onResolveReturn}
              onDelete={onDelete}
              busy={busy}
            />
          </td>
        </tr>
      )}
    </>
  );
}

export default function AdminDashboard() {
  const [tab, setTab] = useState('products');
  const [stats, setStats] = useState(null);
  const [products, setProducts] = useState([]);
  const [filters, setFilters] = useState({ q: '', status: '', category: '' });
  const [expandedId, setExpandedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const activeParams = useMemo(() => {
    if (tab === 'returns') return {};
    return Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
  }, [filters, tab]);

  const load = async () => {
    setLoading(true);
    setMessage('');
    try {
      const [nextStats, productData] = await Promise.all([
        api.getAdminStats(),
        tab === 'returns' ? api.getAdminReturns() : api.getAdminProducts(activeParams),
      ]);
      setStats(nextStats);
      setProducts(productData.products || []);
    } catch (err) {
      setMessage(err.message || 'Could not load admin dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [tab]);

  const saveProduct = async (productId, updates) => {
    setBusy(true);
    setMessage('');
    try {
      await api.updateAdminProduct(productId, updates);
      setMessage('Product updated.');
      await load();
    } catch (err) {
      setMessage(err.message || 'Could not update product.');
    } finally {
      setBusy(false);
    }
  };

  const markReturned = async (productId, updates) => {
    setBusy(true);
    setMessage('');
    try {
      await api.markAdminProductReturned(productId, updates);
      setMessage('Product marked returned.');
      await load();
    } catch (err) {
      setMessage(err.message || 'Could not mark product returned.');
    } finally {
      setBusy(false);
    }
  };

  const resolveReturn = async (productId, updates) => {
    setBusy(true);
    setMessage('');
    try {
      await api.resolveAdminReturn(productId, updates);
      setMessage(`Return resolved as ${updates.disposition}.`);
      await load();
    } catch (err) {
      setMessage(err.message || 'Could not resolve return.');
    } finally {
      setBusy(false);
    }
  };

  const deleteProduct = async (productId) => {
    if (!window.confirm('Delete this product permanently?')) return;
    setBusy(true);
    setMessage('');
    try {
      await api.deleteAdminProduct(productId);
      setExpandedId('');
      setMessage('Product deleted.');
      await load();
    } catch (err) {
      setMessage(err.message || 'Could not delete product.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="section-header">
        <h2>Admin Dashboard</h2>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>Refresh</button>
      </div>

      {stats && (
        <div className="admin-stats">
          <div className="stat-card"><div className="stat-value">{stats.totalProducts}</div><div className="stat-label">User Products</div></div>
          <div className="stat-card"><div className="stat-value">{stats.activeListed}</div><div className="stat-label">Existing Listings</div></div>
          <div className="stat-card"><div className="stat-value">{stats.returned}</div><div className="stat-label">Returned Products</div></div>
          <div className="stat-card"><div className="stat-value">{stats.reserved}</div><div className="stat-label">User to User</div></div>
        </div>
      )}

      <div className="admin-tabs">
        <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>Existing User Products</button>
        <button className={tab === 'returns' ? 'active' : ''} onClick={() => setTab('returns')}>Returned Products</button>
      </div>

      {tab === 'products' && (
        <div className="card admin-filters">
          <div className="form-group">
            <label>Search</label>
            <input value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} placeholder="Name, ID, seller" />
          </div>
          <div className="form-group">
            <label>Status</label>
            <select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}>
              <option value="">All</option>
              {STATUSES.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Category</label>
            <select value={filters.category} onChange={event => setFilters({ ...filters, category: event.target.value })}>
              <option value="">All</option>
              {CATEGORIES.map(category => <option key={category} value={category}>{category.replace(/-/g, ' ')}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={load} disabled={loading}>Apply</button>
        </div>
      )}

      {message && <div className="status-message">{message}</div>}
      {loading ? (
        <p style={{ padding: '2rem', color: 'var(--gray-500)' }}>Loading admin data...</p>
      ) : (
        <div className="card admin-table-card">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Status</th>
                <th>Price</th>
                <th>Quality</th>
                <th>Created</th>
                <th>View</th>
              </tr>
            </thead>
            <tbody>
              {products.map(product => (
                <ProductRow
                  key={product.productId}
                  product={product}
                  expanded={expandedId === product.productId}
                  onExpand={id => setExpandedId(expandedId === id ? '' : id)}
                  onSave={saveProduct}
                  onReturn={markReturned}
                  onResolveReturn={resolveReturn}
                  onDelete={deleteProduct}
                  busy={busy}
                />
              ))}
              {!products.length && (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '2rem' }}>
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
