const { v4: uuidv4 } = require('uuid');
const ngeohash = require('ngeohash');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { store } = require('../db/store');
const websocket = require('./websocket');
const { haversineDistance } = require('./marketplace');

/**
 * Notification Service — subscription management, matching, and delivery.
 */

const AWS_REGION = process.env.AWS_REGION || 'ap-south-2';
const NOTIFICATION_TOPIC_ARN = process.env.NOTIFICATION_TOPIC_ARN;
const sns = new SNSClient({ region: AWS_REGION });

// ─── Subscription Management ───

async function createSubscription(userId, criteria) {
  // Validate radius
  if (!criteria.radiusKm || criteria.radiusKm < 1 || criteria.radiusKm > 50) {
    const err = new Error('Location radius must be between 1 and 50 kilometers');
    err.statusCode = 400;
    throw err;
  }

  // Validate price range
  if (criteria.priceRange) {
    if (criteria.priceRange.min < 0.01 || criteria.priceRange.max > 999999.99) {
      const err = new Error('Price range must be between 0.01 and 999,999.99');
      err.statusCode = 400;
      throw err;
    }
  }

  // Check max 10 subscriptions
  const existing = await store.getSubscriptions(userId);
  if (existing.length >= 10) {
    const err = new Error('Subscription limit reached (maximum 10)');
    err.statusCode = 400;
    throw err;
  }

  const subscription = {
    subscriptionId: uuidv4(),
    userId,
    category: criteria.category,
    priceRange: criteria.priceRange || null,
    location: criteria.location,
    radiusKm: criteria.radiusKm,
    createdAt: new Date().toISOString(),
  };

  await store.saveSubscription(subscription);
  return subscription;
}

async function deleteSubscription(userId, subscriptionId) {
  const subs = await store.getSubscriptions(userId);
  const found = subs.find(s => s.subscriptionId === subscriptionId);
  if (!found) {
    const err = new Error('Subscription not found');
    err.statusCode = 404;
    throw err;
  }
  await store.deleteSubscription(userId, subscriptionId);
}

async function getSubscriptions(userId) {
  return store.getSubscriptions(userId);
}

// ─── Notification Mode ───

async function updateNotificationMode(userId, mode) {
  if (mode !== 'all' && mode !== 'personalized') {
    const err = new Error('Mode must be "all" or "personalized"');
    err.statusCode = 400;
    throw err;
  }

  const user = await store.getUser(userId);
  if (user) {
    user.notificationMode = mode;
    await store.saveUser(user);
  }
  return { mode };
}

async function getNotificationMode(userId) {
  const user = await store.getUser(userId);
  return { mode: user?.notificationMode || 'all' };
}

// ─── Matching & Delivery ───

async function matchAndNotify(product) {
  if (!product.location?.latitude || !product.location?.longitude) return;

  try {
    const geohash4 = ngeohash.encode(product.location.latitude, product.location.longitude, 4);
    const adjacentHashes = ngeohash.neighbors(geohash4);
    const searchHashes = [geohash4, ...adjacentHashes];

    // Gather all subscriptions in the region
    let allSubs = [];
    for (const hash of searchHashes) {
      const subs = await store.getSubscriptionsByGeohash(hash);
      allSubs.push(...subs);
    }

    if (allSubs.length === 0) return;

    // Deduplicate per user
    const notifiedUsers = new Set();

    for (const sub of allSubs) {
      if (notifiedUsers.has(sub.userId)) continue;
      if (sub.userId === product.userId) continue; // Don't notify the seller

      // Check category match
      if (sub.category && sub.category !== product.category) continue;

      // Check price range
      const price = product.priceEstimate?.recommendedPrice || 0;
      if (sub.priceRange) {
        if (price < sub.priceRange.min || price > sub.priceRange.max) continue;
      }

      // Check distance
      if (sub.location?.latitude && sub.location?.longitude) {
        const distance = haversineDistance(
          sub.location.latitude, sub.location.longitude,
          product.location.latitude, product.location.longitude
        );
        if (distance > sub.radiusKm) continue;
      }

      // Match found — check personalization mode
      const user = await store.getUser(sub.userId);
      const mode = user?.notificationMode || 'all';

      if (mode === 'personalized') {
        try {
          const personalization = require('./personalization');
          if (personalization.isEnabled()) {
            const score = await personalization.scoreRelevance(sub.userId, product);
            if (score <= parseFloat(process.env.PERSONALIZATION_THRESHOLD || '0.7')) {
              continue; // Suppress — not relevant enough
            }
          }
        } catch (err) {
          // Fallback: deliver anyway if personalization fails
          console.warn(`[Notifications] Personalization failed for ${sub.userId}: ${err.message}`);
        }
      }

      // Build notification payload
      const distance = sub.location?.latitude
        ? Math.round(haversineDistance(
            sub.location.latitude, sub.location.longitude,
            product.location.latitude, product.location.longitude
          ) * 10) / 10
        : null;

      const notification = {
        type: 'product_match',
        productId: product.productId,
        category: product.category,
        recommendedPrice: product.priceEstimate?.recommendedPrice,
        distance,
        timestamp: new Date().toISOString(),
      };

      await sendToUser(sub.userId, notification);
      notifiedUsers.add(sub.userId);
    }
  } catch (err) {
    console.error(`[Notifications] matchAndNotify error: ${err.message}`);
  }
}

async function sendToUser(userId, notification) {
  // Try WebSocket first
  if (websocket.isEnabled()) {
    const connections = await websocket.getActiveConnections(userId);
    if (connections.length > 0) {
      for (const conn of connections) {
        const sent = await websocket.sendToConnection(conn.connectionId, notification);
        if (sent) return; // Delivered via at least one connection
      }
    }
  }

  // Fallback to SNS
  if (NOTIFICATION_TOPIC_ARN) {
    try {
      await sns.send(new PublishCommand({
        TopicArn: NOTIFICATION_TOPIC_ARN,
        Message: JSON.stringify(notification),
        MessageAttributes: {
          userId: { DataType: 'String', StringValue: userId },
          type: { DataType: 'String', StringValue: notification.type },
        },
      }));
    } catch (err) {
      console.error(`[Notifications] SNS publish failed for ${userId}: ${err.message}`);
    }
  }
}

module.exports = {
  createSubscription,
  deleteSubscription,
  getSubscriptions,
  updateNotificationMode,
  getNotificationMode,
  matchAndNotify,
  sendToUser,
};
