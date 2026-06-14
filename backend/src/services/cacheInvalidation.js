const ngeohash = require('ngeohash');
const cache = require('./cache');

/**
 * Cache invalidation helpers.
 * Called after product writes (create, update, reserve, list) to ensure
 * stale data is never served from cache.
 */

/**
 * Invalidate all cache entries related to a product's location.
 * Clears marketplace nearby queries for the product's geohash and all adjacent geohashes.
 * Also clears marketplace stats.
 */
async function invalidateMarketplaceCache(product) {
  if (!cache.isConnected()) return;

  try {
    const geohash4 = product.location?.geohash?.substring(0, 4)
      || (product.location?.latitude && product.location?.longitude
        ? ngeohash.encode(product.location.latitude, product.location.longitude, 4)
        : null);

    if (geohash4) {
      // Invalidate the primary geohash and all 8 adjacent ones
      const adjacentHashes = ngeohash.neighbors(geohash4);
      const allHashes = [geohash4, ...adjacentHashes];

      const deletions = allHashes.map(hash => cache.delPattern(`marketplace:${hash}:*`));
      await Promise.all(deletions);
    }

    // Always invalidate stats
    await cache.del('marketplace:stats');
  } catch (err) {
    console.warn(`[CacheInvalidation] marketplace invalidation error: ${err.message}`);
  }
}

/**
 * Invalidate the cached product detail for a specific product.
 */
async function invalidateProductCache(productId) {
  if (!cache.isConnected()) return;

  try {
    await cache.del(`product:${productId}`);
  } catch (err) {
    console.warn(`[CacheInvalidation] product invalidation error: ${err.message}`);
  }
}

/**
 * Full invalidation for a product change (both product detail and marketplace queries).
 * Call this after any product status change, price update, or reservation.
 */
async function invalidateOnProductChange(product) {
  await Promise.all([
    invalidateProductCache(product.productId),
    invalidateMarketplaceCache(product),
  ]);
}

module.exports = {
  invalidateMarketplaceCache,
  invalidateProductCache,
  invalidateOnProductChange,
};
