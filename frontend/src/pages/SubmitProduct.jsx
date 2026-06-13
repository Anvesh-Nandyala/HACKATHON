import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const CATEGORIES = [
  'electronics', 'clothing', 'furniture', 'books', 'toys',
  'appliances', 'sports', 'tools', 'jewelry', 'automotive',
  'home-garden', 'health-beauty', 'office', 'pet-supplies', 'other'
];

export default function SubmitProduct({ onCreditUpdate }) {
  const [form, setForm] = useState({
    category: 'electronics',
    brand: '',
    model: '',
    originalPrice: '',
    ageMonths: '',
    condition: 'like-new',
    purchaseDate: '',
    pickupAddress: '',
    description: '',
    photos: [],
    video: null,
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      if (form.photos.length < 2) {
        throw new Error('Please choose at least 2 photos.');
      }

      if (!form.video) {
        throw new Error('Please choose a video.');
      }

      const data = {
        category: form.category,
        brand: form.brand.trim(),
        model: form.model.trim(),
        originalPrice: parseFloat(form.originalPrice),
        ageMonths: parseInt(form.ageMonths),
        condition: form.condition,
        purchaseDate: form.purchaseDate,
        imageKeys: form.photos.length
          ? form.photos.slice(0, 10).map((file, index) => file.name || `photo-${index + 1}.jpg`)
          : ['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg'],
        videoKey: form.video.name,
        location: { latitude: 40.7128, longitude: -74.0060 },
        pickupAddress: form.pickupAddress.trim(),
        description: form.description || undefined,
      };

      const response = await api.submitProduct(data);
      setResult(response);
      if (onCreditUpdate) onCreditUpdate();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
  };

  const handlePhotosChange = (event) => {
    const files = Array.from(event.target.files || []);
    setForm({ ...form, photos: files });
  };

  const handleVideoChange = (event) => {
    setForm({ ...form, video: event.target.files?.[0] || null });
  };

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Submit a Product</h1>

      <div className="sell-layout">
        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>Product Details</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Category</label>
              <select value={form.category} onChange={handleChange('category')} required>
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.replace(/-/g, ' ')}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Brand</label>
              <input type="text" required placeholder="e.g. Samsung, Nike" value={form.brand} onChange={handleChange('brand')} />
            </div>

            <div className="form-group">
              <label>Model</label>
              <input type="text" required placeholder="e.g. Galaxy S21, Air Max" value={form.model} onChange={handleChange('model')} />
            </div>

            <div className="form-group">
              <label>Original Price ($)</label>
              <input type="number" min="1" step="0.01" required placeholder="800.00" value={form.originalPrice} onChange={handleChange('originalPrice')} />
            </div>

            <div className="form-group">
              <label>Age (months)</label>
              <input type="number" min="0" required placeholder="12" value={form.ageMonths} onChange={handleChange('ageMonths')} />
            </div>

            <div className="form-group">
              <label>Date of Purchase</label>
              <input type="date" required value={form.purchaseDate} onChange={handleChange('purchaseDate')} />
            </div>

            <div className="form-group">
              <label>Pickup Address</label>
              <textarea
                rows="3"
                required
                placeholder="Full address where buyer should pick up the product"
                value={form.pickupAddress}
                onChange={handleChange('pickupAddress')}
              />
            </div>

            <div className="form-group">
              <label>Description (optional)</label>
              <textarea rows="3" placeholder="Any details about the product..." value={form.description} onChange={handleChange('description')} />
            </div>

            <div className="form-group">
              <label>Photos (2-10 required)</label>
              <input type="file" accept="image/*" multiple required onChange={handlePhotosChange} />
              <small style={{ color: 'var(--gray-500)' }}>
                {form.photos.length ? `${form.photos.length} selected` : 'Demo mode: files are selected locally only'}
              </small>
            </div>

            <div className="form-group">
              <label>Video (under 60s)</label>
              <input type="file" accept="video/*" required onChange={handleVideoChange} />
              <small style={{ color: 'var(--gray-500)' }}>
                {form.video ? form.video.name : 'Demo mode: file is selected locally only'}
              </small>
            </div>

            {error && <p style={{ color: 'var(--red-500)', marginBottom: '1rem' }}>{error}</p>}

            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Processing...' : 'Submit and Analyze'}
            </button>
          </form>
        </div>

        <div>
          {result && (
            <div className="card" style={{ border: '2px solid var(--green-200)' }}>
              <h3 style={{ color: 'var(--green-700)', marginBottom: '1rem' }}>Analysis Complete</h3>
              <div className="status-message">
                Your product is now listed on the website.
              </div>
              <Link to={`/product/${result.productId}`} className="btn btn-primary" style={{ marginBottom: '1.25rem' }}>
                View Listing
              </Link>

              {result.creditsAwarded > 0 && (
                <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1.25rem' }}>
                  <span style={{ fontWeight: 700, color: '#065f46' }}>+{result.creditsAwarded} Green Credits earned!</span>
                </div>
              )}

              <div style={{ marginBottom: '1.5rem' }}>
                <h4>Verification</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
                  <span className={`grade grade-${result.verification.grade}`}>{result.verification.grade}</span>
                  <div>
                    <div>Score: {result.verification.conditionScore}/100</div>
                    <div>Working: {result.verification.working ? 'Yes' : 'No'}</div>
                    <div>Confidence: {Math.round(result.verification.confidence * 100)}%</div>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <h4>Pricing</h4>
                <div className="product-card-price" style={{ margin: '0.5rem 0' }}>${result.pricing.recommendedPrice}</div>
                <div style={{ color: 'var(--gray-500)', fontSize: '0.9rem' }}>
                  Range: ${result.pricing.priceRange.min} - ${result.pricing.priceRange.max}
                </div>
                <div style={{ color: 'var(--gray-500)', fontSize: '0.9rem' }}>
                  Est. {result.pricing.estimatedDaysToSell} days to sell
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <h4>Routing Decision</h4>
                <div style={{ marginTop: '0.5rem' }}>
                  <span className={`route-badge route-${result.routing.destination}`}>{result.routing.destination}</span>
                </div>
                <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--gray-500)' }}>
                  {result.routing.reasoning}
                </p>
                <div style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
                  Recovery value: <strong>${result.routing.recoveryValue}</strong>
                </div>
              </div>

              {result.routing.alternatives?.length > 0 && (
                <div>
                  <h4>Alternative Routes</h4>
                  {result.routing.alternatives.map((alt, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem', fontSize: '0.85rem' }}>
                      <span className={`badge route-${alt.destination}`}>{alt.destination}</span>
                      <span>${alt.recoveryValue}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!result && !loading && (
            <div className="card" style={{ textAlign: 'center', color: 'var(--gray-500)' }}>
              <p>Submit a product to see AI verification, pricing, and routing results.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
