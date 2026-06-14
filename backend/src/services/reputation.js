const { store } = require('../db/store');
const cache = require('./cache');

/**
 * Reputation Service — calculates and caches user reputation scores.
 * Formula: 70% avg rating + 20% transaction count + 10% account age
 */

const REPUTATION_CACHE_TTL = 300; // 5 minutes

async function calculateScore(userId) {
  try {
    const reviews = await store.getReviewsForUser(userId, 999);
    const user = await store.getUser(userId);
    const txnCount = await store.getCompletedTransactionCount(userId);

    // No reviews = default score 0
    if (!reviews || reviews.length === 0) {
      const result = { reputationScore: 0, reviewCount: 0, avgRating: 0 };
      await cache.set(`reputation:${userId}`, result, REPUTATION_CACHE_TTL);
      return result;
    }

    // Average rating normalized to 0-100
    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    const ratingComponent = ((avgRating - 1) / 4) * 100 * 0.70;

    // Transaction count normalized (cap at 50)
    const txnComponent = (Math.min(txnCount, 50) / 50) * 100 * 0.20;

    // Account age normalized (cap at 365 days)
    const accountCreatedAt = user?.createdAt ? new Date(user.createdAt) : new Date();
    const ageDays = Math.max(0, (Date.now() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24));
    const ageComponent = (Math.min(ageDays, 365) / 365) * 100 * 0.10;

    const reputationScore = Math.round(ratingComponent + txnComponent + ageComponent);

    const result = {
      reputationScore: Math.max(0, Math.min(100, reputationScore)),
      reviewCount: reviews.length,
      avgRating: Math.round(avgRating * 10) / 10,
    };

    await cache.set(`reputation:${userId}`, result, REPUTATION_CACHE_TTL);
    return result;
  } catch (err) {
    console.error(`[Reputation] Calculation failed for ${userId}: ${err.message}`);
    // Try to return cached value on failure
    const cached = await cache.get(`reputation:${userId}`);
    if (cached) return cached;
    return { reputationScore: 0, reviewCount: 0, avgRating: 0 };
  }
}

async function getScore(userId) {
  // Cache-first
  const cached = await cache.get(`reputation:${userId}`);
  if (cached) return cached;

  // Recompute on miss
  return calculateScore(userId);
}

async function invalidateScore(userId) {
  await cache.del(`reputation:${userId}`);
}

module.exports = { calculateScore, getScore, invalidateScore };
