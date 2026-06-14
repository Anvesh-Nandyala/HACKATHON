import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const CATEGORIES = [
  'electronics', 'clothing', 'furniture', 'books', 'toys',
  'appliances', 'sports', 'tools', 'jewelry', 'automotive',
  'home-garden', 'health-beauty', 'office', 'pet-supplies', 'other'
];

const DRAFT_KEY = 'product_submission_draft';

export default function SubmitProduct() {
  const navigate = useNavigate();
  const [form, setForm] = useState(() => {
    const saved = sessionStorage.getItem(DRAFT_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        sessionStorage.removeItem(DRAFT_KEY);
      }
    }

    return {
      category: 'electronics',
      brand: '',
      model: '',
      originalPrice: '',
      ageMonths: '',
      condition: 'like-new',
      purchaseDate: '',
      pickupAddress: '',
      description: '',
    };
  });
  const [error, setError] = useState('');

  const handleChange = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setError('');

    const details = {
      ...form,
      brand: form.brand.trim(),
      model: form.model.trim(),
      pickupAddress: form.pickupAddress.trim(),
      description: form.description.trim(),
      originalPrice: parseFloat(form.originalPrice),
      ageMonths: parseInt(form.ageMonths, 10),
    };

    if (!details.brand || !details.model || !details.pickupAddress || !details.purchaseDate) {
      setError('Fill all required fields before uploading media.');
      return;
    }

    if (!Number.isFinite(details.originalPrice) || details.originalPrice <= 0) {
      setError('Enter a valid original price.');
      return;
    }

    if (!Number.isInteger(details.ageMonths) || details.ageMonths < 0) {
      setError('Enter a valid product age.');
      return;
    }

    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(details));
    navigate('/submit/upload');
  };

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Submit a Product</h1>

      <div className="sell-layout sell-layout-narrow">
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

            {error && <p style={{ color: 'var(--red)', marginBottom: '1rem' }}>{error}</p>}

            <button type="submit" className="btn btn-primary">
              Continue to Upload
            </button>
          </form>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>Next Step</h3>
          <p style={{ color: 'var(--gray-500)' }}>
            After details are saved, upload product photos and a short video. AI will compare the media with the brand, model, and category before listing.
          </p>
        </div>
      </div>
    </div>
  );
}
