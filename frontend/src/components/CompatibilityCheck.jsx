import { useState } from 'react';
import { api } from '../api';

function localCompatibilityCheck(product, userQuery) {
  const query = userQuery.toLowerCase();
  const name = `${product?.name || ''} ${product?.brand || ''} ${product?.model || ''}`.toLowerCase();
  const category = String(product?.category || '').toLowerCase();
  const warnings = [];
  let compatible = false;
  let confidence = 0.72;

  if ((query.includes('video editing') || query.includes('editing') || query.includes('gaming')) && category === 'electronics') {
    const hasPerformanceSignal = /(pro|ultra|gaming|rtx|gtx|m1|m2|m3|i7|i9|ryzen|16gb|32gb|playstation|ps5)/i.test(name);
    if (!hasPerformanceSignal) {
      compatible = false;
      confidence = 0.64;
      warnings.push('Performance specs are not clear enough for this use case.');
    }
  }

  if ((query.includes('size') || query.includes('fit')) && /(fashion|clothing)/i.test(category)) {
    compatible = false;
    confidence = 0.6;
    warnings.push('Size and fit should be checked before buying.');
  }

  if (warnings.length === 0) {
    warnings.push('Check product details, reviews, warranty, and accessories before checkout.');
  }

  return {
    compatible,
    confidence,
    explanation: compatible
      ? 'This product looks like a reasonable fit based on the available listing details. Confirm the exact specs before checkout.'
      : 'This product may not fully match your intended use based on the available listing details.',
    warnings,
    fallback: true,
  };
}

export default function CompatibilityCheck({ productId, product }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const checkCompatibility = async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setResult(null);

    try {
      if (!productId || String(productId).startsWith('demo-')) {
        setResult(localCompatibilityCheck(product, query.trim()));
        return;
      }

      const data = await api.checkCompatibility({ productId, userQuery: query.trim() });
      setResult(data);
    } catch (err) {
      setResult({
        compatible: null,
        explanation: err.message || 'Could not analyze. Try again.',
        warnings: ['Review product details manually before buying.'],
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      margin: '16px 0',
      padding: '14px',
      background: '#f3e5f5',
      border: '1px solid #ce93d8',
      borderRadius: '10px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
        <strong style={{ fontSize: '13px', color: '#6a1b9a' }}>AI Compatibility Check</strong>
        <span style={{ fontSize: '11px', color: '#888' }}>Will this fit your needs?</span>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && checkCompatibility()}
          placeholder="e.g., Will this handle video editing?"
          maxLength={300}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid #ce93d8',
            fontSize: '13px',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={checkCompatibility}
          disabled={loading || !query.trim()}
          style={{
            background: '#7b1fa2',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            padding: '8px 14px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading || !query.trim() ? 0.6 : 1,
          }}
        >
          {loading ? 'Checking' : 'Check'}
        </button>
      </div>

      {result && (
        <div style={{
          marginTop: '10px',
          padding: '10px 12px',
          borderRadius: '6px',
          background: result.compatible === false ? '#fff3e0' : result.compatible ? '#e8f5e9' : '#f5f5f5',
          border: `1px solid ${result.compatible === false ? '#ffcc80' : result.compatible ? '#a5d6a7' : '#ddd'}`,
        }}>
          <strong style={{ fontSize: '13px' }}>
            {result.compatible === false ? 'May not be ideal' : result.compatible ? 'Good fit' : 'Uncertain'}
          </strong>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#555', lineHeight: 1.4 }}>
            {result.explanation}
          </p>
          {result.warnings?.length > 0 && (
            <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: '11px', color: '#e65100' }}>
              {result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
