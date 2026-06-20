const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { ProductSubmissionSchema } = require('../validators/schemas');
const { store } = require('../db/store');
const { verifyProduct } = require('../services/verification');
const { estimatePrice } = require('../services/pricing');
const { determineRoute } = require('../services/routing');
const { invalidateOnProductChange } = require('../services/cacheInvalidation');
const { resolveProductLocation } = require('../services/geocoding');
const queue = require('../services/queue');

const router = express.Router();

/**
 * POST /api/products/submit
 * Submit a product for verification, pricing, and routing.
 * If SQS queues are enabled, pricing and routing are dispatched asynchronously.
 * Otherwise, falls back to synchronous processing (original behavior).
 */
router.post('/submit', async (req, res, next) => {
  try {
    const data = ProductSubmissionSchema.parse(req.body);
    const userId = req.user.userId;

    const productId = uuidv4();
    const resolvedLocation = await resolveProductLocation({
      location: data.location,
      pickupAddress: data.pickupAddress,
    });

    // Create product record
    const product = {
      productId,
      userId,
      category: data.category,
      brand: data.brand || 'Unknown',
      model: data.model || 'Unknown',
      originalPrice: data.originalPrice,
      ageMonths: data.ageMonths,
      condition: data.condition || 'used',
      purchaseDate: data.purchaseDate,
      status: 'pending_verification',
      mediaKeys: {
        images: data.imageKeys,
        video: data.videoKey,
      },
      location: resolvedLocation,
      pickupAddress: data.pickupAddress || 'Seller pickup address not provided',
      description: data.description,
      createdAt: new Date().toISOString(),
    };

    await store.saveProduct(product);
    await store.incrementDailySubmission(userId);

    // Run verification pipeline (always synchronous — fast, local)
    const verification = await verifyProduct({
      productId,
      userId,
      imageKeys: data.imageKeys,
      videoKey: data.videoKey,
      declaredCategory: data.category,
      declaredBrand: data.brand,
      declaredModel: data.model,
    });

    product.verification = verification;

    if (verification.declaredProductMatch === false) {
      product.status = 'rejected_media_mismatch';
      await store.saveProduct(product);

      const err = new Error(verification.mismatchReason || 'Uploaded photos or video do not match the entered product details.');
      err.statusCode = 400;
      throw err;
    }

    product.status = 'verified';
    await store.saveProduct(product);

    // ─── Async path: dispatch to SQS queues if enabled ───
    if (queue.isEnabled() && process.env.ENABLE_ASYNC_PROCESSING !== 'false') {
      const pricingPayload = {
        category: data.category,
        brand: data.brand || 'Unknown',
        model: data.model || 'Unknown',
        originalPrice: data.originalPrice,
        ageMonths: data.ageMonths,
        conditionScore: verification.conditionScore,
        grade: verification.grade,
        working: verification.working,
        location: resolvedLocation,
      };

      const routingPayload = {
        conditionScore: verification.conditionScore,
        grade: verification.grade,
        category: data.category,
        estimatedPrice: data.originalPrice,
        weight: data.weight || 1,
        dimensions: data.dimensions || { length: 30, width: 20, height: 15 },
        working: verification.working,
        authenticityScore: verification.authenticityScore,
        location: resolvedLocation,
      };

      // Enqueue both tasks
      const [pricingResult, routingResult] = await Promise.all([
        queue.enqueuePricingTask(productId, pricingPayload),
        queue.enqueueRoutingTask(productId, routingPayload),
      ]);

      // If both enqueued successfully, respond with "processing" status
      if (pricingResult && routingResult) {
        product.status = 'processing';
        await store.saveProduct(product);

        return res.status(202).json({
          productId,
          status: 'processing',
          message: 'Product verified. AI pricing and routing are being processed in the background.',
          verification: {
            conditionScore: verification.conditionScore,
            grade: verification.grade,
            working: verification.working,
            confidence: verification.confidence,
            declaredProductMatch: verification.declaredProductMatch,
            detectedCategory: verification.detectedCategory,
            detectedBrand: verification.detectedBrand,
            detectedModel: verification.detectedModel,
            mismatchReason: verification.mismatchReason,
          },
        });
      }

      // If enqueue failed, fall through to synchronous processing
      console.warn(`[Products] Queue dispatch failed, falling back to synchronous processing`);
    }

    // ─── Synchronous path: original behavior (fallback) ───
    const priceEstimate = await estimatePrice({
      productId,
      category: data.category,
      brand: data.brand || 'Unknown',
      model: data.model || 'Unknown',
      originalPrice: data.originalPrice,
      ageMonths: data.ageMonths,
      conditionScore: verification.conditionScore,
      grade: verification.grade,
      working: verification.working,
      location: resolvedLocation,
    });

    product.priceEstimate = priceEstimate;
    await store.saveProduct(product);

    const routingDecision = await determineRoute({
      productId,
      conditionScore: verification.conditionScore,
      grade: verification.grade,
      category: data.category,
      estimatedPrice: priceEstimate.recommendedPrice,
      recommendedPrice: priceEstimate.recommendedPrice,
      priceRange: priceEstimate.priceRange,
      location: resolvedLocation,
      weight: data.weight || 1,
      dimensions: data.dimensions || { length: 30, width: 20, height: 15 },
      working: verification.working,
      authenticityScore: verification.authenticityScore,
    });

    product.routingDecision = routingDecision;
    product.status = 'listed';

    await store.saveProduct(product);
    await invalidateOnProductChange(product);

    // Award Green Credits for listing a product
    const { awardCredits } = require('../services/credits');
    const creditResult = await awardCredits(userId, {
      actionType: 'sell',
      productId,
      metadata: { price: priceEstimate.recommendedPrice, destination: routingDecision.destination },
    });

    res.status(201).json({
      productId,
      status: product.status,
      creditsAwarded: creditResult.awarded,
      verification: {
        conditionScore: verification.conditionScore,
        grade: verification.grade,
        working: verification.working,
        confidence: verification.confidence,
        declaredProductMatch: verification.declaredProductMatch,
        detectedCategory: verification.detectedCategory,
        detectedBrand: verification.detectedBrand,
        detectedModel: verification.detectedModel,
        mismatchReason: verification.mismatchReason,
      },
      pricing: {
        recommendedPrice: priceEstimate.recommendedPrice,
        priceRange: priceEstimate.priceRange,
        estimatedDaysToSell: priceEstimate.estimatedDaysToSell,
      },
      routing: {
        destination: routingDecision.destination,
        recoveryValue: routingDecision.recoveryValue,
        reasoning: routingDecision.reasoning,
        alternatives: routingDecision.alternativeRoutes,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/products/:productId
 */
router.get('/:productId', async (req, res, next) => {
  try {
    const product = await store.getProduct(req.params.productId);

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (product.userId !== req.user.userId && product.status !== 'listed') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(product);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/products
 */
router.get('/', async (req, res, next) => {
  try {
    const products = await store.getProductsByUser(req.user.userId);
    res.json({ products, count: products.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
