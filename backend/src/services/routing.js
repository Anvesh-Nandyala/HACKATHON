const { store } = require('../db/store');

/**
 * AI Routing Engine.
 * Determines optimal destination: resell, refurbish, donate, recycle, or exchange.
 * Optimizes for recovery value, sustainability, and logistics cost.
 */

// Base logistics costs per destination
const BASE_COSTS = {
  resell: { shipping: 5, inspection: 2, repair: 0 },
  refurbish: { shipping: 8, inspection: 5, repair: 25 },
  donate: { shipping: 3, inspection: 0, repair: 0 },
  recycle: { shipping: 2, inspection: 0, repair: 0 },
  exchange: { shipping: 0, inspection: 1, repair: 0 },
};

// Route scoring weights
const ROUTE_WEIGHTS = {
  recoveryValue: 0.40,
  environmentalImpact: 0.25,
  timeToProcess: 0.15,
  demandScore: 0.20,
};

/**
 * Check if a product is eligible for a given destination based on condition.
 */
function isEligible(destination, conditionScore) {
  switch (destination) {
    case 'resell': return conditionScore > 90;
    case 'refurbish': return conditionScore > 70 && conditionScore <= 90;
    case 'donate': return conditionScore > 40 && conditionScore <= 70;
    case 'recycle': return conditionScore <= 40;
    case 'exchange': return conditionScore > 60;
    default: return false;
  }
}

/**
 * Calculate logistics cost for a route.
 */
function calculateLogisticsCost(destination, weight, distance) {
  const base = BASE_COSTS[destination];
  const weightFactor = weight * 0.5;
  const distanceFactor = distance * 0.1;

  return {
    shippingCost: base.shipping + weightFactor + distanceFactor,
    inspectionCost: base.inspection,
    repairCost: base.repair,
    totalCost: base.shipping + base.inspection + base.repair + weightFactor + distanceFactor,
  };
}

/**
 * Calculate expected value for each destination.
 */
function calculateExpectedValue(destination, estimatedPrice, conditionScore) {
  switch (destination) {
    case 'resell': return estimatedPrice;
    case 'refurbish': return estimatedPrice * 0.7;
    case 'donate': return estimatedPrice * 0.1; // tax benefit value
    case 'recycle': return estimatedPrice * 0.05; // material recovery
    case 'exchange': return estimatedPrice * 0.9;
    default: return 0;
  }
}

/**
 * Calculate environmental impact score (CO2 saved in kg).
 */
function calculateEnvironmentalImpact(destination, weight) {
  const co2PerKg = {
    resell: 3.0,      // Avoids new manufacturing
    refurbish: 2.5,
    donate: 2.0,
    recycle: 1.5,
    exchange: 2.8,
  };
  return (co2PerKg[destination] || 1) * weight;
}

/**
 * Score a route across multiple dimensions.
 */
function calculateRouteScore(route) {
  const maxRecovery = 200; // normalization ceiling
  const maxCo2 = 50;

  const normalizedRecovery = Math.max(0, route.recoveryValue) / maxRecovery;
  const normalizedEnvironment = route.co2Saved / maxCo2;
  const normalizedTime = 1 - (route.estimatedDays / 30); // lower is better
  const normalizedDemand = route.localDemand;

  return (
    normalizedRecovery * ROUTE_WEIGHTS.recoveryValue +
    normalizedEnvironment * ROUTE_WEIGHTS.environmentalImpact +
    normalizedTime * ROUTE_WEIGHTS.timeToProcess +
    normalizedDemand * ROUTE_WEIGHTS.demandScore
  );
}

/**
 * Main routing decision function.
 */
async function determineRoute(request) {
  const { productId, conditionScore, grade, category, estimatedPrice, location, weight, dimensions } = request;
  const distance = 10; // Default distance estimate in km

  const destinations = ['resell', 'refurbish', 'donate', 'recycle', 'exchange'];

  // Calculate all routes
  const allRoutes = destinations.map(destination => {
    const eligible = isEligible(destination, conditionScore);
    const logistics = calculateLogisticsCost(destination, weight || 1, distance);
    const expectedValue = calculateExpectedValue(destination, estimatedPrice, conditionScore);
    const co2Saved = calculateEnvironmentalImpact(destination, weight || 1);

    return {
      destination,
      eligible,
      expectedValue,
      ...logistics,
      recoveryValue: expectedValue - logistics.totalCost,
      netValue: expectedValue - logistics.totalCost,
      co2Saved,
      estimatedDays: destination === 'resell' ? 7 : destination === 'refurbish' ? 14 : 3,
      localDemand: 0.5 + Math.random() * 0.5,
      confidence: eligible ? 0.8 + Math.random() * 0.2 : 0.3,
    };
  });

  // Filter to eligible routes
  const eligibleRoutes = allRoutes.filter(r => r.eligible);

  // If nothing eligible, fall back to best available
  const routesToScore = eligibleRoutes.length > 0 ? eligibleRoutes : allRoutes;

  // Score and sort
  const scoredRoutes = routesToScore.map(route => ({
    ...route,
    score: calculateRouteScore(route),
  })).sort((a, b) => b.score - a.score);

  const optimal = scoredRoutes[0];

  // Generate reasoning
  let reasoning = `Product routed to ${optimal.destination} based on condition score ${conditionScore} (Grade ${grade}).`;
  reasoning += ` Recovery value: $${optimal.recoveryValue.toFixed(2)}, logistics cost: $${optimal.totalCost.toFixed(2)}.`;
  reasoning += ` Environmental impact: ${optimal.co2Saved.toFixed(1)} kg CO2 saved.`;

  // Handle negative recovery
  if (optimal.recoveryValue < 0) {
    reasoning = `All routes yield negative recovery. Suggesting ${optimal.destination} as least-cost option. ` + reasoning;
  }

  const result = {
    productId,
    destination: optimal.destination,
    recoveryValue: Math.round(optimal.recoveryValue * 100) / 100,
    logisticsCost: Math.round(optimal.totalCost * 100) / 100,
    netValue: Math.round(optimal.netValue * 100) / 100,
    confidence: Math.round(optimal.confidence * 100) / 100,
    reasoning,
    alternativeRoutes: scoredRoutes.slice(1, 4).map(r => ({
      destination: r.destination,
      recoveryValue: Math.round(r.recoveryValue * 100) / 100,
      logisticsCost: Math.round(r.totalCost * 100) / 100,
      score: Math.round(r.score * 100) / 100,
    })),
  };

  // Emit event
  store.emitEvent({
    type: 'RouteDecided',
    detail: { productId, destination: result.destination, recoveryValue: result.recoveryValue },
  });

  return result;
}

module.exports = {
  determineRoute,
  isEligible,
  calculateLogisticsCost,
  calculateRouteScore,
  ROUTE_WEIGHTS,
};
