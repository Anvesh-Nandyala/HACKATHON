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
  const [returnForm, setReturnForm] = useState({ reason: '', damageLevel: 'minor', notes: '' });
  const [working, setWorking] = useState(false);

  const loadTransaction = () => {
    setLoading(true);
    setMessage('');
    api.getTransaction(transactionId)
      .then(setTransaction)
      .catch(err => setMessage(err.message || 'Could not load pickup details.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTransaction();
  }, [transactionId]);

  const submitReturn = async (event) => {
    event.preventDefault();
    setWorking(true);
    setMessage('');
    try {
      const result = await api.requestReturn(transaction.transactionId, returnForm);
      setMessage(`Return requested. AI inspection result: ${result.inspection.disposition}.`);
      setReturnForm({ reason: '', damageLevel: 'minor', notes: '' });
      loadTransaction();
    } catch (err) {
      setMessage(err.message || 'Could not request return.');
    } finally {
      setWorking(false);
    }
  };

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

          {transaction.role === 'buyer' && transaction.status === 'completed' && transaction.returnWindow?.eligible && (
            <form className="return-form" onSubmit={submitReturn}>
              <h3>Return Product</h3>
              <p className="muted-text">Return is available for {transaction.returnWindow.daysLeft} more days. AI will inspect the return and decide refurbish, recycle, or admin review.</p>
              <div className="form-group">
                <label>Return Reason</label>
                <input
                  value={returnForm.reason}
                  onChange={event => setReturnForm({ ...returnForm, reason: event.target.value })}
                  placeholder="Why are you returning this product?"
                  required
                />
              </div>
              <div className="form-group">
                <label>Damage Level</label>
                <select value={returnForm.damageLevel} onChange={event => setReturnForm({ ...returnForm, damageLevel: event.target.value })}>
                  <option value="minor">Minor damage</option>
                  <option value="moderate">Significant damage</option>
                  <option value="severe">More than significant</option>
                </select>
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea
                  rows="2"
                  value={returnForm.notes}
                  onChange={event => setReturnForm({ ...returnForm, notes: event.target.value })}
                  placeholder="Optional extra details"
                />
              </div>
              <button className="btn btn-primary" disabled={working}>
                {working ? 'Inspecting...' : 'Return Product'}
              </button>
            </form>
          )}

          {transaction.returnDetails?.inspection && (
            <div className="return-inspection-card">
              <h3>AI Return Inspection</h3>
              <div>Decision: <strong>{transaction.returnDetails.inspection.disposition}</strong></div>
              <div>Damage: <strong>{transaction.returnDetails.inspection.severity}</strong></div>
              <p>{transaction.returnDetails.inspection.recommendation}</p>
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
