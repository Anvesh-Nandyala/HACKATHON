import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, Link, useNavigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import SubmitProduct from './pages/SubmitProduct';
import ProductMediaUpload from './pages/ProductMediaUpload';
import Marketplace from './pages/Marketplace';
import Nearby from './pages/Nearby';
import ProductDetail from './pages/ProductDetail';
import Checkout from './pages/Checkout';
import Pickups from './pages/Pickups';
import PickupDetail from './pages/PickupDetail';
import MyProducts from './pages/MyProducts';
import Credits from './pages/Credits';
import AdminDashboard from './pages/AdminDashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import { api } from './api';
import OfflineBanner from './components/OfflineBanner';
import { useNotifications } from './hooks/useNotifications';

const CATEGORIES = [
  'Electronics', 'Clothing', 'Furniture', 'Books', 'Toys',
  'Appliances', 'Sports', 'Tools', 'Jewelry', 'Home & Garden'
];

function toCategoryValue(category) {
  return category.toLowerCase().replace(/\s*&\s*/g, '-').replace(/\s+/g, '-');
}

export default function App() {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });
  const [credits, setCredits] = useState(0);
  const [creditRefresh, setCreditRefresh] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [searchCategory, setSearchCategory] = useState('');
  const [cartCount, setCartCount] = useState(() => {
    const cart = JSON.parse(localStorage.getItem('demo_cart') || '[]');
    return cart.reduce((total, item) => total + (item.quantity || 1), 0);
  });

  const lastNotification = useNotifications(user);
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (lastNotification) {
      setShowToast(true);
      const timer = setTimeout(() => setShowToast(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [lastNotification]);

  useEffect(() => {
    if (user) {
      api.getBalance()
        .then(data => setCredits(data.totalCredits))
        .catch(() => {});
    }
  }, [user, creditRefresh]);

  useEffect(() => {
    const updateCartCount = () => {
      const cart = JSON.parse(localStorage.getItem('demo_cart') || '[]');
      setCartCount(cart.reduce((total, item) => total + (item.quantity || 1), 0));
    };
    window.addEventListener('cart-updated', updateCartCount);
    window.addEventListener('storage', updateCartCount);
    window.addEventListener('focus', updateCartCount);
    return () => {
      window.removeEventListener('cart-updated', updateCartCount);
      window.removeEventListener('storage', updateCartCount);
      window.removeEventListener('focus', updateCartCount);
    };
  }, []);

  const refreshCredits = () => setCreditRefresh(c => c + 1);

  const handleLogin = (userData) => setUser(userData);

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    setUser(null);
    setCredits(0);
    navigate('/');
  };

  const handleSearch = (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (searchCategory) params.set('category', searchCategory);
    if (searchText.trim()) params.set('q', searchText.trim());
    navigate(`/marketplace${params.toString() ? `?${params.toString()}` : ''}`);
  };

  if (user?.role === 'admin') {
    return (
      <div className="app">
        <header className="header">
          <div className="header-top">
            <Link to="/admin" className="header-logo">ReCircle Admin</Link>
            <div className="header-nav" style={{ marginLeft: 'auto' }}>
              <Link to="/admin" className="header-nav-item">
                <span>Manage</span>
                <strong>Dashboard</strong>
              </Link>
              <button type="button" onClick={handleLogout} className="header-nav-item header-button">
                <span>&nbsp;</span>
                <strong>Sign Out</strong>
              </button>
            </div>
          </div>
        </header>

        <main className="main">
          <Routes>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/login" element={<Navigate to="/admin" replace />} />
            <Route path="/register" element={<Navigate to="/admin" replace />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <OfflineBanner />
      {showToast && lastNotification && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          background: '#10b981',
          color: 'white',
          padding: '16px 24px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 9999,
          cursor: 'pointer'
        }} onClick={() => navigate(`/product/${lastNotification.productId}`)}>
          <strong>🔔 Match Found!</strong><br/>
          {lastNotification.category} • ${lastNotification.recommendedPrice}<br/>
          <small>{lastNotification.distance} km away</small>
        </div>
      )}
      <header className="header">
        <div className="header-top">
          <Link to="/" className="header-logo">ReCircle</Link>

          <div className="header-location">
            <span>Deliver to</span>
            <strong>Your Location</strong>
          </div>

          <form className="header-search" onSubmit={handleSearch}>
            <select value={searchCategory} onChange={e => setSearchCategory(e.target.value)} aria-label="Search category">
              <option value="">All</option>
              {CATEGORIES.map(c => <option key={c} value={toCategoryValue(c)}>{c}</option>)}
            </select>
            <input
              type="text"
              placeholder="Search products near you"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
            />
            <button type="submit">Search</button>
          </form>

          <div className="header-nav">
            <Link to="/checkout" className="header-nav-item">
              <span>{cartCount}</span>
              <strong>Cart</strong>
            </Link>
            {user ? (
              <>
                <Link to="/credits" className="header-nav-item">
                  <span>{credits}</span>
                  <strong>Green Credits</strong>
                </Link>
                <Link to="/my-products" className="header-nav-item">
                  <span>Hello, {user.name.split(' ')[0]}</span>
                  <strong>Account</strong>
                </Link>
                <Link to="/pickups" className="header-nav-item">
                  <span>&nbsp;</span>
                  <strong>Pickups</strong>
                </Link>
                <Link to="/submit" className="header-nav-item">
                  <span>Sell and</span>
                  <strong>List Product</strong>
                </Link>
                {user.role === 'admin' && (
                  <Link to="/admin" className="header-nav-item">
                    <span>Manage</span>
                    <strong>Admin</strong>
                  </Link>
                )}
                <button type="button" onClick={handleLogout} className="header-nav-item header-button">
                  <span>&nbsp;</span>
                  <strong>Sign Out</strong>
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="header-nav-item">
                  <span>Hello, Sign in</span>
                  <strong>Account</strong>
                </Link>
                <Link to="/register" className="header-nav-item">
                  <span>&nbsp;</span>
                  <strong>Sign Up</strong>
                </Link>
              </>
            )}
          </div>
        </div>

        <div className="header-sub">
          <div className="header-sub-inner">
            <NavLink to="/">Home</NavLink>
            <NavLink to="/nearby" style={{ color: '#10b981', fontWeight: 700 }}>Near You</NavLink>
            <NavLink to="/marketplace">All Products</NavLink>
            {CATEGORIES.slice(0, 6).map(c => (
              <NavLink key={c} to={`/marketplace?category=${toCategoryValue(c)}`}>{c}</NavLink>
            ))}
            {user && <NavLink to="/pickups">Pickups</NavLink>}
            {user && <NavLink to="/submit" style={{ color: 'var(--accent)' }}>Sell</NavLink>}
            {user?.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
          </div>
        </div>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard user={user} />} />
          <Route path="/marketplace" element={<Marketplace user={user} />} />
          <Route path="/nearby" element={<Nearby user={user} />} />
          <Route path="/product/:productId" element={<ProductDetail user={user} />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/pickups" element={user ? <Pickups /> : <Navigate to="/login" replace />} />
          <Route path="/pickups/:transactionId" element={user ? <PickupDetail /> : <Navigate to="/login" replace />} />
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login onLogin={handleLogin} />} />
          <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register onLogin={handleLogin} />} />
          <Route path="/submit" element={user ? <SubmitProduct /> : <Navigate to="/login" replace />} />
          <Route path="/submit/upload" element={user ? <ProductMediaUpload onCreditUpdate={refreshCredits} /> : <Navigate to="/login" replace />} />
          <Route path="/my-products" element={user ? <MyProducts /> : <Navigate to="/login" replace />} />
          <Route path="/credits" element={user ? <Credits /> : <Navigate to="/login" replace />} />
          <Route path="/admin" element={user?.role === 'admin' ? <AdminDashboard /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
