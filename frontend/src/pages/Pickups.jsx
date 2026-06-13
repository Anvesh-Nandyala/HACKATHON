import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function formatWindow(window) {
  if (!window?.start || !window?.end) return 'Pickup time not set';
  return `${new Date(window.start).toLocaleString()} - ${new Date(window.end).toLocaleTimeString()}`;
}

function qualityText(transaction) {
  return transaction.conditionScore ? `${transaction.conditionScore}/100` : 'N/A';
}

function addressText(transaction) {
  if (transaction.sellerAddress) return transaction.sellerAddress;
  if (transaction.pickupLocation?.address) return transaction.pickupLocation.address;
  const latitude = transaction.pickupLocation?.latitude;
  const longitude = transaction.pickupLocation?.longitude;
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return `Pickup coordinates: ${latitude}, ${longitude}`;
  }
  return 'Address unavailable';
}

export default function Pickups() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [otpByTransaction, setOtpByTransaction] = useState({});
  const [workingId, setWorkingId] = useState(null);

  const loadTransactions = () => {
    setLoading(true);
    setMessage('');
    api.getTransactions()
      .then(data => setTransactions(data.transactions || []))
      .catch(err => setMessage(err.message || 'Could not load pickups.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTransactions();
  }, []);

  const verifyPickup = async (transactionId) => {
    setWorkingId(transactionId);
    setMessage('');
    try {
      await api.verifyPickup(transactionId, otpByTransaction[transactionId] || '');
      setMessage('Pickup verified. Transaction completed.');
      setOtpByTransaction({ ...otpByTransaction, [transactionId]: '' });
      loadTransactions();
    } catch (err) {
      setMessage(err.message || 'Could not verify pickup.');
    } finally {
      setWorkingId(null);
    }
  };

  if (loading) return <p>Loading pickups...</p>;

  const buying = transactions.filter(item => item.role === 'buyer');
  const selling = transactions.filter(item => item.role === 'seller');

  return (
    <div>
      <div className="section-header">
        <h2>Pickup Verification</h2>
        <Link to="/marketplace">Browse Products</Link>
      </div>

      {message && <div className="status-message">{message}</div>}

      {transactions.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <h3>No pickups yet</h3>
          <p style={{ color: 'var(--gray-500)', margin: '0.5rem 0 1.25rem' }}>
            Reserve a product to get a buyer OTP, or sell a product to verify pickup.
          </p>
          <Link to="/nearby" className="btn btn-green">Find Local Products</Link>
        </div>
      )}

      {buying.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Buying</h3>
          <div className="pickup-grid">
            {buying.map(transaction => (
              <Link to={`/pickups/${transaction.transactionId}`} className="pickup-card pickup-card-link" key={transaction.transactionId}>
                <div className="pickup-card-header">
                  <strong>{transaction.productName}</strong>
                  <span className={`pickup-status pickup-${transaction.status}`}>{transaction.status}</span>
                </div>
                <div className="pickup-meta">Pickup: {formatWindow(transaction.pickupWindow)}</div>
                <div className="pickup-meta">Price: ${transaction.agreedPrice}</div>
                <div className="pickup-meta">Quality: {qualityText(transaction)}</div>
                <div className="pickup-meta">Seller: {transaction.sellerEmail || 'Seller email unavailable'}</div>
                <div className="pickup-meta">Address: {addressText(transaction)}</div>
                {transaction.status === 'completed' ? (
                  <div className="status-message">Pickup complete.</div>
                ) : (
                  <div className="otp-box">
                    <span>Share this OTP with seller</span>
                    <strong>{transaction.pickupOtp}</strong>
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {selling.length > 0 && (
        <div>
          <h3 style={{ marginBottom: '1rem' }}>Selling</h3>
          <div className="pickup-grid">
            {selling.map(transaction => (
              <div className="pickup-card" key={transaction.transactionId}>
                <Link to={`/pickups/${transaction.transactionId}`} className="pickup-card-title-link">
                  <div className="pickup-card-header">
                    <strong>{transaction.productName}</strong>
                    <span className={`pickup-status pickup-${transaction.status}`}>{transaction.status}</span>
                  </div>
                  <div className="pickup-meta">Pickup: {formatWindow(transaction.pickupWindow)}</div>
                  <div className="pickup-meta">Price: ${transaction.agreedPrice}</div>
                  <div className="pickup-meta">Quality: {qualityText(transaction)}</div>
                  <div className="pickup-meta">Address: {addressText(transaction)}</div>
                </Link>
                {transaction.status === 'completed' ? (
                  <div className="status-message">Buyer verified and pickup complete.</div>
                ) : (
                  <div className="seller-otp-form">
                    <label>Enter buyer OTP</label>
                    <input
                      value={otpByTransaction[transaction.transactionId] || ''}
                      onChange={event => setOtpByTransaction({
                        ...otpByTransaction,
                        [transaction.transactionId]: event.target.value.replace(/\D/g, '').slice(0, 6),
                      })}
                      placeholder="6 digit code"
                      inputMode="numeric"
                    />
                    <button
                      className="btn btn-green"
                      onClick={() => verifyPickup(transaction.transactionId)}
                      disabled={workingId === transaction.transactionId}
                    >
                      {workingId === transaction.transactionId ? 'Verifying...' : 'Verify Buyer'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
