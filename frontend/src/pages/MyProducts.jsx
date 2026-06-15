import React, { useEffect, useState } from 'react';
import { api } from '../api';

function readPurchasedProducts() {
  return JSON.parse(localStorage.getItem('demo_purchased_products') || '[]');
}

function savePurchasedProducts(items) {
  localStorage.setItem('demo_purchased_products', JSON.stringify(items));
}

function saveLocalRefurbishedProduct(item) {
  const existing = JSON.parse(localStorage.getItem('demo_refurbished_products') || '[]');
  const refurbished = {
    productId: item.productId,
    name: item.name,
    category: item.category,
    originalPrice: Number(item.price || 0),
    recommendedPrice: Math.max(1, Math.round(Number(item.price || 0) * 0.82)),
    savingsPercent: 18,
    conditionScore: 92,
    grade: 'A',
    certified: true,
    aiMatched: true,
    refurbishedAt: new Date().toISOString(),
    sourcePurchaseId: item.purchaseId,
    damagePercent: item.aiReturnInspection?.damagePercent || 0,
  };
  localStorage.setItem('demo_refurbished_products', JSON.stringify([
    refurbished,
    ...existing.filter(product => product.sourcePurchaseId !== item.purchaseId),
  ]));
}

function estimateReturnDamage(item) {
  const name = `${item.name || ''} ${item.category || ''}`.toLowerCase();
  let damagePercent = 7;

  if (name.includes('tv') || name.includes('vacuum')) damagePercent = 18;
  if (name.includes('lego') || name.includes('shoes')) damagePercent = 12;
  if (name.includes('broken') || name.includes('crack') || name.includes('damage')) damagePercent = 68;

  const disposition = damagePercent <= 10
    ? 'refurbish'
    : damagePercent <= 60
      ? 'recycle'
      : 'admin_review';

  return {
    damagePercent,
    disposition,
    recommendation: disposition === 'refurbish'
      ? 'Low damage detected. Automatically refurbished into website products.'
      : disposition === 'recycle'
        ? 'Damage is above refurbish range. Send to recycle.'
        : 'High damage detected. Admin should review and choose donate or recycle.',
  };
}

function daysLeft(deadline) {
  const diff = new Date(deadline).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

export default function MyProducts() {
  const [products, setProducts] = useState([]);
  const [purchasedProducts, setPurchasedProducts] = useState(() => readPurchasedProducts());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getMyProducts().catch(() => ({ products: [] })),
      api.getMyCartPurchases().catch(() => ({ purchases: readPurchasedProducts() })),
    ])
      .then(([productData, purchaseData]) => {
        setProducts(productData.products || []);
        setPurchasedProducts(purchaseData.purchases || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const returnPurchasedProduct = async (purchaseId) => {
    try {
      const data = await api.returnCartPurchase(purchaseId);
      const next = purchasedProducts.map(item => item.purchaseId === purchaseId ? data.purchase : item);
      setPurchasedProducts(next);
      savePurchasedProducts(next);
      if (data.purchase?.status === 'refurbished') saveLocalRefurbishedProduct(data.purchase);
      return;
    } catch {}

    const next = purchasedProducts.map(item => item.purchaseId === purchaseId
      ? (() => {
        const inspection = estimateReturnDamage(item);
        const updated = {
          ...item,
          status: inspection.disposition === 'refurbish'
            ? 'refurbished'
            : inspection.disposition === 'recycle'
              ? 'recycled'
              : 'admin_review',
          aiReturnInspection: inspection,
          returnedAt: new Date().toISOString(),
        };
        if (inspection.disposition === 'refurbish') saveLocalRefurbishedProduct(updated);
        return updated;
      })()
      : item);
    setPurchasedProducts(next);
    savePurchasedProducts(next);
  };

  const statusText = (status) => {
    if (status === 'return_requested') return 'Return Requested';
    if (status === 'refurbished') return 'Refurbished';
    if (status === 'recycled') return 'Recycled';
    if (status === 'admin_review') return 'Admin Review';
    return 'Purchased';
  };

  const statusClass = (status) => {
    if (status === 'purchased') return 'badge-green';
    if (status === 'refurbished') return 'badge-blue';
    if (status === 'recycled') return 'badge-red';
    return 'badge-orange';
  };

  const getStatusBadge = (status) => {
    const map = {
      pending_verification: { class: 'badge-yellow', label: 'Verifying' },
      verified: { class: 'badge-blue', label: 'Verified' },
      listed: { class: 'badge-green', label: 'Listed' },
      reserved: { class: 'badge-orange', label: 'Reserved' },
      sold: { class: 'badge-green', label: 'Sold' },
      donated: { class: 'badge-blue', label: 'Donated' },
      recycled: { class: 'badge-blue', label: 'Recycled' },
      expired: { class: 'badge-red', label: 'Expired' },
    };
    const info = map[status] || { class: 'badge-yellow', label: status };
    return <span className={`badge ${info.class}`}>{info.label}</span>;
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>My Products</h1>

      {purchasedProducts.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <div className="section-header">
            <h2>Purchased Products</h2>
            <span style={{ color: 'var(--gray-500)', fontSize: '0.9rem' }}>Add to Cart purchases</span>
          </div>
          <div className="card-grid">
            {purchasedProducts.map(item => {
              const canReturn = item.status === 'purchased' && daysLeft(item.returnDeadline) > 0;
              return (
                <div key={item.purchaseId} className="card product-card">
                  <div className="product-card-header">
                    <div>
                      <div className="product-card-title">{item.name}</div>
                      <span className={`badge ${statusClass(item.status)}`}>{statusText(item.status)}</span>
                    </div>
                  </div>
                  <div className="product-card-price">${item.price}</div>
                  <div className="product-card-meta">
                    <span>ID: {item.productId}</span>
                    <span>Qty: {item.quantity}</span>
                  </div>
                  <div className="product-card-meta">
                    <span>Purchased: {new Date(item.purchasedAt).toLocaleDateString()}</span>
                    <span>{canReturn ? `${daysLeft(item.returnDeadline)} days left` : 'Return window closed'}</span>
                  </div>
                  {item.aiReturnInspection && (
                    <div className="return-inspection-card" style={{ marginTop: '0.75rem' }}>
                      <div>AI damage: <strong>{item.aiReturnInspection.damagePercent}%</strong></div>
                      <div>Decision: <strong>{item.aiReturnInspection.disposition}</strong></div>
                      <p>{item.aiReturnInspection.recommendation}</p>
                    </div>
                  )}
                  {canReturn && (
                    <button className="btn btn-secondary" style={{ marginTop: '0.75rem' }} onClick={() => returnPurchasedProduct(item.purchaseId)}>
                      Return Product
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {products.length === 0 && purchasedProducts.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}>
          <p>No products yet. Submit your first product to get started.</p>
        </div>
      )}

      {products.length > 0 && (
        <>
          <div className="section-header">
            <h2>Submitted Products</h2>
          </div>
          <div className="card-grid">
            {products.map(product => (
              <div key={product.productId} className="card product-card">
                <div className="product-card-header">
                  <div>
                    <div className="product-card-title">{product.brand} {product.model}</div>
                    {getStatusBadge(product.status)}
                  </div>
                  {product.verification && (
                    <span className={`grade grade-${product.verification.grade}`}>
                      {product.verification.grade}
                    </span>
                  )}
                </div>

                {product.priceEstimate && (
                  <div className="product-card-price">${product.priceEstimate.recommendedPrice}</div>
                )}

                {product.routingDecision && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <span className={`route-badge route-${product.routingDecision.destination}`}>
                      Route: {product.routingDecision.destination}
                    </span>
                  </div>
                )}

                <div className="product-card-meta">
                  <span>{new Date(product.createdAt).toLocaleDateString()}</span>
                  <span>{product.category}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
