/**
 * Client-side cache manager using localStorage.
 * Stores API responses with expiration timestamps for stale-while-revalidate pattern.
 * Max 50 marketplace products cached.
 */

const MAX_MARKETPLACE_ITEMS = 50;

export function cacheResponse(key, data, maxAgeMs = 60000) {
  try {
    const entry = {
      data,
      cachedAt: Date.now(),
      expiresAt: Date.now() + maxAgeMs,
    };
    localStorage.setItem(`cache:${key}`, JSON.stringify(entry));
  } catch (e) {
    // Storage full — clear old entries
    clearOldEntries();
    try {
      const entry = { data, cachedAt: Date.now(), expiresAt: Date.now() + maxAgeMs };
      localStorage.setItem(`cache:${key}`, JSON.stringify(entry));
    } catch (e2) { /* give up */ }
  }
}

export function getCached(key) {
  try {
    const raw = localStorage.getItem(`cache:${key}`);
    if (!raw) return null;

    const entry = JSON.parse(raw);
    const now = Date.now();
    const isStale = now > entry.expiresAt;

    return {
      data: entry.data,
      cachedAt: entry.cachedAt,
      isStale,
      ageMs: now - entry.cachedAt,
    };
  } catch (e) {
    return null;
  }
}

export function clearCache(pattern) {
  try {
    const prefix = `cache:${pattern.replace('*', '')}`;
    const keysToDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(k => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}

function clearOldEntries() {
  try {
    const now = Date.now();
    const keysToDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('cache:')) {
        try {
          const entry = JSON.parse(localStorage.getItem(key));
          // Remove entries older than 10 minutes
          if (now - entry.cachedAt > 600000) {
            keysToDelete.push(key);
          }
        } catch (e) {
          keysToDelete.push(key);
        }
      }
    }
    keysToDelete.forEach(k => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}

export function getCacheStats() {
  let count = 0;
  let totalSize = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('cache:')) {
      count++;
      totalSize += (localStorage.getItem(key) || '').length;
    }
  }
  return { count, totalSizeBytes: totalSize * 2 }; // UTF-16
}
