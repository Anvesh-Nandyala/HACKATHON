export default function StaleDataBanner({ lastUpdated, onRefresh }) {
  if (!lastUpdated) return null;

  const minutes = Math.round((Date.now() - new Date(lastUpdated).getTime()) / 60000);
  if (minutes < 1) return null;

  return (
    <div style={{
      background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '6px',
      padding: '8px 12px', marginBottom: '12px', fontSize: '13px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <span>⏱️ Last updated {minutes} min ago</span>
      {onRefresh && (
        <button onClick={onRefresh} style={{
          background: '#ffc107', border: 'none', borderRadius: '4px',
          padding: '4px 10px', cursor: 'pointer', fontSize: '12px',
        }}>
          Refresh
        </button>
      )}
    </div>
  );
}
