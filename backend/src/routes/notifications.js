const express = require('express');
const notifications = require('../services/notifications');

const router = express.Router();

/**
 * POST /api/notifications/subscriptions — Create interest subscription
 */
router.post('/subscriptions', async (req, res, next) => {
  try {
    const { category, priceRange, location, radiusKm } = req.body;
    if (!location || !location.latitude || !location.longitude) {
      return res.status(400).json({ error: 'location with latitude and longitude is required' });
    }

    const subscription = await notifications.createSubscription(req.user.userId, {
      category, priceRange, location, radiusKm,
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
