const { store } = require('../db/store');

/**
 * AI Product Verification Service.
 * Analyzes uploaded media to assess condition, detect damage, and authenticate products.
 * In production, this calls Amazon Rekognition + Bedrock.
 */

const GRADE_THRESHOLDS = { A: 90, B: 70, C: 40, D: 0 };

// Condition score weights
const WEIGHTS = {
  surfaceDamage: 0.25,
  structuralIntegrity: 0.30,
  functionalStatus: 0.30,
  completeness: 0.10,
  aiAdjustment: 0.05,
};

function scoreToGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 70) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

/**
 * Simulate Rekognition image analysis.
 */
function analyzeImages(imageKeys) {
  return imageKeys.map((key, i) => ({
    key,
    labels: ['product', 'item', 'object'],
    damageDetected: Math.random() > 0.7,
    surfaceScore: 60 + Math.random() * 40,
    textDetected: [],
    confidence: 0.85 + Math.random() * 0.15,
  }));
}

/**
 * Simulate Rekognition video analysis.
 */
function analyzeVideo(videoKey) {
  return {
    key: videoKey,
    workingScore: 0.5 + Math.random() * 0.5,
    functionalIndicators: ['powers_on', 'responsive'],
    durationSeconds: 15 + Math.random() * 45,
    confidence: 0.8 + Math.random() * 0.2,
  };
}

/**
 * Simulate Bedrock AI assessment synthesis.
 */
function synthesizeWithAI(imageAnalyses, videoAnalysis, declaredProduct) {
  const hasDamage = imageAnalyses.some(a => a.damageDetected);

  return {
    adjustmentFactor: hasDamage ? -5 + Math.random() * 10 : Math.random() * 10,
    authenticityScore: 0.7 + Math.random() * 0.3,
    reasoning: `Product appears ${hasDamage ? 'to have minor wear' : 'to be in good condition'}. Category match: ${declaredProduct.category}.`,
  };
}

/**
 * Calculate condition score using weighted formula.
 */
function calculateConditionScore(indicators) {
  const raw =
    indicators.surfaceDamage * WEIGHTS.surfaceDamage +
    indicators.structuralIntegrity * WEIGHTS.structuralIntegrity +
    indicators.functionalStatus * WEIGHTS.functionalStatus +
    indicators.completeness * WEIGHTS.completeness +
    indicators.aiAdjustment * WEIGHTS.aiAdjustment;

  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * Main verification function.
 */
async function verifyProduct(request) {
  const { productId, userId, imageKeys, videoKey, declaredCategory, declaredBrand, declaredModel } = request;

  // Step 1: Parallel image and video analysis
  const imageAnalyses = analyzeImages(imageKeys);
  const videoAnalysis = analyzeVideo(videoKey);

  // Step 2: AI synthesis
  const aiAssessment = synthesizeWithAI(imageAnalyses, videoAnalysis, {
    category: declaredCategory,
    brand: declaredBrand,
    model: declaredModel,
  });

  // Step 3: Calculate condition score
  const avgSurface = imageAnalyses.reduce((s, a) => s + a.surfaceScore, 0) / imageAnalyses.length;
  const structuralScore = avgSurface * 0.95 + Math.random() * 5;
  const functionalScore = videoAnalysis.workingScore * 100;
  const completenessScore = 70 + Math.random() * 30;

  const conditionScore = calculateConditionScore({
    surfaceDamage: avgSurface,
    structuralIntegrity: structuralScore,
    functionalStatus: functionalScore,
    completeness: completenessScore,
    aiAdjustment: 50 + aiAssessment.adjustmentFactor,
  });

  const grade = scoreToGrade(conditionScore);
  const working = videoAnalysis.workingScore > 0.7;
  const confidence = (imageAnalyses.reduce((s, a) => s + a.confidence, 0) / imageAnalyses.length + videoAnalysis.confidence) / 2;

  const damageDetected = imageAnalyses
    .filter(a => a.damageDetected)
    .map((a, i) => ({
      location: `image-${i + 1}`,
      severity: 'minor',
      description: 'Surface wear detected',
    }));

  const result = {
    productId,
    conditionScore,
    grade,
    working,
    confidence: Math.round(confidence * 100) / 100,
    damageDetected,
    authenticityScore: Math.round(aiAssessment.authenticityScore * 100) / 100,
    verifiedAt: new Date().toISOString(),
  };

  // Emit event
  store.emitEvent({
    type: 'ProductVerified',
    detail: { productId, conditionScore, grade, working },
  });

  return result;
}

module.exports = {
  verifyProduct,
  scoreToGrade,
  calculateConditionScore,
  WEIGHTS,
};
