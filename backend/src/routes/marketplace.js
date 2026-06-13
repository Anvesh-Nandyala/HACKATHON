const express = require('express');
const { DiscoveryQuerySchema } = require('../validators/schemas');
const { discoverNearby } = require('../services/marketplace');
const { optimizeBatchCollection } = require('../services/batchCollection');
const { store } = require('../db/store');

const router = express.Router();

/**
 * GET /api/marketplace/nearby
 */
router.get('/nearby', async (req, res, next) => {
  try {
    const query = DiscoveryQuerySchema.parse({
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

    const result = await discoverNearby(query);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/marketplace/stats
 */
router.get('/stats', async (req, res, next) => {
  try {
    const listed = await store.getListedProducts();
    const categories = {};
    listed.forEach(p => {
      categories[p.category] = (categories[p.category] || 0) + 1;
    });

    res.json({
      totalListed: listed.length,
      byCategory: categories,
      avgPrice: listed.length
        ? Math.round(listed.reduce((s, p) => s + (p.priceEstimate?.recommendedPrice || 0), 0) / listed.length)
        : 0,
    });
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
 * Public — fetch a single product with reviews for the detail page.
 */
router.get('/product/:productId', async (req, res, next) => {
  try {
    const product = await store.getProduct(req.params.productId);

    if (!product || product.status === 'pending_verification') {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Generate deterministic mock reviews based on productId
    const reviews = generateReviews(product);
    const avgRating = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;

    res.json({
      productId: product.productId,
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
      reviews,
      avgRating: Math.round(avgRating * 10) / 10,
      reviewCount: reviews.length,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Mock review generator (deterministic per product) ───
const REVIEW_TEMPLATES = [
  { name: 'Sarah M.', rating: 5, title: 'Great condition, as described!', text: 'Picked it up locally, exactly as shown in photos. The AI grade was spot on. Saved a ton vs buying new.' },
  { name: 'James K.', rating: 4, title: 'Good value', text: 'Minor wear but works perfectly. Seller was friendly and pickup was quick. Would buy again.' },
  { name: 'Priya R.', rating: 5, title: 'Love buying local & sustainable', text: 'Earned green credits and got a great deal. The condition score gave me confidence before meeting up.' },
  { name: 'Mike T.', rating: 4, title: 'Solid purchase', text: 'Item matched the description. Self-pickup within 3km made it super convenient.' },
  { name: 'Elena V.', rating: 5, title: 'Highly recommend', text: 'Verified condition was accurate. Smooth transaction, no shipping wait. This is the future of shopping.' },
  { name: 'David L.', rating: 3, title: 'Decent, some wear', text: 'A bit more used than I expected but still functional. Fair price for the condition grade.' },
];

function generateReviews(product) {
  // Use productId chars to deterministically pick number and selection of reviews
  const seed = product.productId.charCodeAt(0) + product.productId.charCodeAt(product.productId.length - 1);
  const count = 2 + (seed % 4); // 2-5 reviews
  const reviews = [];
  for (let i = 0; i < count; i++) {
    const template = REVIEW_TEMPLATES[(seed + i) % REVIEW_TEMPLATES.length];
    const daysAgo = ((seed + i * 7) % 60) + 1;
    reviews.push({
      ...template,
      verifiedPurchase: true,
      daysAgo,
    });
  }
  return reviews;
}

module.exports = router;
