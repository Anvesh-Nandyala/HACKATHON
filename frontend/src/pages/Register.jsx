import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';

export default function Register({ onLogin }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'seller' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const data = await api.register(form);

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

  const handleChange = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  return (
    <div className="auth-page">
      <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
        <Link to="/" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--gray-900)' }}>ReCircle</Link>
      </div>
      <div className="auth-card">
        <h2>Create account</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Your name</label>
            <input type="text" required value={form.name} onChange={handleChange('name')} placeholder="First and last name" />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" required value={form.email} onChange={handleChange('email')} placeholder="you@example.com" />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" required minLength="6" value={form.password} onChange={handleChange('password')} placeholder="At least 6 characters" />
          </div>

          {error && <p style={{ color: 'var(--red)', marginBottom: '0.75rem', fontSize: '0.85rem' }}>{error}</p>}
          <button type="submit" className="btn btn-buy" disabled={loading}>
            {loading ? 'Creating...' : 'Create your ReCircle account'}
          </button>
        </form>
        <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--gray-500)' }}>
          By creating an account, you agree to ReCircle's Conditions of Use and Privacy Notice.
        </div>
        <hr style={{ margin: '1rem 0', border: 'none', borderTop: '1px solid var(--gray-200)' }} />
        <p style={{ fontSize: '0.85rem' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
