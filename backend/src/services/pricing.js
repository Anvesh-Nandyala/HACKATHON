const { store } = require('../db/store');

/**
 * AI Price Estimation Service.
 * Determines fair resale value based on condition, market demand, and depreciation.
 * In production, this uses Bedrock for market analysis.
 */

// Category-specific depreciation curves (annual depreciation rate)
const DEPRECIATION_RATES = {
  electronics: 0.25,
  clothing: 0.40,
  furniture: 0.15,
  books: 0.30,
  toys: 0.35,
  appliances: 0.20,
  sports: 0.25,
  tools: 0.15,
  jewelry: 0.10,
  automotive: 0.20,
  'home-garden': 0.20,
  'health-beauty': 0.50,
  office: 0.25,
  'pet-supplies': 0.35,
  other: 0.30,
};

/**
 * Calculate depreciation based on category curve.
 */
function getCategoryDepreciation(category, ageMonths) {
  const annualRate = DEPRECIATION_RATES[category] || 0.30;
  const years = ageMonths / 12;
  // Exponential decay model
  return Math.exp(-annualRate * years);
}

/**
 * Calculate condition multiplier based on grade and score.
 */
function calculateConditionMultiplier(conditionScore, grade, working) {
  let multiplier = conditionScore / 100;

  // Working bonus
  if (working) {
    multiplier *= 1.1;
  } else {
    multiplier *= 0.5;
  }

  // Grade adjustment
  const gradeBonus = { A: 1.05, B: 1.0, C: 0.85, D: 0.6 };
  multiplier *= gradeBonus[grade] || 1.0;

  return Math.min(multiplier, 1.0);
}

/**
 * Simulate local demand factor.
 */
function getLocalDemandMultiplier(location, category) {
  // In production: query local marketplace data and trending categories
  const baseDemand = 0.8 + Math.random() * 0.4;
  return baseDemand;
}

/**
 * Estimate days to sell based on demand and price.
 */
function estimateTimeToSell(demandMultiplier, price, category) {
  const baseTime = 7; // days
  const priceEffect = Math.log10(price + 1) * 2;
  const demandEffect = 1 / demandMultiplier;
  return Math.max(1, Math.round(baseTime * priceEffect * demandEffect));
}

/**
 * Main price estimation function.
 */
async function estimatePrice(request) {
  const { productId, category, originalPrice, ageMonths, conditionScore, grade, working, location } = request;

  // Step 1: Base depreciation
  const depreciationFactor = getCategoryDepreciation(category, ageMonths);
  const baseValue = originalPrice * depreciationFactor;

  // Step 2: Condition adjustment
  const conditionMultiplier = calculateConditionMultiplier(conditionScore, grade, working);
  const conditionAdjustedValue = baseValue * conditionMultiplier;

  // Step 3: Market/demand adjustment
  const demandMultiplier = getLocalDemandMultiplier(location, category);
  const marketAdjustedValue = conditionAdjustedValue * demandMultiplier;

  // Step 4: Price range with confidence
  const recommendedPrice = Math.max(1, Math.round(marketAdjustedValue));
  const confidence = Math.min(0.95, 0.6 + conditionMultiplier * 0.3);
  const margin = recommendedPrice * (1 - confidence) * 0.5;

  const priceRange = {
    min: Math.max(1, Math.round(recommendedPrice - margin)),
    max: Math.round(recommendedPrice + margin),
  };

  // Step 5: Time estimate
  const estimatedDaysToSell = estimateTimeToSell(demandMultiplier, recommendedPrice, category);

  const factors = [
    { name: 'depreciation', impact: depreciationFactor, description: `${Math.round(depreciationFactor * 100)}% value retained after ${ageMonths} months` },
    { name: 'condition', impact: conditionMultiplier, description: `Grade ${grade}, score ${conditionScore}/100` },
    { name: 'demand', impact: demandMultiplier, description: `Local market demand factor` },
  ];

  const result = {
    productId,
    recommendedPrice,
    priceRange,
    confidence: Math.round(confidence * 100) / 100,
    factors,
    estimatedDaysToSell,
  };

  // Emit event
  store.emitEvent({
    type: 'PriceEstimated',
    detail: { productId, recommendedPrice, confidence },
  });

  return result;
}

module.exports = {
  estimatePrice,
  getCategoryDepreciation,
  calculateConditionMultiplier,
  DEPRECIATION_RATES,
};
