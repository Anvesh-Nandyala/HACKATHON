const express = require('express');
const notifications = require('../services/notifications');
const sse = require('../services/sse');

const router = express.Router();

/**
 * GET /api/notifications/stream — SSE connection for notifications
 */
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Prevents Nginx/CloudFront from buffering the SSE stream

  // Send an initial heartbeat
  res.write('data: {"type": "connected"}\n\n');

  // Keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  res.on('close', () => {
    clearInterval(heartbeat);
  });

  sse.addClient(req.user.userId, res);
});

/**
 * POST /api/notifications/subscriptions — Create interest subscription
 */
router.post('/subscriptions', async (req, res, next) => {
  try {
    const { category, priceRange, location, radiusKm } = req.body;
    if (!location || !Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) {
      return res.status(400).json({ error: 'location with latitude and longitude is required' });
    }

    const subscription = await notifications.createSubscription(req.user.userId, {
      category,
      priceRange,
      location: {
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
      },
      radiusKm: Number(radiusKm),
    });
    res.status(201).json(subscription);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/notifications/subscriptions — List user's subscriptions
 */
router.get('/subscriptions', async (req, res, next) => {
  try {
    const subs = await notifications.getSubscriptions(req.user.userId);
    res.json({ subscriptions: subs, count: subs.length });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/notifications/subscriptions/:id — Delete subscription
 */
router.delete('/subscriptions/:id', async (req, res, next) => {
  try {
    await notifications.deleteSubscription(req.user.userId, req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/notifications/mode — Update notification mode (all/personalized)
 */
router.put('/mode', async (req, res, next) => {
  try {
    const { mode } = req.body;
    const result = await notifications.updateNotificationMode(req.user.userId, mode);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/notifications/mode — Get current notification mode
 */
router.get('/mode', async (req, res, next) => {
  try {
    const result = await notifications.getNotificationMode(req.user.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
