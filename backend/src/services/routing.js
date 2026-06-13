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

function normalizeRouteResult(result) {
  const allowedDestinations = [
    'resell',
    'refurbish',
    'donate',
    'recycle',
    'exchange'
  ];

  const destination = allowedDestinations.includes(result.destination)
    ? result.destination
    : 'resell';

  return {
    destination,
    recoveryValue: Math.round(Number(result.recoveryValue || 0) * 100) / 100,
    logisticsCost: Math.round(Number(result.logisticsCost || 0) * 100) / 100,
    netValue: Math.round(Number(result.netValue || 0) * 100) / 100,
    confidence: Math.max(0, Math.min(1, Number(result.confidence || 0.7))),
    reasoning: result.reasoning || 'AI routing completed.',
    sustainabilityScore: Math.max(
      0,
      Math.min(100, Number(result.sustainabilityScore || 50))
    ),
    co2SavedKg: Math.max(0, Number(result.co2SavedKg || 0)),
    estimatedDays: Math.max(1, Math.round(Number(result.estimatedDays || 7))),
    alternativeRoutes: Array.isArray(result.alternativeRoutes)
      ? result.alternativeRoutes.slice(0, 3)
      : []
  };
}

async function determineRouteWithBedrock(request) {
  const prompt = `
You are an AI routing engine for a circular commerce platform.

Choose the best recovery destination for this product.

Possible destinations:
1. resell
2. refurbish
3. donate
4. recycle
5. exchange

Product data:
${JSON.stringify(request, null, 2)}

Optimize for:
1. Maximum recovery value
2. Low logistics cost
3. Sustainability
4. Local demand
5. Processing time
6. Product condition
7. Whether the item is working
8. Whether the product is suitable for resale, donation, recycling, refurbishment, or exchange

Return ONLY valid JSON in this exact format:
{
  "destination": "resell | refurbish | donate | recycle | exchange",
  "recoveryValue": number,
  "logisticsCost": number,
  "netValue": number,
  "confidence": 0-1,
  "reasoning": "short explanation",
  "sustainabilityScore": 0-100,
  "co2SavedKg": number,
  "estimatedDays": number,
  "alternativeRoutes": [
    {
      "destination": "resell | refurbish | donate | recycle | exchange",
      "recoveryValue": number,
      "logisticsCost": number,
      "netValue": number,
      "score": 0-100,
      "reason": "short reason"
    }
  ]
}
`;

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 800,
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

  return normalizeRouteResult(extractJson(text));
}

async function determineRoute(request) {
  const {
    productId,
    conditionScore,
    grade,
    category,
    estimatedPrice,
    location,
    weight,
    dimensions,
    working,
    authenticityScore,
    recommendedPrice,
    priceRange
  } = request;

  if (!productId) {
    throw new Error('productId is required');
  }

  const result = await determineRouteWithBedrock({
    productId,
    conditionScore,
    grade,
    category,
    estimatedPrice,
    recommendedPrice,
    priceRange,
    location,
    weight,
    dimensions,
    working,
    authenticityScore
  });

  const finalResult = {
    productId,
    ...result
  };

  store.emitEvent({
    type: 'RouteDecided',
    detail: {
      productId,
      destination: finalResult.destination,
      recoveryValue: finalResult.recoveryValue
    },
  });

  return finalResult;
}

module.exports = {
  determineRoute
};