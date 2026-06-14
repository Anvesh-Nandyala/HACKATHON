const express = require('express');
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const { store } = require('../db/store');

const router = express.Router();

const BEDROCK_REGION = process.env.BEDROCK_REGION || process.env.AWS_REGION || 'ap-south-2';
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';
const bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION });

function clampScore(value, fallback = 0.4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function productPrice(product) {
  return product.priceEstimate?.recommendedPrice
    || product.recommendedPrice
    || product.price
    || product.originalPrice
    || 0;
}

function localReturnRisk(product, buyerIntent = '') {
  const reasons = [];
  let riskScore = 0.2;

  const conditionScore = Number(product.verification?.conditionScore || product.conditionScore || 0);
  const working = product.verification?.working ?? product.working;
  const ageMonths = Number(product.ageMonths || 0);
  const description = product.description || '';
  const intent = buyerIntent.toLowerCase();
  const category = (product.category || '').toLowerCase();
  const name = `${product.brand || ''} ${product.model || ''}`.toLowerCase();

  if (conditionScore && conditionScore < 70) {
    riskScore += 0.25;
    reasons.push('Condition score is below 70, so buyer expectations should be checked carefully.');
  }

  if (working === false) {
    riskScore += 0.35;
    reasons.push('The item is marked as not fully working.');
  }

  if (ageMonths > 36) {
    riskScore += 0.12;
    reasons.push('The product is older than 3 years.');
  }

  if (description.trim().length < 30) {
    riskScore += 0.1;
    reasons.push('The listing description is short, so important details may be missing.');
  }

  if (intent.includes('gaming') && category === 'electronics' && !/(gaming|rtx|gtx|playstation|xbox|gpu)/i.test(`${name} ${description}`)) {
    riskScore += 0.18;
    reasons.push('The buyer mentioned gaming, but the listing does not clearly show gaming specifications.');
  }

  if ((intent.includes('video editing') || intent.includes('editing')) && category === 'electronics' && !/(m1|m2|m3|i7|i9|ryzen|16gb|32gb|gpu|rtx)/i.test(`${name} ${description}`)) {
    riskScore += 0.18;
    reasons.push('The buyer mentioned editing, but performance specs are not clearly listed.');
  }

  const price = productPrice(product);
  const originalPrice = Number(product.originalPrice || 0);
  if (price && originalPrice && price > originalPrice * 0.9 && conditionScore && conditionScore < 85) {
    riskScore += 0.12;
    reasons.push('The price is close to original price for a non-new condition score.');
  }

  if (reasons.length === 0) {
    reasons.push('No major mismatch signals were found from the listing details.');
  }

  const score = clampScore(riskScore);
  const level = score >= 0.65 ? 'high' : score >= 0.35 ? 'medium' : 'low';

  return {
    riskLevel: level,
    riskScore: score,
    shouldWarnBeforePurchase: score >= 0.35,
    summary: level === 'low'
      ? 'Return risk looks low based on the listing details.'
      : level === 'medium'
        ? 'Return risk is moderate. The buyer should confirm the listed details before reserving.'
        : 'Return risk is high. The buyer should ask the seller for more proof before reserving.',
    reasons,
    suggestions: [
      'Check the product photos and video carefully.',
      'Confirm the exact model and condition with the seller.',
      'Ask about battery, accessories, warranty, or defects if relevant.',
    ],
    fallback: true,
  };
}

/**
 * POST /api/compatibility/check
 * AI Compatibility Check — tells buyer if a product fits their use case.
 * Prevents returns by warning before purchase.
 */
router.post('/check', async (req, res, next) => {
  try {
    const { productId, userQuery } = req.body;

    if (!productId || !userQuery) {
      return res.status(400).json({ error: 'productId and userQuery are required' });
    }

    if (userQuery.length > 300) {
      return res.status(400).json({ error: 'Query must be under 300 characters' });
    }

    const product = await store.getProduct(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Use local fallback if Bedrock is disabled
    if (process.env.ENABLE_BEDROCK !== 'true') {
      return res.json({
        compatible: true,
        confidence: 0.5,
        explanation: 'AI analysis is currently unavailable. Based on the product category and condition, this item may suit your needs. Please review the specifications carefully.',
        warnings: [],
        fallback: true,
      });
    }

    const prompt = `You are a product compatibility advisor. A buyer is asking if a product fits their needs. Analyze and respond with ONLY a JSON object:
{
  "compatible": true/false,
  "confidence": 0.0-1.0,
  "explanation": "2-3 sentence explanation of why it's a good/bad fit",
  "warnings": ["list of potential issues or empty array"]
}

Product:
- Category: ${product.category}
- Brand: ${product.brand}
- Model: ${product.model}
- Condition Score: ${product.verification?.conditionScore || 'unknown'}/100
- Grade: ${product.verification?.grade || 'unknown'}
- Working: ${product.verification?.working !== false ? 'Yes' : 'No'}
- Age: ${product.ageMonths || 'unknown'} months
- Description: ${product.description || 'None provided'}

Buyer's question: "${userQuery}"`;

    const response = await bedrock.send(new ConverseCommand({
      modelId: MODEL_ID,
      inferenceConfig: { maxTokens: 400, temperature: 0.2 },
      messages: [{ role: 'user', content: [{ text: prompt }] }],
    }));

    const text = response.output?.message?.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);

    if (match) {
      const result = JSON.parse(match[0]);
      return res.json({
        compatible: !!result.compatible,
        confidence: Math.max(0, Math.min(1, Number(result.confidence || 0.7))),
        explanation: result.explanation || 'Analysis complete.',
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
      });
    }

    res.json({
      compatible: true,
      confidence: 0.5,
      explanation: 'Unable to fully analyze compatibility. Please review product details.',
      warnings: [],
    });
  } catch (err) {
    console.error(`[Compatibility] Error: ${err.message}`);
    res.json({
      compatible: true,
      confidence: 0.3,
      explanation: 'AI analysis encountered an issue. Please review the product specifications manually.',
      warnings: [],
      fallback: true,
    });
  }
});

/**
 * POST /api/compatibility/return-risk
 * Predictive return prevention before purchase/reservation.
 */
router.post('/return-risk', async (req, res, next) => {
  try {
    const { productId, buyerIntent = '' } = req.body;

    if (!productId) {
      return res.status(400).json({ error: 'productId is required' });
    }

    if (String(buyerIntent).length > 300) {
      return res.status(400).json({ error: 'Buyer intent must be under 300 characters' });
    }

    const product = await store.getProduct(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const fallback = localReturnRisk(product, buyerIntent);

    if (process.env.ENABLE_BEDROCK !== 'true') {
      return res.json(fallback);
    }

    const prompt = `You are a return prevention analyst for a resale marketplace. Estimate whether this buyer may return or regret reserving this product BEFORE purchase. Return ONLY JSON:
{
  "riskLevel": "low" | "medium" | "high",
  "riskScore": 0.0-1.0,
  "shouldWarnBeforePurchase": true/false,
  "summary": "one short buyer-friendly summary",
  "reasons": ["specific return-risk reasons"],
  "suggestions": ["specific checks the buyer should do before reserving"]
}

Product:
- Category: ${product.category}
- Brand: ${product.brand}
- Model: ${product.model}
- Price: ${productPrice(product)}
- Original price: ${product.originalPrice || 'unknown'}
- Condition score: ${product.verification?.conditionScore || product.conditionScore || 'unknown'}/100
- Grade: ${product.verification?.grade || product.grade || 'unknown'}
- Working: ${product.verification?.working !== false && product.working !== false ? 'Yes' : 'No'}
- Age: ${product.ageMonths || 'unknown'} months
- Purchase date: ${product.purchaseDate || 'unknown'}
- Description: ${product.description || 'None provided'}

Buyer intended use:
${buyerIntent || 'Not provided'}`;

    const response = await bedrock.send(new ConverseCommand({
      modelId: MODEL_ID,
      inferenceConfig: { maxTokens: 500, temperature: 0.15 },
      messages: [{ role: 'user', content: [{ text: prompt }] }],
    }));

    const text = response.output?.message?.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);

    if (!match) {
      return res.json(fallback);
    }

    const parsed = JSON.parse(match[0]);
    const riskScore = clampScore(parsed.riskScore, fallback.riskScore);
    const riskLevel = ['low', 'medium', 'high'].includes(parsed.riskLevel)
      ? parsed.riskLevel
      : riskScore >= 0.65 ? 'high' : riskScore >= 0.35 ? 'medium' : 'low';

    res.json({
      riskLevel,
      riskScore,
      shouldWarnBeforePurchase: Boolean(parsed.shouldWarnBeforePurchase ?? riskScore >= 0.35),
      summary: parsed.summary || fallback.summary,
      reasons: Array.isArray(parsed.reasons) && parsed.reasons.length ? parsed.reasons : fallback.reasons,
      suggestions: Array.isArray(parsed.suggestions) && parsed.suggestions.length ? parsed.suggestions : fallback.suggestions,
      fallback: false,
    });
  } catch (err) {
    console.error(`[ReturnRisk] Error: ${err.message}`);
    try {
      const product = req.body?.productId ? await store.getProduct(req.body.productId) : null;
      if (product) {
        return res.json(localReturnRisk(product, req.body?.buyerIntent || ''));
      }
    } catch (_) {}
    res.status(500).json({ error: 'Could not analyze return risk' });
  }
});

module.exports = router;
