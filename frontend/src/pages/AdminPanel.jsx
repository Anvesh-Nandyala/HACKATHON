import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const PRODUCT_STATUSES = [
  'listed',
  'reserved',
  'sold',
  'admin_hidden',
  'expired',
  'donated',
  'recycled',
  'rejected_media_mismatch',
];

const TRANSACTION_STATUSES = ['reserved', 'pickup_scheduled', 'completed', 'cancelled'];

function formatDate(value) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString();
}

function money(value) {
  return `$${Number(value || 0).toLocaleString()}`;
}

function statusLabel(value) {
  return String(value || 'unknown').replace(/_/g, ' ');
}

function badgeClass(status) {
  if (status === 'listed' || status === 'completed' || status === 'sold') return 'badge-green';
  if (status === 'reserved' || status === 'pickup_scheduled') return 'badge-orange';
  if (status === 'admin_hidden' || status === 'cancelled' || status?.startsWith('rejected')) return 'badge-red';
  return 'badge-blue';
}

function StatCard({ label, value, hint }) {
  return (
    <div className="admin-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function EmptyState({ label }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>
      {label}
    </div>
  );
}

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [productStatusFilter, setProductStatusFilter] = useState('');
  const [transactionStatusFilter, setTransactionStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState('');
  const [message, setMessage] = useState('');

  const metrics = overview?.metrics || {};

  const productCounts = useMemo(() => {
    return products.reduce((counts, product) => {
      counts[product.status] = (counts[product.status] || 0) + 1;
      return counts;
    }, {});
  }, [products]);

  const loadAdminData = async () => {
    setLoading(true);
    setMessage('');
    try {
      const [overviewData, usersData, productsData, transactionsData] = await Promise.all([
        api.getAdminOverview(),
        api.getAdminUsers(),
        api.getAdminProducts(productStatusFilter ? { status: productStatusFilter } : {}),
        api.getAdminTransactions(transactionStatusFilter ? { status: transactionStatusFilter } : {}),
      ]);
      setOverview(overviewData);
      setUsers(usersData.users || []);
      setProducts(productsData.products || []);
      setTransactions(transactionsData.transactions || []);
    } catch (err) {
      setMessage(err.message || 'Could not load admin data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, [productStatusFilter, transactionStatusFilter]);

  const updateProductStatus = async (productId, status) => {
    setWorkingId(productId);
    setMessage('');
    try {
      await api.updateAdminProductStatus(productId, status, `Admin changed product status to ${status}`);
      setMessage('Product status updated.');
      await loadAdminData();
    } catch (err) {
      setMessage(err.message || 'Could not update product.');
    } finally {
      setWorkingId('');
    }
  };

  const updateTransactionStatus = async (transactionId, status) => {
    setWorkingId(transactionId);
    setMessage('');
    try {
      await api.updateAdminTransactionStatus(transactionId, status, `Admin changed transaction status to ${status}`);
      setMessage('Transaction status updated.');
      await loadAdminData();
    } catch (err) {
      setMessage(err.message || 'Could not update transaction.');
    } finally {
      setWorkingId('');
    }
  };

  return (
    <div>
      <div className="section-header">
        <h2>Admin Panel</h2>
        <button type="button" className="btn btn-secondary" onClick={loadAdminData} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {message && <div className="status-message">{message}</div>}

      <div className="admin-tabs">
        {['overview', 'products', 'users', 'transactions'].map(tab => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? 'active' : ''}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div>
          <div className="admin-stat-grid">
            <StatCard label="Users" value={metrics.totalUsers || 0} hint="registered accounts" />
            <StatCard label="Products" value={metrics.totalProducts || 0} hint={`${metrics.listedProducts || 0} listed`} />
            <StatCard label="Reservations" value={metrics.totalTransactions || 0} hint={`${metrics.completedTransactions || 0} completed`} />
            <StatCard label="Completed Value" value={money(metrics.grossCompletedValue)} hint="gross pickup value" />
          </div>

          <div className="admin-two-column">
            <div className="card">
              <h3 style={{ marginBottom: '1rem' }}>Recent Products</h3>
              {(overview?.recentProducts || []).length === 0 ? (
                <p style={{ color: 'var(--gray-500)' }}>No product activity yet.</p>
              ) : (
                <div className="admin-mini-list">
                  {overview.recentProducts.map(product => (
                    <div key={product.productId}>
                      <strong>{product.name}</strong>
                      <span className={`badge ${badgeClass(product.status)}`}>{statusLabel(product.status)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h3 style={{ marginBottom: '1rem' }}>Recent Transactions</h3>
              {(overview?.recentTransactions || []).length === 0 ? (
                <p style={{ color: 'var(--gray-500)' }}>No reservations yet.</p>
              ) : (
                <div className="admin-mini-list">
                  {overview.recentTransactions.map(transaction => (
                    <div key={transaction.transactionId}>
                      <strong>{transaction.productName}</strong>
                      <span>{money(transaction.agreedPrice)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'products' && (
        <div>
          <div className="card admin-filter-bar">
            <div className="form-group">
              <label>Status</label>
              <select value={productStatusFilter} onChange={event => setProductStatusFilter(event.target.value)}>
                <option value="">All statuses</option>
                {PRODUCT_STATUSES.map(status => (
                  <option key={status} value={status}>{statusLabel(status)}</option>
                ))}
              </select>
            </div>
            <div className="admin-filter-summary">
              {products.length} products loaded / {productCounts.listed || 0} listed
            </div>
          </div>

          {products.length === 0 ? <EmptyState label="No products match this filter." /> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Price</th>
                    <th>Quality</th>
                    <th>Created</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(product => (
                    <tr key={product.productId}>
                      <td>
                        <Link to={`/product/${product.productId}`}>{product.name}</Link>
                        <small>{product.productId}</small>
                      </td>
                      <td>{product.category}</td>
                      <td><span className={`badge ${badgeClass(product.status)}`}>{statusLabel(product.status)}</span></td>
                      <td>{money(product.recommendedPrice || product.originalPrice)}</td>
                      <td>{product.grade || 'N/A'} {product.conditionScore ? `(${product.conditionScore})` : ''}</td>
                      <td>{formatDate(product.createdAt)}</td>
                      <td>
                        <select
                          value={product.status}
                          disabled={workingId === product.productId}
                          onChange={event => updateProductStatus(product.productId, event.target.value)}
                        >
                          {PRODUCT_STATUSES.map(status => (
                            <option key={status} value={status}>{statusLabel(status)}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'users' && (
        users.length === 0 ? <EmptyState label="No users found." /> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Products</th>
                  <th>Credits</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.userId}>
                    <td>
                      <strong>{user.name}</strong>
                      <small>{user.userId}</small>
                    </td>
                    <td>{user.email}</td>
                    <td><span className={`badge ${user.role === 'admin' ? 'badge-blue' : 'badge-green'}`}>{user.role}</span></td>
                    <td>{user.productCount}</td>
                    <td>{user.totalCredits} / {user.tier}</td>
                    <td>{formatDate(user.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {activeTab === 'transactions' && (
        <div>
          <div className="card admin-filter-bar">
            <div className="form-group">
              <label>Status</label>
              <select value={transactionStatusFilter} onChange={event => setTransactionStatusFilter(event.target.value)}>
                <option value="">All statuses</option>
                {TRANSACTION_STATUSES.map(status => (
                  <option key={status} value={status}>{statusLabel(status)}</option>
                ))}
              </select>
            </div>
            <div className="admin-filter-summary">{transactions.length} transactions loaded</div>
          </div>

          {transactions.length === 0 ? <EmptyState label="No transactions match this filter." /> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th>Seller</th>
                    <th>Buyer</th>
                    <th>Status</th>
                    <th>Price</th>
                    <th>Created</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(transaction => (
                    <tr key={transaction.transactionId}>
                      <td>
                        <strong>{transaction.productName}</strong>
                        <small>{transaction.transactionId}</small>
                      </td>
                      <td>{transaction.sellerName}</td>
                      <td>{transaction.buyerName}</td>
                      <td><span className={`badge ${badgeClass(transaction.status)}`}>{statusLabel(transaction.status)}</span></td>
                      <td>{money(transaction.agreedPrice)}</td>
                      <td>{formatDate(transaction.createdAt)}</td>
                      <td>
                        <select
                          value={transaction.status}
                          disabled={workingId === transaction.transactionId}
                          onChange={event => updateTransactionStatus(transaction.transactionId, event.target.value)}
                        >
                          {TRANSACTION_STATUSES.map(status => (
                            <option key={status} value={status}>{statusLabel(status)}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
