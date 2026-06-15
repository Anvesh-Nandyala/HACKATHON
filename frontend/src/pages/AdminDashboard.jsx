import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRODUCT_STATUSES = [
  'listed', 'pending_verification', 'verified', 'reserved', 'sold',
  'returned', 'return_requested', 'refurbishment_review', 'recycled',
  'donated', 'rejected_media_mismatch', 'hidden', 'archived',
];

const TXN_STATUSES = ['reserved', 'completed', 'cancelled', 'return_requested'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function money(value) {
  if (!value && value !== 0) return 'N/A';
  return `$${Number(value).toLocaleString()}`;
}

function fmtDate(value) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'numeric', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function statusLabel(status) {
  if (!status) return 'Unknown';
  return String(status)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function getStatusClass(status) {
  const map = {
    listed: 'status-listed',
    pending_verification: 'status-pending',
    verified: 'status-verified',
    reserved: 'status-reserved',
    sold: 'status-sold',
    returned: 'status-returned',
    return_requested: 'status-returned',
    refurbishment_review: 'status-pending',
    recycled: 'status-recycled',
    donated: 'status-donated',
    rejected_media_mismatch: 'status-rejected',
    hidden: 'status-hidden',
    archived: 'status-archived',
    completed: 'status-sold',
    cancelled: 'status-hidden',
    admin: 'status-admin',
    seller: 'status-seller',
  };
  return map[status] || 'status-default';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub }) {
  return (
    <div className="adm-stat-card">
      <div className="adm-stat-label">{label}</div>
      <div className="adm-stat-value">{value}</div>
      {sub && <div className="adm-stat-sub">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`adm-badge ${getStatusClass(status)}`}>
      {statusLabel(status)}
    </span>
  );
}

function ActionSelect({ value, options, onChange, busy }) {
  return (
    <select
      className="adm-action-select"
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={busy}
    >
      {options.map(opt => (
        <option key={opt} value={opt}>{statusLabel(opt)}</option>
      ))}
    </select>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ stats }) {
  if (!stats) return <p className="adm-loading">Loading overview…</p>;

  const byStatus = stats.byStatus || {};
  const statusEntries = Object.entries(byStatus).filter(([, v]) => v > 0);

  return (
    <div className="adm-overview">
      <div className="adm-stat-grid">
        <StatCard label="Users" value={stats.totalUsers ?? '—'} sub="registered accounts" />
        <StatCard label="Products" value={stats.totalProducts ?? '—'} sub={`${stats.activeListed ?? 0} currently listed`} />
        <StatCard label="Reservations" value={stats.reserved ?? '—'} sub={`${stats.completedTransactions ?? 0} completed`} />
        <StatCard label="Completed Value" value={money(stats.completedValue)} sub="gross local pickup value" />
      </div>

      <div className="adm-overview-panels">
        <div className="adm-panel">
          <div className="adm-panel-title">Product Status</div>
          <div className="adm-status-grid">
            {statusEntries.map(([status, count]) => (
              <div key={status} className="adm-status-row">
                <StatusBadge status={status} />
                <span className="adm-status-count">{count}</span>
              </div>
            ))}
            {statusEntries.length === 0 && <p className="adm-muted">No products yet.</p>}
          </div>
        </div>

        <div className="adm-panel">
          <div className="adm-panel-title">Recent Audit</div>
          <p className="adm-muted" style={{ padding: '1rem 0' }}>No recent audit entries.</p>
        </div>
      </div>
    </div>
  );
}

// ─── Products Tab ─────────────────────────────────────────────────────────────

function ProductsTab({ stats }) {
  const [products, setProducts] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    setLoading(true);
    setMsg('');
    try {
      const params = statusFilter ? { status: statusFilter } : {};
      const data = await api.getAdminProducts(params);
      setProducts(data.products || []);
    } catch (err) {
      setMsg(err.message || 'Failed to load products.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const handleStatusChange = async (productId, newStatus) => {
    setBusy(true);
    setMsg('');
    try {
      await api.updateAdminProduct(productId, { status: newStatus });
      setMsg('Product updated.');
      await load();
    } catch (err) {
      setMsg(err.message || 'Failed to update product.');
    } finally {
      setBusy(false);
    }
  };

  const byStatus = stats?.byStatus || {};
  const totalProducts = stats?.totalProducts ?? products.length;

  return (
    <div className="adm-tab-content">
      <div className="adm-table-toolbar">
        <div className="adm-filter-row">
          <label className="adm-filter-label">Status</label>
          <select
            className="adm-filter-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {PRODUCT_STATUSES.map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
        </div>
        <div className="adm-count-chip">{totalProducts} products</div>
      </div>

      {msg && <div className="adm-msg">{msg}</div>}

      {loading ? (
        <p className="adm-loading">Loading products…</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>PRODUCT</th>
                <th>SELLER</th>
                <th>STATUS</th>
                <th>PRICE</th>
                <th>QUALITY</th>
                <th>ROUTE</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.productId}>
                  <td>
                    <div className="adm-cell-primary">{p.name}</div>
                    <div className="adm-cell-sub">{p.productId}</div>
                  </td>
                  <td>{p.sellerName || p.sellerId || '—'}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td>{money(p.recommendedPrice)}</td>
                  <td>{p.conditionScore ? `${p.conditionScore === 'A' || p.conditionScore === 'B' || p.conditionScore === 'C' || p.conditionScore === 'D' ? p.conditionScore : p.grade || '—'} / ${p.conditionScore}` : (p.grade ? `${p.grade} / —` : '—')}</td>
                  <td>{p.routingDestination || 'unknown'}</td>
                  <td>
                    <ActionSelect
                      value={p.status}
                      options={PRODUCT_STATUSES}
                      onChange={val => handleStatusChange(p.productId, val)}
                      busy={busy}
                    />
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={7} className="adm-empty">No products found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Transactions Tab ─────────────────────────────────────────────────────────

function TransactionsTab() {
  const [transactions, setTransactions] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    setLoading(true);
    setMsg('');
    try {
      const data = await api.getAdminTransactions();
      setTransactions(data.transactions || []);
    } catch (err) {
      setMsg(err.message || 'Failed to load transactions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleStatusChange = async (transactionId, newStatus) => {
    setBusy(true);
    setMsg('');
    try {
      await api.updateAdminTransaction(transactionId, { status: newStatus });
      setMsg('Transaction updated.');
      await load();
    } catch (err) {
      setMsg(err.message || 'Failed to update transaction.');
    } finally {
      setBusy(false);
    }
  };

  const filtered = statusFilter
    ? transactions.filter(t => t.status === statusFilter)
    : transactions;

  return (
    <div className="adm-tab-content">
      <div className="adm-table-toolbar">
        <div className="adm-filter-row">
          <label className="adm-filter-label">Status</label>
          <select
            className="adm-filter-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {TXN_STATUSES.map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
        </div>
        <div className="adm-count-chip">{filtered.length} transactions</div>
      </div>

      {msg && <div className="adm-msg">{msg}</div>}

      {loading ? (
        <p className="adm-loading">Loading transactions…</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>TRANSACTION</th>
                <th>SELLER</th>
                <th>BUYER</th>
                <th>STATUS</th>
                <th>PRICE</th>
                <th>CREATED</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.transactionId}>
                  <td>
                    <div className="adm-cell-primary">{t.productName}</div>
                    <div className="adm-cell-sub">{t.transactionId}</div>
                    <span className={`adm-type-badge adm-type-${t.type || 'reservation'}`}>
                      {t.type === 'cart_purchase' ? 'Cart Order' : 'Reservation'}
                    </span>
                  </td>
                  <td className="adm-link-cell">{t.sellerName}</td>
                  <td className="adm-link-cell">{t.buyerName}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>{money(t.price)}</td>
                  <td className="adm-date-cell">{fmtDate(t.createdAt)}</td>
                  <td>
                    <ActionSelect
                      value={t.status}
                      options={TXN_STATUSES}
                      onChange={val => handleStatusChange(t.transactionId, val)}
                      busy={busy}
                    />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="adm-empty">No transactions found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setLoading(true);
    api.getAdminUsers()
      .then(data => setUsers(data.users || []))
      .catch(err => setMsg(err.message || 'Failed to load users.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="adm-tab-content">
      {msg && <div className="adm-msg">{msg}</div>}
      {loading ? (
        <p className="adm-loading">Loading users…</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>USER</th>
                <th>EMAIL</th>
                <th>ROLE</th>
                <th>PRODUCTS</th>
                <th>CREDITS</th>
                <th>JOINED</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.userId}>
                  <td>
                    <div className="adm-cell-primary">{u.name}</div>
                    <div className="adm-cell-sub">{u.userId}</div>
                  </td>
                  <td className="adm-link-cell">{u.email}</td>
                  <td><StatusBadge status={u.role} /></td>
                  <td>{u.productCount}</td>
                  <td>{u.credits} / {u.tier}</td>
                  <td className="adm-date-cell">{fmtDate(u.createdAt)}</td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="adm-empty">No users found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Audit Tab ────────────────────────────────────────────────────────────────

function AuditTab() {
  return (
    <div className="adm-tab-content">
      <div className="adm-panel" style={{ marginTop: 0 }}>
        <div className="adm-panel-title">Audit Log</div>
        <p className="adm-muted" style={{ padding: '1rem 0' }}>No audit entries to display.</p>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [search, setSearch] = useState('');

  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    api.getAdminStats()
      .then(data => setStats(data))
      .catch(() => {})
      .finally(() => setLoadingStats(false));
  }, []);

  const handleSignOut = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const handleRefresh = () => {
    setLoadingStats(true);
    api.getAdminStats()
      .then(data => setStats(data))
      .catch(() => {})
      .finally(() => setLoadingStats(false));
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'products', label: 'Products' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'users', label: 'Users' },
    { id: 'audit', label: 'Audit' },
  ];

  return (
    <div className="adm-root">
      {/* Header */}
      <header className="adm-header">
        <div className="adm-header-left">
          <div className="adm-logo">ReCircle Admin</div>
          <div className="adm-logo-sub">Hackathon operations dashboard</div>
        </div>
        <div className="adm-header-right">
          <span className="adm-user-name">{user.name || 'Admin User'}</span>
          <button className="adm-signout-btn" onClick={handleSignOut}>Sign out</button>
        </div>
      </header>

      {/* Nav bar */}
      <div className="adm-navbar">
        <div className="adm-tabs">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`adm-tab-btn${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="adm-navbar-right">
          <input
            className="adm-search"
            placeholder="Search products, buyers, sellers"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="adm-refresh-btn" onClick={handleRefresh} disabled={loadingStats}>
            Refresh
          </button>
        </div>
      </div>

      {/* Tab content */}
      <main className="adm-main">
        {tab === 'overview' && <OverviewTab stats={stats} />}
        {tab === 'products' && <ProductsTab stats={stats} />}
        {tab === 'transactions' && <TransactionsTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'audit' && <AuditTab />}
      </main>
    </div>
  );
}
