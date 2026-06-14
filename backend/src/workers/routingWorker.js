const { determineRoute } = require('../services/routing');
const { store } = require('../db/store');
const { invalidateOnProductChange } = require('../services/cacheInvalidation');

/**
 * Routing Worker — processes routing task messages from SQS.
 * Invokes Bedrock routing model and stores the decision on the product record.
 */

/**
 * Process a single routing task message.
 * @param {object} message - Parsed SQS message body
 * @returns {boolean} - true if processed successfully, false if should retry
 */
async function processMessage(message) {
  const { productId, payload } = message;
  const startTime = Date.now();

  if (!productId) {
    console.error('[RoutingWorker] Message missing productId, discarding');
    return true; // Don't retry malformed messages
  }

  console.log(`[RoutingWorker] Processing routing for product ${productId}`);

  // Check for duplicate — skip if product already has a routing decision
  const product = await store.getProduct(productId);
  if (!product) {
    console.warn(`[RoutingWorker] Product ${productId} not found, discarding`);
    return true;
  }

  if (product.routingDecision) {
    console.log(`[RoutingWorker] Product ${productId} already has routing decision, skipping duplicate`);
    return true;
  }

  // Invoke routing
  const routingDecision = await determineRoute({
    productId,
    conditionScore: payload.conditionScore,
    grade: payload.grade,
    category: payload.category,
    estimatedPrice: payload.estimatedPrice,
    recommendedPrice: payload.estimatedPrice,
    location: payload.location,
    weight: payload.weight || 1,
    dimensions: payload.dimensions || { length: 30, width: 20, height: 15 },
    working: payload.working,
    authenticityScore: payload.authenticityScore,
  });

  // Store routing decision
  product.routingDecision = routingDecision;

  // Check if pricing is also complete — if so, mark as "listed"
  if (product.priceEstimate) {
    product.status = 'listed';

    // Award credits for listing
    try {
      const { awardCredits } = require('../services/credits');
      await awardCredits(product.userId, {
        actionType: 'sell',
        productId,
        metadata: { price: product.priceEstimate.recommendedPrice, destination: routingDecision.destination },
      });
    } catch (err) {
      console.warn(`[RoutingWorker] Credits award failed for ${productId}: ${err.message}`);
    }
  }

  await store.saveProduct(product);

  // Invalidate cache if product is now listed
  if (product.status === 'listed') {
    await invalidateOnProductChange(product);

    // Trigger notification matching
    try {
      const { matchAndNotify } = require('../services/notifications');
      await matchAndNotify(product);
    } catch (err) {
      console.warn(`[RoutingWorker] Notification matching failed: ${err.message}`);
    }
  }

  const duration = Date.now() - startTime;
  console.log(`[RoutingWorker] Completed routing for ${productId} in ${duration}ms (destination: ${routingDecision.destination})`);

  return true;
}

/**
 * Handle processing failure — set product status to routing_failed.
 */
async function handleFailure(message) {
  const { productId } = message;
  if (!productId) return;

  try {
    const product = await store.getProduct(productId);
    if (product && !product.routingDecision) {
      product.status = 'routing_failed';
      await store.saveProduct(product);
      console.error(`[RoutingWorker] Product ${productId} marked as routing_failed after max retries`);
    }
  } catch (err) {
    console.error(`[RoutingWorker] Failed to mark product ${productId} as failed: ${err.message}`);
  }
}

module.exports = {
  processMessage,
  handleFailure,
};
