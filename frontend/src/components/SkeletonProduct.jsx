export default function SkeletonProduct({ message = 'AI is analyzing your product...' }) {
  const shimmer = {
    background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.5s infinite',
    borderRadius: '6px',
  };

  return (
    <div style={{ padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px', marginBottom: '12px' }}>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <div style={{ ...shimmer, height: '180px', marginBottom: '12px' }} />
      <div style={{ ...shimmer, height: '20px', width: '60%', marginBottom: '8px' }} />
      <div style={{ ...shimmer, height: '16px', width: '40%', marginBottom: '12px' }} />
      <p style={{ color: '#666', fontSize: '13px', textAlign: 'center', margin: '16px 0 0' }}>
        🤖 {message}
      </p>
    </div>
  );
}
