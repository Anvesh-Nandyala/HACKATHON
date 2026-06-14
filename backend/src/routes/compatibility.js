const express = require('express');
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const { store } = require('../db/store');

const router = express.Router();

const BEDROCK_REGION = process.env.BEDROCK_REGION || process.env.AWS_REGION || 'ap-south-2';
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';
const bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION });

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

module.exports = router;
