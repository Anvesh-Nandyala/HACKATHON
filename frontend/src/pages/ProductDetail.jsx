import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import AIInspectionReport from '../components/AIInspectionReport';
import CompatibilityCheck from '../components/CompatibilityCheck';
import GreenImpactModal from '../components/GreenImpactModal';
import ReturnRiskCheck from '../components/ReturnRiskCheck';

function productName(product) {
  return product.name || [product.brand, product.model].filter(Boolean).join(' ') || product.category || 'Product';
}

function formatPurchaseDate(value) {
  if (!value) return 'Date not provided';
  return new Date(value).toLocaleDateString();
}

function pickupWindow() {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function loadDemoProduct(productId) {
  if (!productId.startsWith('demo-')) return null;
  const demoProducts = JSON.parse(localStorage.getItem('demo_products') || '[]');
  const id = Number(productId.replace('demo-', ''));
  const product = demoProducts.find(item => item.id === id);
  if (!product) return null;

  return {
    ...product,
    productId,
    brand: product.name,
    model: '',
    recommendedPrice: product.price,
    condition: 'new',
    status: 'listed',
    description: `${product.name} in ${product.category}.`,
    avgRating: product.rating || 4.5,
    reviewCount: product.reviews || 0,
    reviews: [
      { name: 'Customer', rating: 5, title: 'Good product', text: 'Product matched the listing and arrived as expected.', daysAgo: 8, verifiedPurchase: true },
      { name: 'Buyer', rating: 4, title: 'Worth the price', text: 'Solid value and easy checkout.', daysAgo: 21, verifiedPurchase: true },
    ],
    location: { city: 'Delivery available' },
  };
}

export default function ProductDetail({ user }) {
  const { productId } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [cartQuantity, setCartQuantity] = useState(0);
  const [showImpactModal, setShowImpactModal] = useState(false);
  const [impactData, setImpactData] = useState(null);

  const isDemo = productId.startsWith('demo-');

  useEffect(() => {
    setLoading(true);
    setError(null);
    setMessage('');

    if (isDemo) {
      const demoProduct = loadDemoProduct(productId);
      if (demoProduct) {
        setProduct(demoProduct);
      } else {
        setError('Product not found');
      }
      setLoading(false);
      return;
    }

    api.getProductDetail(productId)
      .then(setProduct)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [productId, isDemo]);

  useEffect(() => {
    if (!product) return;
    const saved = JSON.parse(localStorage.getItem('demo_cart') || '[]');
    const id = product.id || product.productId;
    const item = saved.find(cartItem => cartItem.id === id);
    setCartQuantity(item?.quantity || (item ? 1 : 0));
  }, [product]);

  const handleAction = async () => {
    if (!product) return;

    if (isDemo) {
      const saved = JSON.parse(localStorage.getItem('demo_cart') || '[]');
      const id = product.id || product.productId;
      if (!saved.some(item => item.id === id)) {
        localStorage.setItem('demo_cart', JSON.stringify([...saved, {
          id,
          name: productName(product),
          price: product.recommendedPrice || product.price,
          category: product.category,
          quantity: 1,
        }]));
        window.dispatchEvent(new Event('cart-updated'));
      }
      setMessage('Added to cart.');
      return;
    }

    if (!user) {
      navigate('/login');
      return;
    }

    setWorking(true);
    setMessage('');
    try {
      await api.reserveProduct({
        productId: product.productId,
        agreedPrice: product.recommendedPrice,
        pickupWindow: pickupWindow(),
      });
      setProduct({ ...product, status: 'reserved' });
      setMessage('Reserved for pickup. Open Pickups to see your OTP.');
      setImpactData({
        co2SavedKg: product.co2SavedKg || 3.5,
        creditsAwarded: 25,
        tierProgress: 65,
        nextTier: 'Silver',
      });
      setShowImpactModal(true);
    } catch (err) {
      setMessage(err.message || 'Could not reserve this product.');
    } finally {
      setWorking(false);
    }
  };

  const changeCartQuantity = (delta) => {
    if (!product) return;

    const id = product.id || product.productId;
    const saved = JSON.parse(localStorage.getItem('demo_cart') || '[]');
    const existing = saved.find(item => item.id === id);
    const currentQuantity = existing?.quantity || (existing ? 1 : 0);
    const nextQuantity = Math.max(0, currentQuantity + delta);
    const cartItem = {
      id,
      name: productName(product),
      price: product.recommendedPrice || product.price,
      category: product.category,
      quantity: nextQuantity,
    };
    const next = nextQuantity === 0
      ? saved.filter(item => item.id !== id)
      : [...saved.filter(item => item.id !== id), cartItem];

    localStorage.setItem('demo_cart', JSON.stringify(next));
    window.dispatchEvent(new Event('cart-updated'));
    setCartQuantity(nextQuantity);
    setMessage(nextQuantity > 0 ? 'Cart updated.' : 'Removed from cart.');
  };

  if (loading) {
    return <p style={{ padding: '3rem', textAlign: 'center', color: 'var(--gray-500)' }}>Loading product...</p>;
  }

  if (error || !product) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
        <h3>Product not found</h3>
        <p style={{ color: 'var(--gray-500)', margin: '0.5rem 0 1rem' }}>{error || 'This product may no longer be available.'}</p>
        <Link to="/marketplace" className="btn btn-primary">Browse Products</Link>
      </div>
    );
  }

  const name = productName(product);
  const price = product.recommendedPrice || product.price;
  const discount = product.originalPrice && price
    ? Math.round(((product.originalPrice - price) / product.originalPrice) * 100)
    : 0;
  const greenCredits = price ? Math.round(price * 0.05) : 0;
  const isAvailable = product.status === 'listed';

  return (
    <div>
      <div style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginBottom: '1rem' }}>
        <Link to="/">Home</Link> / <Link to="/marketplace">Marketplace</Link> / <span>{name}</span>
      </div>

      <div className="detail-grid">
        <div className="detail-gallery">
          <div className="detail-image">{product.category}</div>
          <div className="detail-thumbs">
            {[1, 2, 3, 4].map(index => (
              <div className="detail-thumb" key={index}>{index}</div>
            ))}
          </div>
        </div>

        <div>
          <h1 className="detail-title">{name}</h1>
          {product.condition === 'refurbished' && (
            <div className="recommendation-badge certified" style={{ marginBottom: '0.75rem' }}>Refurbished</div>
          )}
          <div className="product-card-rating">
            <span>{product.avgRating || 4.5} rating</span>
            <span style={{ color: 'var(--blue)' }}>{product.reviewCount || 0} reviews</span>
          </div>

          <hr style={{ margin: '1rem 0', border: 'none', borderTop: '1px solid var(--gray-200)' }} />

          <div className="detail-price">
            ${price}
            {discount > 0 && (
              <>
                <span className="original">${product.originalPrice}</span>
                <span className="discount">Save {discount}%</span>
              </>
            )}
          </div>

          {!isDemo && (
            <div className="product-card-eco">Earn {greenCredits} Green Credits with this purchase</div>
          )}

          <div style={{ marginTop: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>About this item</h3>
            <p style={{ color: 'var(--gray-700)', fontSize: '0.9rem' }}>{product.description || 'No description provided.'}</p>
          </div>

          {!isDemo && (
            <div className="detail-panel">
              <h3>Product Quality</h3>
              <div className="detail-facts">
                <div>Quality factor: <strong>{product.conditionScore ? `${product.conditionScore}/100` : 'N/A'}</strong></div>
                <div>Date of purchase: <strong>{formatPurchaseDate(product.purchaseDate)}</strong></div>
                <div>Working: <strong>{product.working ? 'Yes' : 'Ask seller'}</strong></div>
                <div>Authenticity: <strong>{Math.round((product.authenticityScore || 0.9) * 100)}%</strong></div>
              </div>
            </div>
          )}
        </div>

        <div className="buy-box">
          <div className="detail-price">${price}</div>
          <div style={{ color: 'var(--green)', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            {isDemo ? 'Delivery available' : `${product.location?.city || 'Local pickup'} available`}
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginBottom: '1rem' }}>
            {isDemo ? 'Ships from ReCircle' : 'Self-pickup / No shipping fees / Meet locally'}
          </p>

          {!isDemo && product?.productId && product.status === 'listed' && (
            <ReturnRiskCheck productId={product.productId} />
          )}

          {isAvailable ? (
            isDemo ? (
              cartQuantity > 0 ? (
                <div className="quantity-control">
                  <button type="button" className="quantity-button" onClick={() => changeCartQuantity(-1)}>-</button>
                  <span className="quantity-value">{cartQuantity}</span>
                  <button type="button" className="quantity-button" onClick={() => changeCartQuantity(1)}>+</button>
                </div>
              ) : (
                <button className="btn-buy" onClick={() => changeCartQuantity(1)}>
                  Add to Cart
                </button>
              )
            ) : (
              <button className="btn-buy" onClick={handleAction} disabled={working}>
                {working ? 'Working...' : user ? 'Reserve for Pickup' : 'Sign in to Reserve'}
              </button>
            )
          ) : (
            <div className="status-message">This product is not available.</div>
          )}

          {message && <div className="status-message" style={{ marginTop: '0.75rem' }}>{message}</div>}

          {/* AI Inspection Report */}
          {product && <AIInspectionReport product={product} />}

          {/* AI Compatibility Check */}
          {product?.productId && product.status === 'listed' && <CompatibilityCheck productId={product.productId} />}

          {/* Green Impact Modal */}
          <GreenImpactModal visible={showImpactModal} onClose={() => setShowImpactModal(false)} data={impactData} />

          <hr style={{ margin: '1rem 0', border: 'none', borderTop: '1px solid var(--gray-200)' }} />
          <div style={{ fontSize: '0.8rem', color: 'var(--gray-500)', lineHeight: 1.8 }}>
            <div>Verified listing</div>
            <div>{greenCredits} Green Credits reward</div>
            <div>Sustainable choice</div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: '2.5rem' }}>
        <div className="section-header">
          <h2>Customer Reviews</h2>
        </div>
        <div className="reviews-grid">
          {(product.reviews || []).map((review, index) => (
            <div key={index} className="review-card">
              <strong>{review.title}</strong>
              <div style={{ color: 'var(--gray-500)', fontSize: '0.85rem', margin: '0.25rem 0' }}>
                {review.rating} rating by {review.name}
              </div>
              <p>{review.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
