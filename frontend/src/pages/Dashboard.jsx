import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import RescueRecommendations from '../components/RescueRecommendations';
import RefurbishedRecommendations from '../components/RefurbishedRecommendations';

const FEATURED_PRODUCTS = [
  { id: 1, name: 'Apple iPhone 15 Pro', price: 999, originalPrice: 1099, category: 'Electronics', rating: 4.7, reviews: 2341 },
  { id: 2, name: 'Samsung 65" 4K Smart TV', price: 599, originalPrice: 799, category: 'Electronics', rating: 4.5, reviews: 1892 },
  { id: 3, name: 'Nike Air Max 90', price: 120, originalPrice: 150, category: 'Fashion', rating: 4.6, reviews: 3201 },
  { id: 4, name: 'Dyson V15 Detect Vacuum', price: 649, originalPrice: 749, category: 'Appliances', rating: 4.8, reviews: 892 },
  { id: 5, name: 'Sony WH-1000XM5', price: 298, originalPrice: 399, category: 'Electronics', rating: 4.7, reviews: 5621 },
  { id: 6, name: 'LEGO Star Wars Set', price: 129, originalPrice: 159, category: 'Toys', rating: 4.9, reviews: 1203 },
];

const DEALS_OF_DAY = [
  { id: 7, name: 'Instant Pot Duo Plus 6Qt', price: 59, originalPrice: 119, category: 'Appliances', rating: 4.7, reviews: 8932 },
  { id: 8, name: 'Kindle Paperwhite 11th Gen', price: 99, originalPrice: 149, category: 'Electronics', rating: 4.6, reviews: 4521 },
  { id: 9, name: 'Adidas Ultraboost Light', price: 126, originalPrice: 190, category: 'Sports', rating: 4.5, reviews: 2103 },
  { id: 10, name: 'JBL Charge 5 Speaker', price: 119, originalPrice: 179, category: 'Electronics', rating: 4.7, reviews: 3421 },
];

const CATEGORY_CARDS = [
  { name: 'Electronics', items: ['Phones', 'Laptops', 'Audio', 'Cameras'] },
  { name: 'Home and Kitchen', items: ['Cookware', 'Coffee', 'Cleaning', 'Furniture'] },
  { name: 'Fashion', items: ['Shirts', 'Pants', 'Shoes', 'Bags'] },
  { name: 'Sports and Outdoors', items: ['Sports', 'Fitness', 'Cycling', 'Camping'] },
];

function DemoProductCard({ product, quantity, onQuantityChange }) {
  const discount = Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100);
  const openProduct = () => {
    window.open(`/#/product/demo-${product.id}`, '_blank', 'noopener,noreferrer');
  };
  const changeQuantity = (event, delta) => {
    event.stopPropagation();
    onQuantityChange(product, delta);
  };

  return (
    <div className="product-card" onClick={openProduct} role="button" tabIndex={0} onKeyDown={event => event.key === 'Enter' && openProduct()}>
      {discount > 0 && (
        <span className="product-card-badge" style={{ background: '#dc2626' }}>
          {discount}% off
        </span>
      )}
      <div className="product-card-image product-card-text-image">{product.category}</div>
      <div className="product-card-title">{product.name}</div>
      <div className="product-card-rating">
        <span>{product.rating} rating</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--blue)' }}>{product.reviews.toLocaleString()} reviews</span>
      </div>
      <div className="product-card-price">
        ${product.price}
        <span className="original">${product.originalPrice}</span>
      </div>
      <div className="product-card-meta">Free delivery</div>
      {quantity > 0 ? (
        <div className="quantity-control" onClick={event => event.stopPropagation()}>
          <button type="button" className="quantity-button" onClick={event => changeQuantity(event, -1)}>-</button>
          <span className="quantity-value">{quantity}</span>
          <button type="button" className="quantity-button" onClick={event => changeQuantity(event, 1)}>+</button>
        </div>
      ) : (
        <button className="btn-buy" onClick={event => changeQuantity(event, 1)}>
          Add to Cart
        </button>
      )}
    </div>
  );
}

export default function Dashboard({ buyerLocation }) {
  const [nearbyCount, setNearbyCount] = useState(0);
  const [cartQuantities, setCartQuantities] = useState(() => {
    const saved = JSON.parse(localStorage.getItem('demo_cart') || '[]');
    return saved.reduce((items, item) => ({ ...items, [item.id]: item.quantity || 1 }), {});
  });

  useEffect(() => {
    api.discoverNearby({
      latitude: buyerLocation?.latitude || 40.7128,
      longitude: buyerLocation?.longitude || -74.006,
      radiusKm: 50,
      limit: 1,
    })
      .then(data => setNearbyCount(data.totalCount || 0))
      .catch(() => {});
  }, [buyerLocation]);

  const changeCartQuantity = (product, delta) => {
    const saved = JSON.parse(localStorage.getItem('demo_cart') || '[]');
    const existing = saved.find(item => item.id === product.id);
    const currentQuantity = existing?.quantity || (existing ? 1 : 0);
    const nextQuantity = Math.max(0, currentQuantity + delta);
    const next = nextQuantity === 0
      ? saved.filter(item => item.id !== product.id)
      : [
        ...saved.filter(item => item.id !== product.id),
        { ...product, quantity: nextQuantity },
      ];

    localStorage.setItem('demo_cart', JSON.stringify(next));
    window.dispatchEvent(new Event('cart-updated'));
    setCartQuantities(next.reduce((items, item) => ({ ...items, [item.id]: item.quantity || 1 }), {}));
  };

  useEffect(() => {
    localStorage.setItem('demo_products', JSON.stringify([...FEATURED_PRODUCTS, ...DEALS_OF_DAY]));
  }, []);

  return (
    <div>
      <div style={{ background: 'linear-gradient(to bottom, #232f3e, #394856)', borderRadius: 'var(--radius)', padding: '2rem 3rem', marginBottom: '1rem', color: 'white', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Welcome to ReCircle</h1>
        <p style={{ opacity: 0.85, fontSize: '1rem' }}>Shop products and find local pre-owned deals.</p>
      </div>

      <Link to="/nearby" style={{ textDecoration: 'none', display: 'block', marginBottom: '1.5rem' }}>
        <div style={{
          background: '#047857',
          borderRadius: 'var(--radius)',
          padding: '2rem 2.5rem',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: 'var(--shadow-lg)',
          cursor: 'pointer',
        }}>
          <div>
            <div style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.9, marginBottom: '0.5rem' }}>
              Circular Commerce
            </div>
            <h2 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>Products Near You</h2>
            <p style={{ opacity: 0.9, maxWidth: '450px', fontSize: '0.95rem' }}>
              Discover local products from people in your neighbourhood.
            </p>
            <div style={{ marginTop: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.15)', padding: '0.5rem 1rem', borderRadius: '20px', fontSize: '0.85rem' }}>
              {nearbyCount} products available near you. Click to explore.
            </div>
          </div>
          <div className="simple-hero-mark">Local</div>
        </div>
      </Link>

      <div className="category-grid">
        {CATEGORY_CARDS.map(cat => (
          <div key={cat.name} className="category-card">
            <h3>{cat.name}</h3>
            <div className="category-card-items">
              {cat.items.map(item => (
                <Link key={item} to={`/marketplace?q=${encodeURIComponent(item)}`} className="category-card-item">
                  {item}
                </Link>
              ))}
            </div>
            <Link to="/marketplace" style={{ fontSize: '0.85rem', marginTop: '0.75rem', display: 'block' }}>See more</Link>
          </div>
        ))}
      </div>

      {/* AI-powered personalized recommendations */}
      <RescueRecommendations />
      <RefurbishedRecommendations />

      <div className="section-header">
        <h2>Today's Deals</h2>
        <Link to="/marketplace">See all deals</Link>
      </div>
      <div className="product-grid">
        {DEALS_OF_DAY.map(product => (
          <DemoProductCard key={product.id} product={product} quantity={cartQuantities[product.id] || 0} onQuantityChange={changeCartQuantity} />
        ))}
      </div>

      <div className="section-header">
        <h2>Popular Products</h2>
        <Link to="/marketplace">See more</Link>
      </div>
      <div className="product-grid">
        {FEATURED_PRODUCTS.map(product => (
          <DemoProductCard key={product.id} product={product} quantity={cartQuantities[product.id] || 0} onQuantityChange={changeCartQuantity} />
        ))}
      </div>

      <Link to="/nearby" style={{ textDecoration: 'none', display: 'block', margin: '2rem 0' }}>
        <div style={{ background: 'white', borderRadius: 'var(--radius)', padding: '1.5rem 2rem', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', gap: '1.5rem', border: '2px solid #10b981' }}>
          <div>
            <h3 style={{ color: 'var(--green-dark)' }}>Save money and shop pre-owned near you</h3>
            <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem' }}>Verified products from your neighbours. Pick up locally and earn Green Credits.</p>
          </div>
          <span style={{ marginLeft: 'auto', fontWeight: 700 }}>Explore</span>
        </div>
      </Link>
    </div>
  );
}
