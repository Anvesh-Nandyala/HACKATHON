import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

const DRAFT_KEY = 'product_submission_draft';

function productName(product) {
  return [product.brand, product.model].filter(Boolean).join(' ') || product.category;
}

function AnalysisResult({ result }) {
  return (
    <div className="card" style={{ border: '2px solid var(--green-light)' }}>
      <h3 style={{ color: 'var(--green-dark)', marginBottom: '1rem' }}>Analysis Complete</h3>
      <div className="status-message">Your product is now listed on the website.</div>
      <Link to={`/product/${result.productId}`} className="btn btn-primary" style={{ marginBottom: '1.25rem' }}>
        View Listing
      </Link>

      {result.creditsAwarded > 0 && (
        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1.25rem' }}>
          <span style={{ fontWeight: 700, color: '#065f46' }}>+{result.creditsAwarded} Green Credits earned</span>
        </div>
      )}

      <div style={{ marginBottom: '1.5rem' }}>
        <h4>Verification</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
          <span className={`grade-badge grade-${result.verification.grade}`}>{result.verification.grade}</span>
          <div>
            <div>Quality: {result.verification.conditionScore}/100</div>
            <div>Working: {result.verification.working ? 'Yes' : 'No'}</div>
            <div>Media match: {result.verification.declaredProductMatch === false ? 'No' : 'Yes'}</div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <h4>Pricing</h4>
        <div className="product-card-price" style={{ margin: '0.5rem 0' }}>${result.pricing.recommendedPrice}</div>
        <div style={{ color: 'var(--gray-500)', fontSize: '0.9rem' }}>
          Range: ${result.pricing.priceRange.min} - ${result.pricing.priceRange.max}
        </div>
      </div>

      <div>
        <h4>Routing Decision</h4>
        <div style={{ marginTop: '0.5rem' }}>
          <span className={`route-badge route-${result.routing.destination}`}>{result.routing.destination}</span>
        </div>
        <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--gray-500)' }}>
          {result.routing.reasoning}
        </p>
      </div>
    </div>
  );
}

export default function ProductMediaUpload({ onCreditUpdate }) {
  const navigate = useNavigate();
  const draft = useMemo(() => {
    const saved = sessionStorage.getItem(DRAFT_KEY);
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      return null;
    }
  }, []);

  const [photos, setPhotos] = useState([]);
  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handlePhotosChange = (event) => {
    setPhotos(Array.from(event.target.files || []));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setStatus('');
    setError('');
    setResult(null);

    try {
      if (!draft) {
        throw new Error('Product details are missing. Enter product details first.');
      }

      if (photos.length < 2) {
        throw new Error('Please choose at least 2 photos.');
      }

      if (!video) {
        throw new Error('Please choose a video.');
      }

      setStatus('Uploading photos...');
      const uploadedImages = [];
      for (const photo of photos.slice(0, 10)) {
        const uploaded = await api.uploadImage(photo);
        uploadedImages.push(uploaded.key);
      }

      setStatus('Uploading video...');
      const uploadedVideo = await api.uploadVideo(video);

      setStatus('Checking media against product details...');
      const response = await api.submitProduct({
        category: draft.category,
        brand: draft.brand,
        model: draft.model,
        originalPrice: draft.originalPrice,
        ageMonths: draft.ageMonths,
        condition: draft.condition || 'like-new',
        purchaseDate: draft.purchaseDate,
        imageKeys: uploadedImages,
        videoKey: uploadedVideo.key,
        pickupAddress: draft.pickupAddress,
        description: draft.description || undefined,
      });

      sessionStorage.removeItem(DRAFT_KEY);
      setResult(response);
      setStatus('');
      if (onCreditUpdate) onCreditUpdate();
    } catch (err) {
      setError(err.message);
      setStatus('');
    } finally {
      setLoading(false);
    }
  };

  if (!draft) {
    return (
      <div className="card">
        <h2 style={{ marginBottom: '1rem' }}>Product Details Needed</h2>
        <p style={{ color: 'var(--gray-500)', marginBottom: '1rem' }}>Enter the product details before uploading photos and video.</p>
        <Link to="/submit" className="btn btn-primary">Go to Product Details</Link>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Upload Product Media</h1>

      <div className="sell-layout">
        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>{productName(draft)}</h3>
          <div className="detail-facts" style={{ marginBottom: '1.25rem' }}>
            <div><strong>Category</strong><br />{draft.category.replace(/-/g, ' ')}</div>
            <div><strong>Purchase Date</strong><br />{draft.purchaseDate}</div>
            <div><strong>Original Price</strong><br />${draft.originalPrice}</div>
            <div><strong>Age</strong><br />{draft.ageMonths} months</div>
            <div><strong>Pickup Address</strong><br />{draft.pickupAddress}</div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Photos (2-10 required)</label>
              <input type="file" accept="image/*" multiple required onChange={handlePhotosChange} />
              <small style={{ color: 'var(--gray-500)' }}>
                {photos.length ? `${photos.length} selected` : 'Upload clear photos of the actual product'}
              </small>
            </div>

            <div className="form-group">
              <label>Video (under 60s)</label>
              <input type="file" accept="video/*" required onChange={event => setVideo(event.target.files?.[0] || null)} />
              <small style={{ color: 'var(--gray-500)' }}>
                {video ? video.name : 'Show the product from multiple angles'}
              </small>
            </div>

            {error && <p style={{ color: 'var(--red)', marginBottom: '1rem' }}>{error}</p>}
            {status && <p style={{ color: 'var(--gray-600)', marginBottom: '1rem' }}>{status}</p>}

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Processing...' : 'Upload and Analyze'}
              </button>
              <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => navigate('/submit')}>
                Edit Details
              </button>
            </div>
          </form>
        </div>

        <div>
          {result ? (
            <AnalysisResult result={result} />
          ) : (
            <div className="card">
              <h3 style={{ marginBottom: '1rem' }}>AI Match Check</h3>
              <p style={{ color: 'var(--gray-500)' }}>
                AI checks whether the uploaded media matches the saved category, brand, and model before listing the product.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
