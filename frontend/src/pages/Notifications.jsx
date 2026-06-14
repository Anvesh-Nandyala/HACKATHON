import React, { useEffect, useState } from 'react';
import { api } from '../api';

const CATEGORIES = [
  'electronics',
  'clothing',
  'furniture',
  'books',
  'toys',
  'appliances',
  'sports',
  'tools',
  'jewelry',
  'home-garden',
];

const DEFAULT_FORM = {
  category: 'electronics',
  latitude: '40.7128',
  longitude: '-74.006',
  radiusKm: '10',
  minPrice: '',
  maxPrice: '',
};

function formatPriceRange(subscription) {
  if (!subscription.priceRange) return 'Any price';
  return `$${subscription.priceRange.min} to $${subscription.priceRange.max}`;
}

function formatLocation(subscription) {
  const lat = Number(subscription.location?.latitude);
  const lng = Number(subscription.location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'Location unavailable';
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

export default function Notifications() {
  const [subscriptions, setSubscriptions] = useState([]);
  const [mode, setMode] = useState('all');
  const [form, setForm] = useState(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadNotifications = async () => {
    setLoading(true);
    setError('');
    try {
      const [subsData, modeData] = await Promise.all([
        api.getNotificationSubscriptions(),
        api.getNotificationMode(),
      ]);
      setSubscriptions(subsData.subscriptions || []);
      setMode(modeData.mode || 'all');
    } catch (err) {
      setError(err.message || 'Unable to load notification settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, []);

  const updateForm = (field) => (event) => {
    setForm(current => ({ ...current, [field]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');

    const latitude = Number(form.latitude);
    const longitude = Number(form.longitude);
    const radiusKm = Number(form.radiusKm);
    const minPrice = form.minPrice === '' ? null : Number(form.minPrice);
    const maxPrice = form.maxPrice === '' ? null : Number(form.maxPrice);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setError('Enter a valid latitude and longitude');
      setSaving(false);
      return;
    }

    if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 50) {
      setError('Radius must be between 1 and 50 km');
      setSaving(false);
      return;
    }

    if ((minPrice !== null || maxPrice !== null) && (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice > maxPrice)) {
      setError('Enter a valid minimum and maximum price');
      setSaving(false);
      return;
    }

    try {
      const payload = {
        category: form.category,
        location: { latitude, longitude },
        radiusKm,
        ...(minPrice !== null && maxPrice !== null && {
          priceRange: { min: minPrice, max: maxPrice },
        }),
      };
      await api.createNotificationSubscription(payload);
      setForm(DEFAULT_FORM);
      setMessage('Subscription created. Matching products can now notify this user.');
      await loadNotifications();
    } catch (err) {
      setError(err.message || 'Unable to create subscription');
    } finally {
      setSaving(false);
    }
  };

  const handleModeChange = async (nextMode) => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const data = await api.updateNotificationMode(nextMode);
      setMode(data.mode);
      setMessage(`Notification mode changed to ${data.mode}.`);
    } catch (err) {
      setError(err.message || 'Unable to update notification mode');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (subscriptionId) => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      await api.deleteNotificationSubscription(subscriptionId);
      setMessage('Subscription deleted.');
      await loadNotifications();
    } catch (err) {
      setError(err.message || 'Unable to delete subscription');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="section-header">
        <h2>Notifications</h2>
        <span>{subscriptions.length} subscriptions</span>
      </div>

      {message && <div className="status-message">{message}</div>}
      {error && <div className="status-message status-message-error">{error}</div>}

      <div className="notifications-layout">
        <section className="card">
          <h3>Subscribe to product matches</h3>
          <p className="muted-text">Choose a category and nearby radius. When matching products are listed, the backend can notify this user.</p>

          <form onSubmit={handleSubmit} className="notification-form">
            <div className="form-group">
              <label>Category</label>
              <select value={form.category} onChange={updateForm('category')} required>
                {CATEGORIES.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Latitude</label>
                <input type="number" step="0.0001" value={form.latitude} onChange={updateForm('latitude')} required />
              </div>
              <div className="form-group">
                <label>Longitude</label>
                <input type="number" step="0.0001" value={form.longitude} onChange={updateForm('longitude')} required />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Radius km</label>
                <input type="number" min="1" max="50" value={form.radiusKm} onChange={updateForm('radiusKm')} required />
              </div>
              <div className="form-group">
                <label>Minimum price</label>
                <input type="number" min="0" step="1" placeholder="Optional" value={form.minPrice} onChange={updateForm('minPrice')} />
              </div>
              <div className="form-group">
                <label>Maximum price</label>
                <input type="number" min="0" step="1" placeholder="Optional" value={form.maxPrice} onChange={updateForm('maxPrice')} />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving' : 'Create Subscription'}
            </button>
          </form>
        </section>

        <section className="card">
          <h3>Notification mode</h3>
          <p className="muted-text">Use all for every match, or personalized to let AI suppress weak matches when Bedrock is enabled.</p>

          <div className="mode-control">
            <button
              type="button"
              className={mode === 'all' ? 'active' : ''}
              disabled={saving}
              onClick={() => handleModeChange('all')}
            >
              All matches
            </button>
            <button
              type="button"
              className={mode === 'personalized' ? 'active' : ''}
              disabled={saving}
              onClick={() => handleModeChange('personalized')}
            >
              Personalized
            </button>
          </div>

          <div className="notification-mode-card">
            <span>Current mode</span>
            <strong>{mode === 'personalized' ? 'Personalized' : 'All matches'}</strong>
          </div>
        </section>
      </div>

      <section className="card notification-list-card">
        <h3>Your subscriptions</h3>
        {loading ? (
          <p className="muted-text">Loading subscriptions...</p>
        ) : subscriptions.length === 0 ? (
          <p className="muted-text">No subscriptions yet. Create one for electronics near New York to show this phase in your demo.</p>
        ) : (
          <div className="subscription-grid">
            {subscriptions.map(subscription => (
              <div className="subscription-card" key={subscription.subscriptionId}>
                <div>
                  <strong>{subscription.category || 'All categories'}</strong>
                  <span>{formatLocation(subscription)}</span>
                </div>
                <div className="subscription-meta">
                  <span>Within {subscription.radiusKm} km</span>
                  <span>{formatPriceRange(subscription)}</span>
                </div>
                <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => handleDelete(subscription.subscriptionId)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
