export default function SectionUnavailable({ section = 'This section', onRetry }) {
  return (
    <div style={{
      background: '#f5f5f5', border: '1px dashed #ccc', borderRadius: '8px',
      padding: '20px', textAlign: 'center', margin: '12px 0',
    }}>
      <p style={{ color: '#666', margin: '0 0 8px', fontSize: '14px' }}>
        ⚠️ {section} temporarily unavailable
      </p>
      {onRetry && (
        <button onClick={onRetry} style={{
          background: '#1976d2', color: 'white', border: 'none',
          borderRadius: '4px', padding: '6px 14px', cursor: 'pointer', fontSize: '13px',
        }}>
          Retry
        </button>
      )}
    </div>
  );
}
