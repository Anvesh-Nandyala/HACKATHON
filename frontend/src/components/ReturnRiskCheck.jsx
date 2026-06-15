import { useEffect, useState } from 'react';
import { api } from '../api';

function riskTitle(level) {
  if (level === 'high') return 'High return risk';
  if (level === 'medium') return 'Medium return risk';
  return 'Low return risk';
}

function localRiskCheck(product, buyerIntent = '') {
  const intent = buyerIntent.toLowerCase();
  const name = `${product?.name || ''} ${product?.brand || ''} ${product?.model || ''}`.toLowerCase();
  const category = String(product?.category || '').toLowerCase();
  const reasons = [];
  let riskScore = 0.12;

  if (product?.condition === 'new') {
    reasons.push('This is a brand new product, so condition-related return risk is low.');
  }

  if ((intent.includes('gaming') || intent.includes('video editing') || intent.includes('editing')) && category === 'electronics') {
    const hasPerformanceSignal = /(pro|ultra|gaming|rtx|gtx|m1|m2|m3|i7|i9|ryzen|16gb|32gb|ps5|playstation)/i.test(name);
    if (!hasPerformanceSignal) {
      riskScore += 0.28;
      reasons.push('The intended use may require specific performance specs that are not clear from this listing.');
    }
  }

  if ((intent.includes('gift') || intent.includes('size')) && /(fashion|clothing)/i.test(category)) {
    riskScore += 0.2;
    reasons.push('Size and fit are common return reasons for clothing and gift purchases.');
  }

  if (product?.originalPrice && product?.recommendedPrice && product.recommendedPrice > product.originalPrice * 0.95) {
    riskScore += 0.08;
    reasons.push('Price is close to original retail, so buyer expectations may be higher.');
  }

  if (reasons.length === 1 && product?.condition === 'new') {
    reasons.push('Reviews and product details should still be checked before adding to cart.');
  }

  const riskLevel = riskScore >= 0.65 ? 'high' : riskScore >= 0.35 ? 'medium' : 'low';

  return {
    riskLevel,
    riskScore,
    shouldWarnBeforePurchase: riskScore >= 0.35,
    summary: riskLevel === 'low'
      ? 'Return risk looks low for this new product, but confirm it matches your use case.'
      : 'Return risk is moderate. Check the product details before adding it to cart.',
    reasons,
    suggestions: ['Confirm specs, size, warranty, and included accessories before checkout.'],
    fallback: true,
  };
}

export default function ReturnRiskCheck({ productId, product }) {
  const [buyerIntent, setBuyerIntent] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const runCheck = async (intent = buyerIntent) => {
    if ((!productId && !product) || loading) return;
    setLoading(true);
    try {
      if (!productId || String(productId).startsWith('demo-')) {
        setResult(localRiskCheck(product, intent));
        return;
      }

      const data = await api.checkReturnRisk({
        productId,
        buyerIntent: intent.trim(),
      });
      setResult(data);
    } catch (err) {
      setResult({
        riskLevel: 'medium',
        riskScore: 0.5,
        summary: err.message || 'Could not analyze return risk. Review details before buying.',
        reasons: ['Return risk could not be calculated from the backend right now.'],
        suggestions: ['Confirm condition, model, and accessories with the seller.'],
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runCheck('');
  }, [productId, product]);

  return (
    <div className={`return-risk-card risk-${result?.riskLevel || 'unknown'}`}>
      <div className="return-risk-header">
        <div>
          <strong>Predictive Return Prevention</strong>
          <span>Check fit before buying</span>
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
