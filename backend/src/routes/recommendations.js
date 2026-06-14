const express = require('express');
const jwt = require('jsonwebtoken');
const { store } = require('../db/store');

const router = express.Router();

function productName(product) {
  return [product.brand, product.model].filter(Boolean).join(' ') || product.category || 'Product';
}

function getOptionalUserId(req) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return null;
    const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
    return decoded.userId || null;
  } catch (err) {
    return null;
  }
}

function calculateSavingsPercent(originalPrice, recommendedPrice) {
  if (!originalPrice || !recommendedPrice || originalPrice <= recommendedPrice) return 0;
  return Math.round(((originalPrice - recommendedPrice) / originalPrice) * 100);
}

function toRecommendationItem(product) {
  const originalPrice = Number(product.originalPrice || 0);
  const recommendedPrice = Number(product.priceEstimate?.recommendedPrice || originalPrice || 0);

  return {
    productId: product.productId,
    name: productName(product),
    category: product.category,
    brand: product.brand,
    model: product.model,
    recommendedPrice,
    originalPrice,
    savingsPercent: calculateSavingsPercent(originalPrice, recommendedPrice),
    conditionScore: product.verification?.conditionScore,
    grade: product.verification?.grade,
    working: product.verification?.working,
    imageKeys: product.mediaKeys?.images?.slice(0, 1) || [],
    destination: product.routingDecision?.destination,
    certified: true,
    createdAt: product.createdAt,
  };
}

router.get('/rescue', async (req, res, next) => {
  try {
    const listed = await store.getListedProducts();
    const now = Date.now();
    const rescueWindowMs = 48 * 60 * 60 * 1000;

    const items = listed
      .filter(product => {
        const destination = product.routingDecision?.destination;
        if (destination !== 'recycle' && destination !== 'donate') return false;

        const listedAt = new Date(product.createdAt || 0).getTime();
        return Number.isFinite(listedAt) && now - listedAt < rescueWindowMs;
      })
      .map(product => {
        const listedAt = new Date(product.createdAt || 0).getTime();
        const hoursRemaining = Math.max(1, Math.ceil((rescueWindowMs - (now - listedAt)) / (60 * 60 * 1000)));

        return {
          productId: product.productId,
          name: productName(product),
          category: product.category,
          brand: product.brand,
          model: product.model,
          recommendedPrice: product.priceEstimate?.recommendedPrice,
          conditionScore: product.verification?.conditionScore,
          grade: product.verification?.grade,
          imageKeys: product.mediaKeys?.images?.slice(0, 1) || [],
          destination: product.routingDecision?.destination,
          co2SavedKg: product.routingDecision?.co2SavedKg || 2,
          hoursRemaining,
          createdAt: product.createdAt,
        };
      })
      .sort((a, b) => a.hoursRemaining - b.hoursRemaining)
      .slice(0, 5);

    res.json({ items, count: items.length });
  } catch (err) {
    next(err);
  }
});

router.get('/refurbished', async (req, res, next) => {
  try {
    const listed = await store.getListedProducts();
    const userId = getOptionalUserId(req);

    let items = listed
      .filter(product => {
        const destination = product.routingDecision?.destination;
        return destination === 'refurbish' || destination === 'resell' || product.condition === 'refurbished';
      })
      .map(toRecommendationItem);

    if (userId && items.length > 0) {
      try {
        const personalization = require('../services/personalization');
        const userContext = await personalization.getUserContext(userId);
        const userCategories = userContext.purchaseHistory?.categories || [];
        const userAvgPrice = userContext.purchaseHistory?.avgPrice || 0;

        items = await Promise.all(items.map(async item => {
          let relevanceScore = 0.5;
          let relevanceSource = 'heuristic';

          if (personalization.isEnabled()) {
            relevanceScore = await personalization.scoreRelevance(userId, item);
            relevanceSource = 'bedrock';
          } else {
            if (userCategories.includes(item.category)) relevanceScore += 0.3;
            if (userAvgPrice > 0 && item.recommendedPrice <= userAvgPrice * 1.3) relevanceScore += 0.2;
          }

          relevanceScore = Math.max(0, Math.min(1, Number(relevanceScore || 0.5)));
          return {
            ...item,
            relevanceScore,
            relevanceSource,
            aiMatched: relevanceScore >= 0.7,
          };
        }));

        items.sort((a, b) => b.relevanceScore - a.relevanceScore);
      } catch (err) {
        items.sort((a, b) => (b.conditionScore || 0) - (a.conditionScore || 0));
      }
    } else {
      items.sort((a, b) => (b.conditionScore || 0) - (a.conditionScore || 0));
    }

    items = items.slice(0, 8);
    res.json({ items, count: items.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
