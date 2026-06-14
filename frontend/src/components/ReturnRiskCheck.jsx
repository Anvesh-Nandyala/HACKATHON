import { useEffect, useState } from 'react';
import { api } from '../api';

function riskTitle(level) {
  if (level === 'high') return 'High return risk';
  if (level === 'medium') return 'Medium return risk';
  return 'Low return risk';
}

export default function ReturnRiskCheck({ productId }) {
  const [buyerIntent, setBuyerIntent] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const runCheck = async (intent = buyerIntent) => {
    if (!productId || loading) return;
    setLoading(true);
    try {
      const data = await api.checkReturnRisk({
        productId,
        buyerIntent: intent.trim(),
      });
      setResult(data);
    } catch (err) {
      setResult({
        riskLevel: 'medium',
        riskScore: 0.5,
        summary: err.message || 'Could not analyze return risk. Review details before reserving.',
        reasons: ['Return risk could not be calculated right now.'],
        suggestions: ['Confirm condition, model, and accessories with the seller.'],
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runCheck('');
  }, [productId]);

  return (
    <div className={`return-risk-card risk-${result?.riskLevel || 'unknown'}`}>
      <div className="return-risk-header">
        <div>
          <strong>Predictive Return Prevention</strong>
          <span>Check fit before reserving</span>
        </div>
        {result && (
          <div className="return-risk-score">
            {Math.round((result.riskScore || 0) * 100)}%
          </div>
        )}
      </div>

      <div className="return-risk-input">
        <input
          value={buyerIntent}
          onChange={event => setBuyerIntent(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && runCheck()}
          maxLength={300}
          placeholder="What will you use it for?"
        />
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => runCheck()}>
          {loading ? 'Checking' : 'Check'}
        </button>
      </div>

      {result && (
        <div className="return-risk-result">
          <strong>{riskTitle(result.riskLevel)}</strong>
          <p>{result.summary}</p>
          {result.reasons?.length > 0 && (
            <ul>
              {result.reasons.slice(0, 3).map((reason, index) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
          )}
          {result.suggestions?.length > 0 && (
            <div className="return-risk-suggestion">
              {result.suggestions[0]}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
