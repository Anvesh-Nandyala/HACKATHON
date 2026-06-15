import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

function readCart() {
  return JSON.parse(localStorage.getItem('demo_cart') || '[]')
    .map(item => ({ ...item, quantity: item.quantity || 1 }))
    .filter(item => item.quantity > 0);
}

function saveCart(items) {
  localStorage.setItem('demo_cart', JSON.stringify(items));
  window.dispatchEvent(new Event('cart-updated'));
}

function savePurchasedProducts(items) {
  const existing = JSON.parse(localStorage.getItem('demo_purchased_products') || '[]');
  const purchasedAt = new Date().toISOString();
  const purchases = items.map(item => ({
    purchaseId: `${item.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    productId: String(item.id).startsWith('demo-') ? item.id : `demo-${item.id}`,
    id: item.id,
    name: item.name,
    category: item.category,
    price: item.price,
    quantity: item.quantity || 1,
    purchasedAt,
    returnDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'purchased',
  }));
  localStorage.setItem('demo_purchased_products', JSON.stringify([...purchases, ...existing]));
}

export default function Checkout() {
  const [items, setItems] = useState(() => readCart());
  const [orderPlaced, setOrderPlaced] = useState(false);

  useEffect(() => {
    const syncCart = () => setItems(readCart());
    window.addEventListener('cart-updated', syncCart);
    window.addEventListener('storage', syncCart);
    return () => {
      window.removeEventListener('cart-updated', syncCart);
      window.removeEventListener('storage', syncCart);
    };
  }, []);

  const subtotal = useMemo(() => {
    return items.reduce((total, item) => total + Number(item.price || 0) * Number(item.quantity || 0), 0);
  }, [items]);

  const itemCount = useMemo(() => {
    return items.reduce((total, item) => total + Number(item.quantity || 0), 0);
  }, [items]);

  const updateQuantity = (id, delta) => {
    const next = items
      .map(item => item.id === id ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item)
      .filter(item => item.quantity > 0);
    setItems(next);
    saveCart(next);
    setOrderPlaced(false);
  };

  const placeOrder = () => {
    if (!items.length) return;
    savePurchasedProducts(items);
    saveCart([]);
    setItems([]);
    setOrderPlaced(true);
  };

  return (
    <div>
      <div className="section-header">
        <h2>Checkout</h2>
        <Link to="/marketplace">Continue shopping</Link>
      </div>

      {orderPlaced && (
        <div className="status-message">
          Order placed. Purchased product IDs are saved in My Products.
        </div>
      )}

      {items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <h3>Your cart is empty</h3>
          <p style={{ color: 'var(--gray-500)', margin: '0.5rem 0 1.25rem' }}>
            Add products to your cart before checkout.
          </p>
          <Link to="/marketplace" className="btn btn-primary">Shop Products</Link>
        </div>
      ) : (
        <div className="checkout-layout">
          <div className="card">
            <h3 style={{ marginBottom: '1rem' }}>Shopping Cart</h3>
            {items.map(item => (
              <div key={item.id} className="checkout-item">
                <div className="checkout-item-image">{item.category || 'Product'}</div>
                <div className="checkout-item-info">
                  <div className="checkout-item-title">{item.name}</div>
                  <div style={{ color: 'var(--gray-500)', fontSize: '0.85rem' }}>{item.category}</div>
                  <div className="quantity-control checkout-quantity">
                    <button type="button" className="quantity-button" onClick={() => updateQuantity(item.id, -1)}>-</button>
                    <span className="quantity-value">{item.quantity}</span>
                    <button type="button" className="quantity-button" onClick={() => updateQuantity(item.id, 1)}>+</button>
                  </div>
                </div>
                <div className="checkout-item-price">
                  ${(Number(item.price || 0) * item.quantity).toFixed(2)}
                </div>
              </div>
            ))}
          </div>

          <div className="checkout-summary">
            <h3>Order Summary</h3>
            <div className="checkout-row">
              <span>Items</span>
              <strong>{itemCount}</strong>
            </div>
            <div className="checkout-row">
              <span>Subtotal</span>
              <strong>${subtotal.toFixed(2)}</strong>
            </div>
            <div className="checkout-row">
              <span>Delivery</span>
              <strong>Free</strong>
            </div>
            <hr style={{ margin: '1rem 0', border: 'none', borderTop: '1px solid var(--gray-200)' }} />
            <div className="checkout-total">
              <span>Total</span>
              <strong>${subtotal.toFixed(2)}</strong>
            </div>
            <button className="btn-buy" onClick={placeOrder}>Place Order</button>
          </div>
        </div>
      )}
    </div>
  );
}
