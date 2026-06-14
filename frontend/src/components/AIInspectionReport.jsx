/**
 * AI Inspection Report — Radical transparency trust badges.
 * Shows Amazon-style breakdown of AI verification results.
 */
export default function AIInspectionReport({ product }) {
  if (!product?.conditionScore && !product?.grade) return null;

  const score = product.conditionScore || 0;
  const grade = product.grade || 'N/A';
  const working = product.working !== false;
  const authenticity = product.authenticityScore || 0;
  const damages = product.damageDetected || [];

  const getScoreColor = (s) => s >= 80 ? '#4caf50' : s >= 60 ? '#ff9800' : '#f44336';
  const getScoreIcon = (s) => s >= 80 ? '✅' : s >= 60 ? '⚠️' : '❌';

  const badges = [
    {
      label: 'Overall Condition',
      value: `${score}/100 (Grade ${grade})`,
      icon: getScoreIcon(score),
      color: getScoreColor(score),
    },
    {
      label: 'Hardware Status',
      value: working ? 'Fully Functional' : 'Not Working',
      icon: working ? '✅' : '❌',
      color: working ? '#4caf50' : '#f44336',
    },
    {
      label: 'Authenticity',
      value: authenticity >= 80 ? 'Verified Genuine' : authenticity >= 50 ? 'Likely Genuine' : 'Unverified',
      icon: authenticity >= 80 ? '🛡️' : '⚠️',
      color: authenticity >= 80 ? '#4caf50' : '#ff9800',
    },
  ];

  return (
    <div style={{ margin: '16px 0', padding: '16px', background: '#f8fffe', border: '1px solid #e0f2f1', borderRadius: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <span style={{ fontSize: '18px' }}>🤖</span>
        <strong style={{ fontSize: '14px', color: '#00695c' }}>AI Inspection Report</strong>
        <span style={{ fontSize: '11px', color: '#888', marginLeft: 'auto' }}>Analyzed by Bedrock AI</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
        {badges.map((badge, i) => (
          <div key={i} style={{
            background: 'white', borderRadius: '8px', padding: '10px',
            border: `1px solid ${badge.color}22`, textAlign: 'center',
          }}>
            <div style={{ fontSize: '20px', marginBottom: '4px' }}>{badge.icon}</div>
            <div style={{ fontSize: '11px', color: '#666', marginBottom: '2px' }}>{badge.label}</div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: badge.color }}>{badge.value}</div>
          </div>
        ))}
      </div>

      {damages.length > 0 && (
        <div style={{ marginTop: '12px', padding: '8px 12px', background: '#fff8e1', borderRadius: '6px', fontSize: '12px' }}>
          <strong>⚠️ Detected Issues:</strong>
          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
            {damages.map((d, i) => <li key={i} style={{ marginBottom: '2px' }}>{d}</li>)}
          </ul>
        </div>
      )}

      {damages.length === 0 && score >= 80 && (
        <div style={{ marginTop: '10px', padding: '6px 12px', background: '#e8f5e9', borderRadius: '6px', fontSize: '12px', textAlign: 'center', color: '#2e7d32' }}>
          ✨ No defects detected — excellent condition
        </div>
      )}
    </div>
  );
}
