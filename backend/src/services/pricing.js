const {
  BedrockRuntimeClient,
  InvokeModelCommand
} = require('@aws-sdk/client-bedrock-runtime');

const { store } = require('../db/store');

const AWS_REGION = process.env.AWS_REGION || 'ap-south-2';
const BEDROCK_MODEL_ID =
  process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';

const bedrock = new BedrockRuntimeClient({ region: AWS_REGION });

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in Bedrock response');
  return JSON.parse(match[0]);
}

function normalizePriceResult(result, originalPrice) {
  const recommendedPrice = Math.max(
    1,
    Math.round(Number(result.recommendedPrice || originalPrice * 0.5))
  );

  const min = Math.max(
    1,
    Math.round(Number(result.priceRange?.min || recommendedPrice * 0.85))
  );

  const max = Math.max(
    min,
    Math.round(Number(result.priceRange?.max || recommendedPrice * 1.15))
  );

  return {
    recommendedPrice,
    priceRange: { min, max },
    confidence: Math.max(0, Math.min(1, Number(result.confidence || 0.7))),
    factors: Array.isArray(result.factors) ? result.factors : [],
    estimatedDaysToSell: Math.max(
      1,
      Math.round(Number(result.estimatedDaysToSell || 7))
    )
  };
}

async function estimatePriceWithBedrock(request) {
  const prompt = `
You are an AI pricing expert for a circular commerce resale marketplace.

Estimate a fair resale price for this second-hand product.

Product data:
${JSON.stringify(request, null, 2)}

Consider:
1. Original price
2. Product category
3. Age in months
4. Condition score
5. Grade
6. Working status
7. Local resale demand
8. Depreciation
9. Expected buyer trust
10. Time to sell

Return ONLY valid JSON in this exact format:
{
  "recommendedPrice": number,
  "priceRange": {
    "min": number,
    "max": number
  },
  "confidence": 0-1,
  "factors": [
    {
      "name": "factor name",
      "impact": number,
      "description": "short explanation"
    }
  ],
  "estimatedDaysToSell": number
}
`;

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 700,
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt
          }
        ]
      }
    ]
  };

  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body)
    })
  );

  const decoded = JSON.parse(Buffer.from(response.body).toString('utf8'));
  const text = decoded.content?.[0]?.text || '{}';

  return normalizePriceResult(
    extractJson(text),
    Number(request.originalPrice || 1)
  );
}

async function estimatePrice(request) {
  const {
    productId,
    category,
    originalPrice,
    ageMonths,
    conditionScore,
    grade,
    working,
    location
  } = request;

  if (!productId) {
    throw new Error('productId is required');
  }

  if (!originalPrice || Number(originalPrice) <= 0) {
    throw new Error('originalPrice must be greater than 0');
  }

  const result = await estimatePriceWithBedrock({
    productId,
    category,
    originalPrice,
    ageMonths,
    conditionScore,
    grade,
    working,
    location
  });

  const finalResult = {
    productId,
    ...result
  };

  store.emitEvent({
    type: 'PriceEstimated',
    detail: {
      productId,
      recommendedPrice: finalResult.recommendedPrice,
      confidence: finalResult.confidence
    },
  });

  return finalResult;
}

module.exports = {
  estimatePrice
};