import { useState } from 'react';
import { api } from '../api';

/**
 * Predictive Return Prevention — AI Compatibility Check widget.
 * Buyer asks if a product fits their use case before purchasing.
 */
export default function CompatibilityCheck({ productId }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const checkCompatibility = async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setResult(null);

    try {
      const data = await api.checkCompatibility({ productId, userQuery: query.trim() });
      setResult(data);
    } catch (err) {
      setResult({ compatible: null, explanation: 'Could not analyze. Try again.', warnings: [] });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      margin: '16px 0', padding: '14px', background: '#f3e5f5',
      border: '1px solid #ce93d8', borderRadius: '10px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
        <span style={{ fontSize: '16px' }}>🔮</span>
        <strong style={{ fontSize: '13px', color: '#6a1b9a' }}>AI Compatibility Check</strong>
        <span style={{ fontSize: '11px', color: '#888' }}>Will this fit your needs?</span>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && checkCompatibility()}
          placeholder="e.g., Will this handle video editing?"
          maxLength={300}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: '6px',
            border: '1px solid #ce93d8', fontSize: '13px', outline: 'none',
          }}
        />
        <button
          onClick={checkCompatibility}
          disabled={loading || !query.trim()}
          style={{
            background: '#7b1fa2', color: 'white', border: 'none',
            borderRadius: '6px', padding: '8px 14px', fontSize: '12px',
            fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
            opacity: loading || !query.trim() ? 0.6 : 1,
          }}
        >
          {loading ? '...' : 'Check'}
        </button>
      </div>

      {result && (
        <div style={{
          marginTop: '10px', padding: '10px 12px', borderRadius: '6px',
          background: result.compatible === false ? '#fff3e0' : result.compatible ? '#e8f5e9' : '#f5f5f5',
          border: `1px solid ${result.compatible === false ? '#ffcc80' : result.compatible ? '#a5d6a7' : '#ddd'}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <span style={{ fontSize: '16px' }}>
              {result.compatible === false ? '⚠️' : result.compatible ? '✅' : '🤔'}
            </span>
            <strong style={{ fontSize: '13px' }}>
              {result.compatible === false ? 'May not be ideal' : result.compatible ? 'Good fit!' : 'Uncertain'}
            </strong>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#555', lineHeight: 1.4 }}>
            {result.explanation}
          </p>
          {result.warnings?.length > 0 && (
            <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: '11px', color: '#e65100' }}>
              {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
