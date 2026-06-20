const { estimatePrice } = require('../services/pricing');
const { store } = require('../db/store');
const { updateItem } = require('../db/dynamodb');
const { invalidateOnProductChange } = require('../services/cacheInvalidation');

/**
 * Pricing Worker — processes pricing task messages from SQS.
 * Invokes Bedrock pricing model and stores the estimate on the product record.
 */

/**
 * Process a single pricing task message.
 * @param {object} message - Parsed SQS message body
 * @returns {boolean} - true if processed successfully, false if should retry
 */
async function processMessage(message) {
  const { productId, payload } = message;
  const startTime = Date.now();

  if (!productId) {
    console.error('[PricingWorker] Message missing productId, discarding');
    return true;
  }

  console.log(`[PricingWorker] Processing pricing for product ${productId}`);

  // Check for duplicate — skip if product already has a price estimate
  const product = await store.getProduct(productId);
  if (!product) {
    console.warn(`[PricingWorker] Product ${productId} not found, discarding`);
    return true;
  }

  if (product.priceEstimate) {
    console.log(`[PricingWorker] Product ${productId} already has price estimate, skipping duplicate`);
    return true;
  }

  // Invoke pricing
  const priceEstimate = await estimatePrice({
    productId,
    category: payload.category,
    brand: payload.brand,
    model: payload.model,
    originalPrice: payload.originalPrice,
    ageMonths: payload.ageMonths,
    conditionScore: payload.conditionScore,
    grade: payload.grade,
    working: payload.working,
    location: payload.location,
  });

  await updateItem(`PRODUCT#${productId}`, 'METADATA', { priceEstimate });

  const latestProduct = await store.getProduct(productId);
  if (!latestProduct) {
    console.warn(`[PricingWorker] Product ${productId} disappeared before save, discarding`);
    return true;
  }

  // Check if routing is also complete — if so, mark as "listed"
  if (latestProduct.routingDecision) {
    await updateItem(`PRODUCT#${productId}`, 'METADATA', { status: 'listed' });
    latestProduct.status = 'listed';

    // Award credits for listing
    try {
      const { awardCredits } = require('../services/credits');
      await awardCredits(latestProduct.userId, {
        actionType: 'sell',
        productId,
        metadata: { price: priceEstimate.recommendedPrice, destination: latestProduct.routingDecision.destination },
      });
    } catch (err) {
      console.warn(`[PricingWorker] Credits award failed for ${productId}: ${err.message}`);
    }
  }

  // Invalidate cache if product is now listed
  if (latestProduct.status === 'listed') {
    await invalidateOnProductChange(latestProduct);

    // Trigger notification matching
    try {
      const { matchAndNotify } = require('../services/notifications');
      await matchAndNotify(latestProduct);
    } catch (err) {
      console.warn(`[PricingWorker] Notification matching failed: ${err.message}`);
    }
  }

  const duration = Date.now() - startTime;
  console.log(`[PricingWorker] Completed pricing for ${productId} in ${duration}ms (price: ${priceEstimate.recommendedPrice})`);

  return true;
}

/**
 * Handle processing failure — apply local fallback pricing.
 */
async function handleFailure(message) {
  const { productId, payload } = message;
  if (!productId) return;

  try {
    const product = await store.getProduct(productId);
    if (product && !product.priceEstimate) {
      // Apply local fallback pricing
      const originalPrice = Number(payload?.originalPrice || 1);
      const conditionScore = Number(payload?.conditionScore || 75);
      const ageMonths = Number(payload?.ageMonths || 0);
      const ageMultiplier = Math.max(0.35, 1 - ageMonths * 0.015);
      const conditionMultiplier = Math.max(0.35, conditionScore / 100);
      const recommendedPrice = Math.max(1, Math.round(originalPrice * ageMultiplier * conditionMultiplier));

      product.priceEstimate = {
        productId,
        recommendedPrice,
        priceRange: {
          min: Math.max(1, Math.round(recommendedPrice * 0.85)),
          max: Math.max(1, Math.round(recommendedPrice * 1.15)),
        },
        confidence: 0.5,
        factors: [{ name: 'fallback', impact: 1, description: 'Local fallback after queue failure' }],
        estimatedDaysToSell: 7,
        fallback: true,
      };

      product.status = product.routingDecision ? 'listed' : 'partially_processed';
      await store.saveProduct(product);

      if (product.status === 'listed') {
        await invalidateOnProductChange(product);
      }

      console.warn(`[PricingWorker] Applied fallback pricing for ${productId} after max retries`);
    }
  } catch (err) {
    console.error(`[PricingWorker] Failed to apply fallback for ${productId}: ${err.message}`);
  }
}

module.exports = {
  processMessage,
  handleFailure,
};
