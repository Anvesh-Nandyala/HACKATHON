export default function ReconnectToast({ visible }) {
  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: '20px', right: '20px', zIndex: 9998,
      background: '#333', color: 'white', padding: '12px 20px',
      borderRadius: '8px', fontSize: '14px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      display: 'flex', alignItems: 'center', gap: '8px',
    }}>
      <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>🔄</span>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      Reconnecting...
    </div>
  );
}
