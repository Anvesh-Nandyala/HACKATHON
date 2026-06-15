const express = require('express');
const crypto = require('crypto');
const ngeohash = require('ngeohash');
const { DiscoveryQuerySchema } = require('../validators/schemas');
const { discoverNearby } = require('../services/marketplace');
const { optimizeBatchCollection } = require('../services/batchCollection');
const { store } = require('../db/store');
const cache = require('../services/cache');
const { getReviewsForUser } = require('../services/reviews');
const reputation = require('../services/reputation');

const router = express.Router();

// ─── Cache TTLs ───
const NEARBY_CACHE_TTL = 60;     // 60 seconds
const STATS_CACHE_TTL = 120;     // 120 seconds
const PRODUCT_CACHE_TTL = 180;   // 180 seconds

/**
 * Build a deterministic cache key for marketplace nearby queries.
 * Pattern: marketplace:{geohash4}:{sha256(filters)}
 */
function buildNearbyCacheKey(query) {
  const geohash4 = ngeohash.encode(query.latitude, query.longitude, 4);
  const filters = JSON.stringify({
    q: query.q,
    radiusKm: query.radiusKm,
    category: query.category,
    priceRange: query.priceRange,
    minCondition: query.minCondition,
    sortBy: query.sortBy,
    limit: query.limit,
    cursor: query.cursor,
  });
  const filtersHash = crypto.createHash('sha256').update(filters).digest('hex').substring(0, 12);
  return `marketplace:${geohash4}:${filtersHash}`;
}

/**
 * GET /api/marketplace/nearby
 * Cached with 60s TTL. Returns x-cache header.
 */
router.get('/nearby', async (req, res, next) => {
  try {
    const query = DiscoveryQuerySchema.parse({
      q: req.query.q || undefined,
      latitude: parseFloat(req.query.latitude),
      longitude: parseFloat(req.query.longitude),
      radiusKm: req.query.radiusKm ? parseFloat(req.query.radiusKm) : undefined,
      category: req.query.category || undefined,
      priceRange: req.query.minPrice && req.query.maxPrice
        ? { min: parseFloat(req.query.minPrice), max: parseFloat(req.query.maxPrice) }
        : undefined,
      minCondition: req.query.minCondition ? parseInt(req.query.minCondition) : undefined,
      sortBy: req.query.sortBy || undefined,
      limit: req.query.limit ? parseInt(req.query.limit) : undefined,
      cursor: req.query.cursor || undefined,
    });

    // Check cache
    const cacheKey = buildNearbyCacheKey(query);
    const cached = await cache.get(cacheKey);

    if (cached) {
      const ttlRemaining = await cache.getTTL(cacheKey);
      res.set('x-cache', 'HIT');
      res.set('x-cache-ttl', String(ttlRemaining));
      res.set('Cache-Control', `public, max-age=30`);
      return res.json(cached);
    }

    // Cache miss — query DynamoDB
    const result = await discoverNearby(query);

    // Store in cache (even empty results)
    await cache.set(cacheKey, result, NEARBY_CACHE_TTL);

    res.set('x-cache', 'MISS');
    res.set('Cache-Control', `public, max-age=30`);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/marketplace/search
 * Full-text search across all products. No geo filter applied.
 */
router.get('/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();
    const category = req.query.category || null;

    if (!q) return res.json({ products: [], totalCount: 0 });

    const all = await store.getAllProducts();

    const results = all
      .filter(p => ['listed', 'verified'].includes(p.status))
      .filter(p => {
        if (category && p.category !== category) return false;
        const hay = `${p.brand || ''} ${p.model || ''} ${p.category || ''} ${p.description || ''}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 50)
      .map(p => ({
        productId: p.productId,
        name: p.brand ? (p.model ? `${p.brand} ${p.model}` : p.brand) : p.category,
        category: p.category,
        brand: p.brand,
        model: p.model,
        condition: p.condition || 'used',
        originalPrice: p.originalPrice,
        recommendedPrice: p.priceEstimate?.recommendedPrice,
        grade: p.verification?.grade,
        conditionScore: p.verification?.conditionScore,
        description: p.description,
        imageKeys: p.mediaKeys?.images?.slice(0, 3),
        location: {
          latitude: p.location?.latitude,
          longitude: p.location?.longitude,
          city: p.location?.city,
        },
        createdAt: p.createdAt,
      }));

    res.json({ products: results, totalCount: results.length });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/marketplace/stats
 * Cached with 120s TTL.
 */
router.get('/stats', async (req, res, next) => {
  try {
    const cacheKey = 'marketplace:stats';
    const cached = await cache.get(cacheKey);

    if (cached) {
      const ttlRemaining = await cache.getTTL(cacheKey);
      res.set('x-cache', 'HIT');
      res.set('x-cache-ttl', String(ttlRemaining));
      res.set('Cache-Control', `public, max-age=30`);
      return res.json(cached);
    }

    const listed = await store.getListedProducts();
    const categories = {};
    listed.forEach(p => {
      categories[p.category] = (categories[p.category] || 0) + 1;
    });

    const result = {
      totalListed: listed.length,
      byCategory: categories,
      avgPrice: listed.length
        ? Math.round(listed.reduce((s, p) => s + (p.priceEstimate?.recommendedPrice || 0), 0) / listed.length)
        : 0,
    };

    await cache.set(cacheKey, result, STATS_CACHE_TTL);

    res.set('x-cache', 'MISS');
    res.set('Cache-Control', `public, max-age=30`);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/marketplace/batch-status
 */
router.get('/batch-status', async (req, res, next) => {
  try {
    const products = (await store.getListedProducts()).filter(p =>
      p.routingDecision?.destination === 'recycle' || p.routingDecision?.destination === 'donate'
    );
    const result = await optimizeBatchCollection(products);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/marketplace/product/:productId
 * Cached with 180s TTL. Public — fetch a single product with reviews.
 */
router.get('/product/:productId', async (req, res, next) => {
  try {
    const productId = req.params.productId;
    const cacheKey = `product:${productId}`;

    // Check cache
    const cached = await cache.get(cacheKey);
    if (cached) {
      const ttlRemaining = await cache.getTTL(cacheKey);
      res.set('x-cache', 'HIT');
      res.set('x-cache-ttl', String(ttlRemaining));
      res.set('Cache-Control', `public, max-age=30`);
      return res.json(cached);
    }

    // Cache miss
    const product = await store.getProduct(productId);

    if (!product || product.status === 'pending_verification') {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Fetch real seller reviews (fallback to empty if service unavailable)
    let reviews = [];
    let avgRating = 0;
    let reviewCount = 0;
    let reputationScore = 50;

    try {
      reviews = await getReviewsForUser(product.userId, { limit: 10 });
      const rep = await reputation.getScore(product.userId);
      avgRating = rep.avgRating || 0;
      reviewCount = rep.reviewCount || 0;
      reputationScore = rep.reputationScore ?? 50;
    } catch (err) {
      console.warn(`[Marketplace] Reviews unavailable for seller ${product.userId}: ${err.message}`);
    }

    const result = {
      productId: product.productId,
      name: product.brand ? (product.model ? `${product.brand} ${product.model}` : product.brand) : product.category,
      category: product.category,
      brand: product.brand,
      model: product.model,
      condition: product.condition || 'used',
      purchaseDate: product.purchaseDate,
      description: product.description,
      originalPrice: product.originalPrice,
      recommendedPrice: product.priceEstimate?.recommendedPrice,
      priceRange: product.priceEstimate?.priceRange,
      estimatedDaysToSell: product.priceEstimate?.estimatedDaysToSell,
      grade: product.verification?.grade,
      conditionScore: product.verification?.conditionScore,
      working: product.verification?.working,
      authenticityScore: product.verification?.authenticityScore,
      damageDetected: product.verification?.damageDetected || [],
      routingDestination: product.routingDecision?.destination,
      location: {
        latitude: product.location?.latitude,
        longitude: product.location?.longitude,
        city: product.location?.city,
      },
      imageKeys: product.mediaKeys?.images || [],
      videoKey: product.mediaKeys?.video,
      sellerId: product.userId,
      status: product.status,
      createdAt: product.createdAt,
      reviews: reviews.map(r => ({
        reviewerId: r.reviewerId,
        rating: r.rating,
        title: r.title,
        text: r.text,
        createdAt: r.createdAt,
      })),
      avgRating,
      reviewCount,
      reputationScore,
    };

    // Cache the full response
    await cache.set(cacheKey, result, PRODUCT_CACHE_TTL);

    res.set('x-cache', 'MISS');
    res.set('Cache-Control', `public, max-age=30`);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
