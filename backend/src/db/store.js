const { putItem, getItem, queryByPK, queryGSI, updateItem, deleteItem } = require('./dynamodb');

/**
 * Data access layer backed by DynamoDB.
 * Single-table design with PK/SK pattern.
 *
 * Entity patterns:
 *   User:        PK=USER#{userId}       SK=PROFILE
 *   User email:  PK=EMAIL#{email}       SK=EMAIL
 *   Product:     PK=PRODUCT#{productId} SK=METADATA
 *   Transaction: PK=TXN#{txnId}         SK=METADATA
 *   Credits:     PK=USER#{userId}       SK=CREDITS
 *   Hub:         PK=HUB#{hubId}         SK=METADATA
 *
 * GSI1: GSI1PK / GSI1SK — geohash-based product lookups
 * GSI2: GSI2PK / GSI2SK — user-based product lookups
 */

const store = {
  // ─── User operations ───

  async saveUser(user) {
    const item = {
      PK: `USER#${user.userId}`,
      SK: 'PROFILE',
      ...user,
      updatedAt: new Date().toISOString(),
    };
    await putItem(item);

    // Also index by email for login lookup
    if (user.email) {
      await putItem({
        PK: `EMAIL#${user.email.toLowerCase()}`,
        SK: 'EMAIL',
        userId: user.userId,
        email: user.email.toLowerCase(),
      });
    }
  },

  async getUser(userId) {
    return getItem(`USER#${userId}`, 'PROFILE');
  },

  async getUserByEmail(email) {
    const record = await getItem(`EMAIL#${email.toLowerCase()}`, 'EMAIL');
    if (!record) return null;
    return getItem(`USER#${record.userId}`, 'PROFILE');
  },

  // ─── Product operations ───

  async saveProduct(product) {
    const geohash4 = product.location?.geohash?.substring(0, 4) || 'xxxx';
    const item = {
      ...product,
      PK: `PRODUCT#${product.productId}`,
      SK: 'METADATA',
      GSI1PK: `GEO#${geohash4}`,
      GSI1SK: `${product.status}#${product.createdAt}`,
      GSI2PK: `USER#${product.userId}`,
      GSI2SK: `PRODUCT#${product.createdAt}`,
      updatedAt: new Date().toISOString(),
    };
    await putItem(item);
  },

  async getProduct(productId) {
    return getItem(`PRODUCT#${productId}`, 'METADATA');
  },

  async getProductsByUser(userId) {
    return queryGSI('GSI2', 'GSI2PK', `USER#${userId}`, 'PRODUCT#');
  },

  async getProductsByGeohash(geohashPrefix, filters = {}) {
    const items = await queryGSI('GSI1', 'GSI1PK', `GEO#${geohashPrefix}`, 'listed#');
    return items.filter(p => {
      if (filters.category && p.category !== filters.category) return false;
      if (filters.minCondition && p.verification?.conditionScore < filters.minCondition) return false;
      if (filters.priceRange) {
        const price = p.priceEstimate?.recommendedPrice || 0;
        if (price < filters.priceRange.min || price > filters.priceRange.max) return false;
      }
      return true;
    });
  },

  async getListedProducts() {
    // For now, scan with filter. In production, use a GSI with status partition.
    const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
    const { docClient, TABLE_NAME } = require('./dynamodb');
    const { Items } = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'SK = :sk AND #s = :status',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':sk': 'METADATA', ':status': 'listed' },
    }));
    return Items || [];
  },

  async getAllProducts() {
    const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
    const { docClient, TABLE_NAME } = require('./dynamodb');
    const { Items } = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'SK = :sk AND begins_with(PK, :pk)',
      ExpressionAttributeValues: { ':sk': 'METADATA', ':pk': 'PRODUCT#' },
    }));
    return Items || [];
  },

  async deleteProduct(productId) {
    await deleteItem(`PRODUCT#${productId}`, 'METADATA');
  },

  // ─── Transaction operations ───

  async saveTransaction(transaction) {
    const item = {
      PK: `TXN#${transaction.transactionId}`,
      SK: 'METADATA',
      GSI2PK: `USER#${transaction.buyerId}`,
      GSI2SK: `TXN#${transaction.createdAt}`,
      ...transaction,
      updatedAt: new Date().toISOString(),
    };
    await putItem(item);
  },

  async getTransaction(transactionId) {
    return getItem(`TXN#${transactionId}`, 'METADATA');
  },

  async getTransactionsForUser(userId) {
    const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
    const { docClient, TABLE_NAME } = require('./dynamodb');
    const { Items } = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME,
    }));
    return (Items || []).filter(item =>
      item.PK?.startsWith('TXN#') &&
      item.SK === 'METADATA' &&
      (item.buyerId === userId || item.sellerId === userId)
    );
  },

  // ─── Credits operations ───

  async getUserCredits(userId) {
    const item = await getItem(`USER#${userId}`, 'CREDITS');
    if (item) return item;

    // Initialize credits for new user
    const defaultCredits = {
      PK: `USER#${userId}`,
      SK: 'CREDITS',
      userId,
      totalCredits: 0,
      lifetimeEarned: 0,
      lifetimeRedeemed: 0,
      tier: 'bronze',
      co2SavedKg: 0,
      wasteDivertedKg: 0,
      actions: [],
    };
    await putItem(defaultCredits);
    return defaultCredits;
  },

  async saveUserCredits(credits) {
    const item = {
      PK: `USER#${credits.userId}`,
      SK: 'CREDITS',
      ...credits,
      updatedAt: new Date().toISOString(),
    };
    await putItem(item);
  },

  // ─── Hub operations ───

  async getHubs() {
    // Return hardcoded hubs (in production these would be in DynamoDB)
    return [
      { hubId: 'hub-001', name: 'Downtown Hub', location: { latitude: 40.7128, longitude: -74.0060 }, minBatchSize: 5, capacity: 100 },
      { hubId: 'hub-002', name: 'Midtown Hub', location: { latitude: 40.7549, longitude: -73.9840 }, minBatchSize: 5, capacity: 80 },
      { hubId: 'hub-003', name: 'Brooklyn Hub', location: { latitude: 40.6782, longitude: -73.9442 }, minBatchSize: 3, capacity: 120 },
      { hubId: 'hub-004', name: 'Queens Hub', location: { latitude: 40.7282, longitude: -73.7949 }, minBatchSize: 4, capacity: 90 },
    ];
  },

  // ─── Event bus (log to console, in production use EventBridge) ───

  emitEvent(event) {
    console.log(`[EVENT] ${event.type}: ${JSON.stringify(event.detail).slice(0, 200)}`);
  },

  // ─── Daily submission tracking ───

  async checkDailyLimit(userId) {
    const today = new Date().toISOString().split('T')[0];
    const item = await getItem(`USER#${userId}`, `DAILY#${today}`);
    return !item || item.count < 10;
  },

  async incrementDailySubmission(userId) {
    const today = new Date().toISOString().split('T')[0];
    const item = await getItem(`USER#${userId}`, `DAILY#${today}`);
    const count = item ? item.count + 1 : 1;
    await putItem({
      PK: `USER#${userId}`,
      SK: `DAILY#${today}`,
      count,
      date: today,
    });
  },

  // ─── Review operations ───

  async saveReview(review) {
    const item = {
      PK: `REVIEW#${review.reviewId}`,
      SK: 'METADATA',
      GSI1PK: `USER#${review.revieweeId}`,
      GSI1SK: `REVIEW#${review.createdAt}`,
      GSI2PK: `TXN#${review.transactionId}`,
      GSI2SK: `REVIEW#${review.reviewerId}`,
      ...review,
    };
    await putItem(item);
  },

  async getReviewsForUser(userId, limit = 10) {
    const items = await queryGSI('GSI1', 'GSI1PK', `USER#${userId}`, 'REVIEW#');
    return items
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  },

  async getReviewsForTransaction(transactionId) {
    return queryGSI('GSI2', 'GSI2PK', `TXN#${transactionId}`, 'REVIEW#');
  },

  async hasUserReviewed(userId, transactionId) {
    const reviews = await queryGSI('GSI2', 'GSI2PK', `TXN#${transactionId}`, `REVIEW#${userId}`);
    return reviews.length > 0;
  },

  // ─── Subscription operations ───

  async saveSubscription(subscription) {
    const ngeohash = require('ngeohash');
    const geohash4 = ngeohash.encode(subscription.location.latitude, subscription.location.longitude, 4);
    const item = {
      PK: `USER#${subscription.userId}`,
      SK: `SUBSCRIPTION#${subscription.subscriptionId}`,
      GSI1PK: `GEO#${geohash4}`,
      GSI1SK: `SUB#${subscription.category}#${subscription.priceRange?.min || 0}`,
      ...subscription,
      geohash4,
    };
    await putItem(item);
  },

  async getSubscriptions(userId) {
    return queryByPK(`USER#${userId}`, 'SUBSCRIPTION#');
  },

  async deleteSubscription(userId, subscriptionId) {
    const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
    const { docClient, TABLE_NAME } = require('./dynamodb');
    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: `SUBSCRIPTION#${subscriptionId}` },
    }));
  },

  async getSubscriptionsByGeohash(geohash4) {
    return queryGSI('GSI1', 'GSI1PK', `GEO#${geohash4}`, 'SUB#');
  },

  // ─── WebSocket connection operations ───

  async saveWebSocketConnection(conn) {
    const item = {
      PK: `WSCONN#${conn.connectionId}`,
      SK: 'METADATA',
      GSI2PK: `USER#${conn.userId}`,
      GSI2SK: `WSCONN#${conn.connectedAt}`,
      ...conn,
    };
    await putItem(item);
  },

  async deleteWebSocketConnection(connectionId) {
    const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
    const { docClient, TABLE_NAME } = require('./dynamodb');
    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `WSCONN#${connectionId}`, SK: 'METADATA' },
    }));
  },

  async getConnectionsByUser(userId) {
    return queryGSI('GSI2', 'GSI2PK', `USER#${userId}`, 'WSCONN#');
  },

  // ─── User reputation helpers ───

  async getCompletedTransactionCount(userId) {
    const txns = await this.getTransactionsForUser(userId);
    return txns.filter(t => t.status === 'completed').length;
  },
};

module.exports = { store };
