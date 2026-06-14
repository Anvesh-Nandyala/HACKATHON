const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const { store } = require('../db/store');

/**
 * Personalization Service — uses Bedrock to score product relevance for a user.
 */

const AWS_REGION = process.env.AWS_REGION || 'ap-south-2';
const BEDROCK_REGION = process.env.BEDROCK_REGION || AWS_REGION;
const MODEL_ID = process.env.PERSONALIZATION_BEDROCK_MODEL_ID
  || process.env.BEDROCK_MODEL_ID
  || 'anthropic.claude-3-haiku-20240307-v1:0';
const THRESHOLD = parseFloat(process.env.PERSONALIZATION_THRESHOLD || '0.7');
const TIMEOUT_MS = 5000;

const bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION });

function isEnabled() {
  return process.env.ENABLE_BEDROCK === 'true';
}

/**
 * Gather user context for personalization prompt.
 */
async function getUserContext(userId) {
  const [user, transactions, subscriptions] = await Promise.all([
    store.getUser(userId),
    store.getTransactionsForUser(userId),
    store.getSubscriptions(userId),
  ]);

  const completedTxns = transactions.filter(t => t.status === 'completed');
  const categories = [...new Set(completedTxns.map(t => t.category).filter(Boolean))];
  const priceRanges = completedTxns
    .map(t => t.agreedPrice)
    .filter(p => p > 0);

  return {
    purchaseHistory: {
      categories,
      avgPrice: priceRanges.length > 0
        ? Math.round(priceRanges.reduce((s, p) => s + p, 0) / priceRanges.length)
        : 0,
      totalPurchases: completedTxns.length,
    },
    activeInterests: subscriptions.map(s => ({
      category: s.category,
      priceRange: s.priceRange,
      radiusKm: s.radiusKm,
    })),
  };
}

/**
 * Score how relevant a product is to a specific user (0.0–1.0).
 * Returns 1.0 (deliver) on any failure.
 */
async function scoreRelevance(userId, product) {
  if (!isEnabled()) return 1.0;

  try {
    const context = await getUserContext(userId);

    const prompt = `Score how relevant this product is to this user on a scale of 0.0 to 1.0. Return ONLY a JSON object: {"score": 0.0-1.0, "reason": "brief explanation"}

User context:
${JSON.stringify(context, null, 2)}

Product:
- Category: ${product.category}
- Brand: ${product.brand}
- Condition: ${product.verification?.conditionScore || 'unknown'}/100
- Price: ${product.priceEstimate?.recommendedPrice || product.originalPrice}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await bedrock.send(new ConverseCommand({
      modelId: MODEL_ID,
      inferenceConfig: { maxTokens: 200, temperature: 0.1 },
      messages: [{ role: 'user', content: [{ text: prompt }] }],
    }), { abortSignal: controller.signal });

    clearTimeout(timeout);

    const text = response.output?.message?.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const score = Math.max(0, Math.min(1, Number(parsed.score || 1)));
      return score;
    }

    return 1.0; // Can't parse — deliver anyway
  } catch (err) {
    console.warn(`[Personalization] Score failed for ${userId}: ${err.message}`);
    return 1.0; // Fallback: deliver
  }
}

module.exports = { isEnabled, getUserContext, scoreRelevance };
