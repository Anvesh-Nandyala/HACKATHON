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

function ProductEditor({ product, onSave, onReturn, onDelete, busy }) {
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
  );
}

function ProductRow({ product, expanded, onExpand, onSave, onReturn, onDelete, busy }) {
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
          <div className="stat-card"><div className="stat-value">{stats.totalProducts}</div><div className="stat-label">Total Products</div></div>
          <div className="stat-card"><div className="stat-value">{stats.activeListed}</div><div className="stat-label">Listed</div></div>
          <div className="stat-card"><div className="stat-value">{stats.returned}</div><div className="stat-label">Returned</div></div>
          <div className="stat-card"><div className="stat-value">{stats.reserved}</div><div className="stat-label">Reserved</div></div>
        </div>
      )}

      <div className="admin-tabs">
        <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>Products</button>
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
