const { store } = require('../db/store');
const { haversineDistance } = require('./marketplace');

/**
 * Batch Collection Service.
 * Optimizes logistics by consolidating low-value products at local hubs.
 */

function findNearestHub(location, hubs) {
  let nearest = null;
  let minDistance = Infinity;

  for (const hub of hubs) {
    const dist = haversineDistance(
      location.latitude, location.longitude,
      hub.location.latitude, hub.location.longitude
    );
    if (dist < minDistance) {
      minDistance = dist;
      nearest = { ...hub, distance: dist };
    }
  }

  return nearest;
}

function calculateBatchTransportCost(hub, totalWeight) {
  const baseCost = 15;
  const costPerKg = 0.5;
  return baseCost + totalWeight * costPerKg;
}

function calculateIndividualTransportCost(product, hub) {
  const baseCost = 8;
  const costPerKg = 1.2;
  const weight = product.weight || 1;
  return baseCost + weight * costPerKg;
}

async function assignToHub(product) {
  const hubs = await store.getHubs();
  const nearest = findNearestHub(product.location, hubs);

  if (!nearest) {
    const err = new Error('No collection hubs available');
    err.statusCode = 503;
    throw err;
  }

  return {
    productId: product.productId,
    hubId: nearest.hubId,
    hubName: nearest.name,
    hubLocation: nearest.location,
    distanceFromUser: Math.round(nearest.distance * 100) / 100,
    estimatedBatchDate: getEstimatedBatchDate(),
  };
}

async function optimizeBatchCollection(products) {
  const hubs = await store.getHubs();

  if (!products.length || !hubs.length) {
    return { plans: [], totalSavings: 0, viableBatches: 0 };
  }

  const assignments = new Map();

  for (const product of products) {
    const nearest = findNearestHub(product.location, hubs);
    const existing = assignments.get(nearest.hubId) || [];
    existing.push(product);
    assignments.set(nearest.hubId, existing);
  }

  const batchPlans = [];

  for (const [hubId, hubProducts] of assignments) {
    const hub = hubs.find(h => h.hubId === hubId);
    const totalWeight = hubProducts.reduce((sum, p) => sum + (p.weight || 1), 0);
    const totalValue = hubProducts.reduce((sum, p) => sum + (p.priceEstimate?.recommendedPrice || 0), 0);

    const batchTransportCost = calculateBatchTransportCost(hub, totalWeight);
    const individualTransportCost = hubProducts.reduce(
      (sum, p) => sum + calculateIndividualTransportCost(p, hub), 0
    );

    const savings = individualTransportCost - batchTransportCost;
    const isViable = savings > 0 && hubProducts.length >= hub.minBatchSize;

    batchPlans.push({
      hubId,
      hubName: hub.name,
      productCount: hubProducts.length,
      totalWeight: Math.round(totalWeight * 100) / 100,
      totalValue: Math.round(totalValue * 100) / 100,
      batchTransportCost: Math.round(batchTransportCost * 100) / 100,
      individualTransportCost: Math.round(individualTransportCost * 100) / 100,
      savings: Math.round(savings * 100) / 100,
      isViable,
      estimatedPickupDate: isViable ? getEstimatedBatchDate() : null,
    });
  }

  return {
    plans: batchPlans,
    totalSavings: Math.round(batchPlans.reduce((sum, p) => sum + Math.max(0, p.savings), 0) * 100) / 100,
    viableBatches: batchPlans.filter(p => p.isViable).length,
  };
}

function getEstimatedBatchDate() {
  const date = new Date();
  date.setDate(date.getDate() + 3 + Math.floor(Math.random() * 4));
  return date.toISOString().split('T')[0];
}

module.exports = {
  assignToHub,
  optimizeBatchCollection,
  findNearestHub,
  calculateBatchTransportCost,
  calculateIndividualTransportCost,
};
