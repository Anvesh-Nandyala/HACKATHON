const cacheClient = require('../db/redis');

/**
 * Cache Service — high-level caching abstraction.
 * Wraps the DynamoDB-based cache client with application-level logic.
 * All methods degrade gracefully (return null/false) if cache is unavailable.
 */

const DEFAULT_TTL = Math.max(1, Math.min(86400,
  parseInt(process.env.CACHE_DEFAULT_TTL || '300', 10)
));

/**
 * Initialize the cache service. Non-blocking — logs warning on failure.
 */
async function initialize() {
  try {
    await cacheClient.createClient();
    if (cacheClient.isReady()) {
      console.log(`[CacheService] Initialized (default TTL: ${DEFAULT_TTL}s)`);
    } else {
      console.warn('[CacheService] Initialization completed but cache not ready');
    }
  } catch (err) {
    console.warn(`[CacheService] Initialization failed: ${err.message}`);
  }
}

/**
 * Check if the cache is connected and ready.
 */
function isConnected() {
  return cacheClient.isReady();
}

/**
 * Get a cached value by key. Returns parsed object or null.
 */
async function get(key) {
  if (!cacheClient.isReady()) return null;

  try {
    return await cacheClient.get(key);
  } catch (err) {
    console.warn(`[CacheService] GET failed for "${key}": ${err.message}`);
    return null;
  }
}

/**
 * Store a value in cache with specified TTL.
 * @param {string} key - Cache key
 * @param {*} value - Value to cache (will be JSON-serialized)
 * @param {number} [ttlSeconds] - Time-to-live in seconds (default from env)
 */
async function set(key, value, ttlSeconds = DEFAULT_TTL) {
  if (!cacheClient.isReady()) return false;

  const ttl = Math.max(1, Math.min(86400, ttlSeconds));

  try {
    return await cacheClient.set(key, value, ttl);
  } catch (err) {
    console.warn(`[CacheService] SET failed for "${key}": ${err.message}`);
    return false;
  }
}

/**
 * Delete a single cache entry.
 */
async function del(key) {
  if (!cacheClient.isReady()) return false;

  try {
    return await cacheClient.del(key);
  } catch (err) {
    console.warn(`[CacheService] DEL failed for "${key}": ${err.message}`);
    return false;
  }
}

/**
 * Delete all cache entries matching a prefix pattern.
 * Pattern uses glob-style: "marketplace:tdr4:*"
 */
async function delPattern(pattern) {
  if (!cacheClient.isReady()) return false;

  try {
    return await cacheClient.delPattern(pattern);
  } catch (err) {
    console.warn(`[CacheService] DEL_PATTERN failed for "${pattern}": ${err.message}`);
    return false;
  }
}

/**
 * Get remaining TTL for a key in seconds.
 */
async function getTTL(key) {
  if (!cacheClient.isReady()) return -1;

  try {
    return await cacheClient.getTTL(key);
  } catch (err) {
    return -1;
  }
}

/**
 * Get cache health information.
 */
async function getHealth() {
  const connected = cacheClient.isReady();
  let latencyMs = -1;

  if (connected) {
    const start = Date.now();
    try {
      await cacheClient.get('__health_check__');
      latencyMs = Date.now() - start;
    } catch (err) {
      latencyMs = -1;
    }
  }

  return {
    connected,
    latencyMs,
    defaultTTL: DEFAULT_TTL,
    backend: 'dynamodb-ttl',
  };
}

module.exports = {
  initialize,
  isConnected,
  get,
  set,
  del,
  delPattern,
  getTTL,
  getHealth,
};
