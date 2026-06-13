import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';

function formatWindow(window) {
  if (!window?.start || !window?.end) return 'Pickup time not set';
  return `${new Date(window.start).toLocaleString()} - ${new Date(window.end).toLocaleTimeString()}`;
}

function formatPurchaseDate(value) {
  if (!value) return 'Date not provided';
  return new Date(value).toLocaleDateString();
}

function addressText(transaction) {
  if (transaction.sellerAddress) return transaction.sellerAddress;
  if (transaction.pickupLocation?.address) return transaction.pickupLocation.address;
  const latitude = transaction.pickupLocation?.latitude;
  const longitude = transaction.pickupLocation?.longitude;
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return `Pickup coordinates: ${latitude}, ${longitude}`;
  }
  return 'Seller pickup address not provided';
}

export default function PickupDetail() {
  const { transactionId } = useParams();
  const [transaction, setTransaction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setLoading(true);
    setMessage('');
    api.getTransaction(transactionId)
      .then(setTransaction)
      .catch(err => setMessage(err.message || 'Could not load pickup details.'))
      .finally(() => setLoading(false));
  }, [transactionId]);

  if (loading) return <p>Loading pickup details...</p>;

  if (message || !transaction) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
        <h3>Pickup not found</h3>
        <p style={{ color: 'var(--gray-500)', margin: '0.5rem 0 1rem' }}>{message || 'This pickup is not available.'}</p>
        <Link to="/pickups" className="btn btn-primary">Back to Pickups</Link>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginBottom: '1rem' }}>
        <Link to="/pickups">Pickups</Link> / <span>{transaction.productName}</span>
      </div>

      <div className="section-header">
        <h2>Pickup Details</h2>
        <Link to="/pickups">Back</Link>
      </div>

      <div className="pickup-detail-layout">
        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>{transaction.productName}</h3>
          <div className="detail-image" style={{ height: 220, marginBottom: '1rem' }}>{transaction.category || 'Product'}</div>
          <div className="pickup-meta">Status: {transaction.status}</div>
          <div className="pickup-meta">Price: ${transaction.agreedPrice}</div>
          <div className="pickup-meta">Quality factor: {transaction.conditionScore ? `${transaction.conditionScore}/100` : 'N/A'}</div>
          <div className="pickup-meta">Date of purchase: {formatPurchaseDate(transaction.purchaseDate)}</div>
          <div className="pickup-meta">Pickup: {formatWindow(transaction.pickupWindow)}</div>
          {transaction.description && (
            <p style={{ marginTop: '1rem', color: 'var(--gray-700)' }}>{transaction.description}</p>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>Seller Information</h3>
          <div className="pickup-info-row">
            <span>Name</span>
            <strong>{transaction.sellerName || 'Seller'}</strong>
          </div>
          <div className="pickup-info-row">
            <span>Email</span>
            <strong>{transaction.sellerEmail || 'Not available'}</strong>
          </div>
          <div className="pickup-info-row">
            <span>Pickup Address</span>
            <strong>{addressText(transaction)}</strong>
          </div>

          {transaction.role === 'buyer' && transaction.status !== 'completed' && (
            <div className="otp-box" style={{ marginTop: '1.25rem' }}>
              <span>Show this OTP to the seller</span>
              <strong>{transaction.pickupOtp}</strong>
            </div>
          )}

          {transaction.role === 'seller' && (
            <div className="status-message" style={{ marginTop: '1.25rem' }}>
              Ask the buyer for their OTP on the main Pickups page to verify handoff.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
