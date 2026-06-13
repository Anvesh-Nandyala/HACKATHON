const requestCounts = new Map();

const WINDOW_MS = 1000; // 1 second window
const MAX_REQUESTS = 100; // 100 requests per second per user

/**
 * Simple in-memory rate limiter.
 * In production this would use API Gateway throttling.
 */
function rateLimiter(req, res, next) {
  const key = req.user?.userId || req.ip;
  const now = Date.now();

  if (!requestCounts.has(key)) {
    requestCounts.set(key, { count: 1, windowStart: now });
    return next();
  }

  const record = requestCounts.get(key);

  if (now - record.windowStart > WINDOW_MS) {
    record.count = 1;
    record.windowStart = now;
    return next();
  }

  record.count++;

  if (record.count > MAX_REQUESTS) {
    return res.status(429).json({ error: 'Rate limit exceeded. Max 100 requests per second.' });
  }

  next();
}

module.exports = { rateLimiter };
