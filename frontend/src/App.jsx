import React, { useEffect, useState, useRef } from 'react';
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
import Notifications from './pages/Notifications';
import Login from './pages/Login';
import Register from './pages/Register';
import { api } from './api';
import OfflineBanner from './components/OfflineBanner';
import { getBuyerLocation, saveBuyerLocation, getSavedAddresses, addSavedAddress, clearBuyerData, DEFAULT_BUYER_LOCATION } from './services/buyerLocation';

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
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchTimeout = useRef(null);

  const [buyerLocation, setBuyerLocation] = useState(() => getBuyerLocation());
  const [savedAddresses, setSavedAddresses] = useState(() => getSavedAddresses());
  const [locationOpen, setLocationOpen] = useState(false);
  const [addingNewLocation, setAddingNewLocation] = useState(false);
  const [locationName, setLocationName] = useState('');
  const [locationAddress, setLocationAddress] = useState(() => getBuyerLocation().address || '');
  const [locationStatus, setLocationStatus] = useState('');
  const [locationError, setLocationError] = useState('');
  
  const [cartCount, setCartCount] = useState(() => {
    const cart = JSON.parse(localStorage.getItem('demo_cart') || '[]');
    return cart.reduce((total, item) => total + (item.quantity || 1), 0);
  });

  useEffect(() => {
    if (user) {
      api.getBalance()
        .then(data => setCredits(data.totalCredits))
        .catch(() => {});
      
      api.getMe()
        .then(data => {
          if (data.addresses && data.addresses.length > 0) {
            localStorage.setItem('saved_buyer_addresses', JSON.stringify(data.addresses));
            setSavedAddresses(data.addresses);
          }
        })
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
    localStorage.removeItem('demo_cart');
    clearBuyerData();
    setUser(null);
    setCredits(0);
    setBuyerLocation(DEFAULT_BUYER_LOCATION);
    setSavedAddresses([]);
    navigate('/');
  };

  const handleSearchChange = (event) => {
    const value = event.target.value;
    setSearchText(value);
    setSelectedIndex(-1);
    
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    
    if (value.trim().length > 1) {
      setShowSuggestions(true);
      setIsSearching(true);
      searchTimeout.current = setTimeout(() => {
        api.searchProducts({ q: value.trim() })
          .then(data => setSuggestions((data.products || []).slice(0, 6)))
          .catch(() => setSuggestions([]))
          .finally(() => setIsSearching(false));
      }, 300);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    setShowSuggestions(false);
    setSelectedIndex(-1);
    const params = new URLSearchParams();
    if (searchCategory) params.set('category', searchCategory);
    if (searchText.trim()) params.set('q', searchText.trim());
    navigate(`/marketplace${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const handleSelectSuggestion = (suggestionText) => {
    setShowSuggestions(false);
    setSelectedIndex(-1);
    setSearchText(suggestionText);
    const params = new URLSearchParams();
    if (searchCategory) params.set('category', searchCategory);
    params.set('q', suggestionText);
    navigate(`/marketplace${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const handleKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      handleSelectSuggestion(suggestions[selectedIndex].name);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }
  };

  const handleOpenLocationModal = () => {
    setSavedAddresses(getSavedAddresses());
    setLocationOpen(true);
    setAddingNewLocation(getSavedAddresses().length === 0);
  };

  const handleSelectAddress = (address) => {
    setBuyerLocation(saveBuyerLocation(address));
    setLocationOpen(false);
  };

  const handleSaveAddress = async (event) => {
    event.preventDefault();
    setLocationStatus('');
    setLocationError('');

    if (!locationName.trim()) {
      setLocationError('Enter a name for this address (e.g. Home).');
      return;
    }
    if (!locationAddress.trim()) {
      setLocationError('Enter a city or full address.');
      return;
    }

    try {
      setLocationStatus('Finding location...');
      const data = await api.geocodeAddress(locationAddress.trim());
      
      const newLoc = {
        label: locationName.trim(),
        address: locationAddress.trim(),
        latitude: data.latitude,
        longitude: data.longitude,
      };
      
      const updatedAddresses = addSavedAddress(newLoc);
      setSavedAddresses(updatedAddresses);
      setBuyerLocation(saveBuyerLocation(newLoc));
      
      if (user) {
        api.updateAddresses(updatedAddresses).catch(() => {});
      }
      
      setLocationStatus('Location saved.');
      setLocationOpen(false);
      setAddingNewLocation(false);
      setLocationName('');
    } catch (err) {
      setLocationError(err.message || 'Could not find this address.');
      setLocationStatus('');
    }
  };

  const handleUseDeviceLocation = () => {
    setLocationStatus('');
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('Device location is not available in this browser.');
      return;
    }
    setLocationStatus('Reading device location...');
    navigator.geolocation.getCurrentPosition(
      position => {
        const newLoc = {
          label: locationName.trim() || 'Current Location',
          address: 'Current Location',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        const updatedAddresses = addSavedAddress(newLoc);
        setSavedAddresses(updatedAddresses);
        setBuyerLocation(saveBuyerLocation(newLoc));
        
        if (user) {
          api.updateAddresses(updatedAddresses).catch(() => {});
        }
        setLocationStatus('Location saved.');
        setLocationOpen(false);
        setAddingNewLocation(false);
        setLocationName('');
      },
      () => {
        setLocationError('Could not read device location.');
        setLocationStatus('');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
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
      <header className="header">
        <div className="header-top">
          <Link to="/" className="header-logo">ReCircle</Link>

          <button type="button" className="header-location header-location-button" onClick={handleOpenLocationModal}>
            <span>Deliver to</span>
            <strong>{buyerLocation.label}</strong>
          </button>

          <form className="header-search" onSubmit={handleSearchSubmit}>
            <select value={searchCategory} onChange={e => setSearchCategory(e.target.value)} aria-label="Search category">
              <option value="">All</option>
              {CATEGORIES.map(c => <option key={c} value={toCategoryValue(c)}>{c}</option>)}
            </select>
            <div className="search-wrapper">
              <input
                type="text"
                placeholder="Search products near you"
                value={searchText}
                onChange={handleSearchChange}
                onKeyDown={handleKeyDown}
                onFocus={() => { if (searchText.trim().length > 1) setShowSuggestions(true); }}
                onBlur={() => setTimeout(() => {
                  setShowSuggestions(false);
                  setSelectedIndex(-1);
                }, 200)}
              />
              {showSuggestions && (
                <div className="search-dropdown">
                  {isSearching ? (
                    <div className="search-dropdown-loading">Searching...</div>
                  ) : suggestions.length > 0 ? (
                    suggestions.map((p, index) => (
                      <button 
                        key={p.productId} 
                        type="button"
                        className={`search-dropdown-item ${selectedIndex === index ? 'selected' : ''}`}
                        onClick={() => handleSelectSuggestion(p.name)}
                      >
                        <span className="search-dropdown-icon">🔍</span>
                        <span className="search-dropdown-name">{p.name}</span>
                      </button>
                    ))
                  ) : (
                    <div className="search-dropdown-empty">No products found for "{searchText}"</div>
                  )}
                </div>
              )}
            </div>
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
                <Link to="/notifications" className="header-nav-item">
                  <span>Product</span>
                  <strong>Alerts</strong>
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
            {user && <NavLink to="/notifications">Alerts</NavLink>}
            {user && <NavLink to="/submit" style={{ color: 'var(--accent)' }}>Sell</NavLink>}
            {user?.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
          </div>
        </div>
      </header>

      {locationOpen && (
        <div className="location-overlay" role="presentation" onClick={() => setLocationOpen(false)}>
          <div className="location-modal" role="dialog" aria-modal="true" aria-labelledby="location-title" onClick={event => event.stopPropagation()}>
            <div className="location-modal-header">
              <h2 id="location-title">Choose your location</h2>
              <button type="button" className="location-close" onClick={() => setLocationOpen(false)}>Close</button>
            </div>
            <p className="muted-text">Delivery options and delivery speeds may vary for different locations</p>
            
            {!addingNewLocation && savedAddresses.length > 0 && (
              <>
                <div className="location-list">
                  {savedAddresses.map(addr => (
                    <button 
                      key={addr.id} 
                      type="button"
                      className={`location-item ${buyerLocation.label === addr.label && buyerLocation.address === addr.address ? 'active' : ''}`}
                      onClick={() => handleSelectAddress(addr)}
                    >
                      <div className="location-item-icon">📍</div>
                      <div className="location-item-content">
                        <span className="location-item-label">{addr.label}</span>
                        <span className="location-item-address">{addr.address}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="location-divider">or enter a new address</div>
                <button type="button" className="btn btn-secondary" style={{width: '100%'}} onClick={() => setAddingNewLocation(true)}>
                  Add a new address
                </button>
              </>
            )}

            {(addingNewLocation || savedAddresses.length === 0) && (
              <form onSubmit={handleSaveAddress} style={{marginTop: savedAddresses.length > 0 ? '1rem' : 0}}>
                {savedAddresses.length > 0 && (
                  <button type="button" className="table-link-button" style={{marginBottom: '1rem'}} onClick={() => setAddingNewLocation(false)}>
                    &larr; Back to saved addresses
                  </button>
                )}
                <div className="form-group">
                  <label>Location Name (e.g., Home, Work)</label>
                  <input
                    value={locationName}
                    onChange={event => setLocationName(event.target.value)}
                    placeholder="e.g. Home"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Address or city</label>
                  <input
                    value={locationAddress}
                    onChange={event => setLocationAddress(event.target.value)}
                    placeholder="e.g. MG Road, Bengaluru, India"
                    required
                  />
                </div>
                {locationError && <div className="status-message status-message-error">{locationError}</div>}
                {locationStatus && <div className="status-message">{locationStatus}</div>}
                <div className="location-actions">
                  <button type="submit" className="btn btn-primary">Save Location</button>
                  <button type="button" className="btn btn-secondary" onClick={handleUseDeviceLocation}>Use Device Location</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard user={user} buyerLocation={buyerLocation} />} />
          <Route path="/marketplace" element={<Marketplace user={user} buyerLocation={buyerLocation} />} />
          <Route path="/nearby" element={<Nearby user={user} buyerLocation={buyerLocation} />} />
          <Route path="/product/:productId" element={<ProductDetail user={user} />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/pickups" element={user ? <Pickups /> : <Navigate to="/login" replace />} />
          <Route path="/pickups/:transactionId" element={user ? <PickupDetail /> : <Navigate to="/login" replace />} />
          <Route path="/notifications" element={user ? <Notifications /> : <Navigate to="/login" replace />} />
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
