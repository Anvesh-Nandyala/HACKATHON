import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const data = await api.login({ email, password });

      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      onLogin(data.user);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
        <Link to="/" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--gray-900)' }}>ReCircle</Link>
      </div>
      <div className="auth-card">
        <h2>Sign in</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
          </div>
          {error && <p style={{ color: 'var(--red)', marginBottom: '0.75rem', fontSize: '0.85rem' }}>{error}</p>}
          <button type="submit" className="btn btn-buy" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <div style={{ marginTop: '1.25rem', fontSize: '0.8rem', color: 'var(--gray-500)', textAlign: 'center' }}>
          By continuing, you agree to ReCircle's Conditions of Use and Privacy Notice.
        </div>
      </div>
      <div style={{ marginTop: '1.5rem', textAlign: 'center', position: 'relative' }}>
        <hr style={{ border: 'none', borderTop: '1px solid var(--gray-200)' }} />
        <span style={{ position: 'relative', top: '-0.6rem', background: 'var(--gray-100)', padding: '0 0.75rem', fontSize: '0.8rem', color: 'var(--gray-500)' }}>
          New to ReCircle?
        </span>
      </div>
      <Link to="/register" className="btn btn-secondary" style={{ width: '100%', marginTop: '0.5rem' }}>
        Create your ReCircle account
      </Link>
    </div>
  );
}
