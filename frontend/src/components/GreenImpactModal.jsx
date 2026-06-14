import { useState, useEffect } from 'react';

/**
 * Green Impact Modal — celebratory popup after reservation/purchase.
 * Shows environmental impact + credits earned.
 */
export default function GreenImpactModal({ visible, onClose, data }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      setTimeout(() => setShow(true), 100);
    } else {
      setShow(false);
    }
  }, [visible]);

  if (!visible) return null;

  const co2Saved = data?.co2SavedKg || 3.5;
  const creditsEarned = data?.creditsAwarded || 0;
  const tierProgress = data?.tierProgress || 65;
  const nextTier = data?.nextTier || 'Silver';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      opacity: show ? 1 : 0, transition: 'opacity 0.3s',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'white', borderRadius: '16px', padding: '32px',
        maxWidth: '380px', width: '90%', textAlign: 'center',
        transform: show ? 'scale(1)' : 'scale(0.8)', transition: 'transform 0.3s',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎉</div>
        <h2 style={{ margin: '0 0 8px', color: '#2e7d32', fontSize: '20px' }}>
          You're making a difference!
        </h2>

        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px',
          margin: '20px 0', padding: '16px', background: '#e8f5e9', borderRadius: '10px',
        }}>
          <div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#1b5e20' }}>{co2Saved} kg</div>
            <div style={{ fontSize: '11px', color: '#666' }}>CO₂ Saved</div>
          </div>
          <div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#1b5e20' }}>+{creditsEarned}</div>
            <div style={{ fontSize: '11px', color: '#666' }}>Green Credits</div>
          </div>
        </div>

        <div style={{ margin: '16px 0' }}>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px' }}>
            {tierProgress}% to {nextTier} Tier
          </div>
          <div style={{ background: '#e0e0e0', borderRadius: '10px', height: '8px', overflow: 'hidden' }}>
            <div style={{
              width: `${tierProgress}%`, height: '100%',
              background: 'linear-gradient(90deg, #4caf50, #81c784)',
              borderRadius: '10px', transition: 'width 1s ease',
            }} />
          </div>
        </div>

        <p style={{ fontSize: '13px', color: '#555', margin: '16px 0 20px' }}>
          🌍 You just saved <strong>{co2Saved}kg</strong> of e-waste from landfill!
        </p>

        <button onClick={onClose} style={{
          background: '#4caf50', color: 'white', border: 'none',
          borderRadius: '8px', padding: '12px 32px', fontSize: '14px',
          fontWeight: 600, cursor: 'pointer', width: '100%',
        }}>
          Keep Exploring ♻️
        </button>
      </div>
    </div>
  );
}
