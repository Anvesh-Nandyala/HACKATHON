const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const { store } = require('../db/store');

const AWS_REGION = process.env.AWS_REGION || 'ap-south-2';
const BEDROCK_REGION = process.env.BEDROCK_REGION || AWS_REGION;
const BEDROCK_MODEL_ID = process.env.ROUTING_BEDROCK_MODEL_ID
  || process.env.BEDROCK_MODEL_ID
  || 'anthropic.claude-3-haiku-20240307-v1:0';

const bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION });

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in Bedrock response');
  return JSON.parse(match[0]);
}

function determineRouteLocally(request) {
  const score = Number(request.conditionScore || 70);
  const working = request.working !== false;
  const estimatedPrice = Number(request.estimatedPrice || request.recommendedPrice || 0);
  const destination = !working && score < 45
    ? 'recycle'
    : !working || score < 65
      ? 'donate'
      : score < 78
        ? 'refurbish'
        : 'resell';
  const recoveryValue = destination === 'recycle'
    ? Math.max(1, estimatedPrice * 0.1)
    : destination === 'donate'
      ? Math.max(1, estimatedPrice * 0.25)
      : destination === 'refurbish'
        ? Math.max(1, estimatedPrice * 0.7)
        : estimatedPrice;

  return {
    productId: request.productId,
    destination,
    recoveryValue: Math.round(recoveryValue * 100) / 100,
    logisticsCost: 0,
    netValue: Math.round(recoveryValue * 100) / 100,
    confidence: 0.7,
    reasoning: 'Local routing completed.',
    sustainabilityScore: Math.max(40, Math.min(95, score)),
    co2SavedKg: Math.round((1 + score / 25) * 100) / 100,
    estimatedDays: destination === 'resell' ? 5 : 10,
    alternativeRoutes: [],
  };
}

function normalizeRouteResult(result, productId) {
  const allowedDestinations = ['resell', 'refurbish', 'donate', 'recycle', 'exchange'];
  const destination = allowedDestinations.includes(result.destination) ? result.destination : 'resell';
  const recoveryValue = Math.round(Number(result.recoveryValue || 0) * 100) / 100;

  return {
    productId,
    destination,
    recoveryValue,
    logisticsCost: Math.round(Number(result.logisticsCost || 0) * 100) / 100,
    netValue: Math.round(Number(result.netValue || recoveryValue) * 100) / 100,
    confidence: Math.max(0, Math.min(1, Number(result.confidence || 0.7))),
    reasoning: result.reasoning || 'Bedrock routing completed.',
    sustainabilityScore: Math.max(0, Math.min(100, Number(result.sustainabilityScore || 50))),
    co2SavedKg: Math.max(0, Number(result.co2SavedKg || 0)),
    estimatedDays: Math.max(1, Math.round(Number(result.estimatedDays || 7))),
    alternativeRoutes: Array.isArray(result.alternativeRoutes) ? result.alternativeRoutes.slice(0, 3) : [],
  };
}

async function determineRouteWithBedrock(request) {
  const response = await bedrock.send(new ConverseCommand({
    modelId: BEDROCK_MODEL_ID,
    inferenceConfig: {
      maxTokens: 800,
      temperature: 0.2,
    },
    messages: [{
      role: 'user',
      content: [{
        text: `Choose the best recovery route for this circular-commerce product. Return ONLY JSON:
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
  "alternativeRoutes": []
}

Product:
${JSON.stringify(request, null, 2)}`,
      }],
    }],
  }));

  return normalizeRouteResult(
    extractJson(response.output?.message?.content?.[0]?.text || '{}'),
    request.productId
  );
}

async function determineRoute(request) {
  if (!request.productId) throw new Error('productId is required');

  let result;
  if (process.env.ENABLE_BEDROCK === 'true') {
    try {
      result = await determineRouteWithBedrock(request);
    } catch (err) {
      console.warn(`[routing] Falling back after Bedrock failure: ${err.message}`);
      result = determineRouteLocally(request);
    }
  } else {
    result = determineRouteLocally(request);
  }

  store.emitEvent({
    type: 'RouteDecided',
    detail: {
      productId: request.productId,
      destination: result.destination,
      recoveryValue: result.recoveryValue,
    },
  });

  return result;
}

module.exports = {
  determineRoute,
};
