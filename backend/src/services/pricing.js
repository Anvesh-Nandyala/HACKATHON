const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const { store } = require('../db/store');

const AWS_REGION = process.env.AWS_REGION || 'ap-south-2';
const BEDROCK_REGION = process.env.BEDROCK_REGION || AWS_REGION;
const BEDROCK_MODEL_ID = process.env.PRICING_BEDROCK_MODEL_ID
  || process.env.BEDROCK_MODEL_ID
  || 'anthropic.claude-3-haiku-20240307-v1:0';

const bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION });

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in Bedrock response');
  return JSON.parse(match[0]);
}

function estimatePriceLocally(request) {
  const originalPrice = Number(request.originalPrice || 1);
  const ageMonths = Number(request.ageMonths || 0);
  const conditionScore = Number(request.conditionScore || 75);
  const ageMultiplier = Math.max(0.35, 1 - ageMonths * 0.015);
  const conditionMultiplier = Math.max(0.35, conditionScore / 100);
  const workingMultiplier = request.working === false ? 0.55 : 1;
  const recommendedPrice = Math.max(
    1,
    Math.round(originalPrice * ageMultiplier * conditionMultiplier * workingMultiplier)
  );

  return {
    productId: request.productId,
    recommendedPrice,
    priceRange: {
      min: Math.max(1, Math.round(recommendedPrice * 0.85)),
      max: Math.max(1, Math.round(recommendedPrice * 1.15)),
    },
    confidence: 0.7,
    factors: [
      { name: 'quality', impact: conditionMultiplier, description: `Quality factor ${conditionScore}/100` },
      { name: 'age', impact: ageMultiplier, description: `${ageMonths} months since purchase` },
    ],
    estimatedDaysToSell: conditionScore >= 80 ? 5 : 9,
  };
}

function normalizePriceResult(result, originalPrice, productId) {
  const recommendedPrice = Math.max(1, Math.round(Number(result.recommendedPrice || originalPrice * 0.5)));
  return {
    productId,
    recommendedPrice,
    priceRange: {
      min: Math.max(1, Math.round(Number(result.priceRange?.min || recommendedPrice * 0.85))),
      max: Math.max(1, Math.round(Number(result.priceRange?.max || recommendedPrice * 1.15))),
    },
    confidence: Math.max(0, Math.min(1, Number(result.confidence || 0.7))),
    factors: Array.isArray(result.factors) ? result.factors : [],
    estimatedDaysToSell: Math.max(1, Math.round(Number(result.estimatedDaysToSell || 7))),
  };
}

async function estimatePriceWithBedrock(request) {
  const response = await bedrock.send(new ConverseCommand({
    modelId: BEDROCK_MODEL_ID,
    inferenceConfig: {
      maxTokens: 700,
      temperature: 0.2,
    },
    messages: [{
      role: 'user',
      content: [{
        text: `Estimate fair local resale pricing for this product. Return ONLY JSON:
{
  "recommendedPrice": number,
  "priceRange": { "min": number, "max": number },
  "confidence": 0-1,
  "factors": [],
  "estimatedDaysToSell": number
}

Product:
${JSON.stringify(request, null, 2)}`,
      }],
    }],
  }));

  return normalizePriceResult(
    extractJson(response.output?.message?.content?.[0]?.text || '{}'),
    Number(request.originalPrice || 1),
    request.productId
  );
}

async function estimatePrice(request) {
  if (!request.productId) throw new Error('productId is required');
  if (!request.originalPrice || Number(request.originalPrice) <= 0) {
    throw new Error('originalPrice must be greater than 0');
  }

  let result;
  if (process.env.ENABLE_BEDROCK === 'true') {
    try {
      result = await estimatePriceWithBedrock(request);
    } catch (err) {
      console.warn(`[pricing] Falling back after Bedrock failure: ${err.message}`);
      result = estimatePriceLocally(request);
    }
  } else {
    result = estimatePriceLocally(request);
  }

  store.emitEvent({
    type: 'PriceEstimated',
    detail: {
      productId: request.productId,
      recommendedPrice: result.recommendedPrice,
      confidence: result.confidence,
    },
  });

  return result;
}

module.exports = {
  estimatePrice,
};
