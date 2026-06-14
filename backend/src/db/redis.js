const { PutCommand, GetCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./dynamodb');

/**
 * DynamoDB-based cache client (replaces Redis/ElastiCache to stay on free tier).
 * Uses a dedicated cache table with TTL auto-expiry.
 * Provides the same interface as a Redis client: get, set, del, delPattern.
 *
 * Table schema:
 *   PK (String): cache key
 *   value (String): JSON-serialized cached data
 *   ttl (Number): Unix epoch seconds when item expires (DynamoDB TTL attribute)
 */

const CACHE_TABLE = process.env.CACHE_TABLE || 'CircularCommerceCache';
let isReady = false;
let initializationAttempted = false;

/**
 * Ensure the cache table exists. Called on startup.
 * If the table doesn't exist, caching is disabled gracefully.
 */
async function createClient() {
  if (initializationAttempted) return;
  initializationAttempted = true;

  try {
    const { DynamoDBClient, DescribeTableCommand, CreateTableCommand, UpdateTimeToLiveCommand } = require('@aws-sdk/client-dynamodb');
    const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-2' });

    try {
      await client.send(new DescribeTableCommand({ TableName: CACHE_TABLE }));
      console.log(`[Cache] Table "${CACHE_TABLE}" exists`);
    } catch (err) {
      if (err.name === 'ResourceNotFoundException') {
        console.log(`[Cache] Creating table "${CACHE_TABLE}"...`);
        await client.send(new CreateTableCommand({
          TableName: CACHE_TABLE,
          KeySchema: [
            { AttributeName: 'cacheKey', KeyType: 'HASH' },
          ],
          AttributeDefinitions: [
            { AttributeName: 'cacheKey', AttributeType: 'S' },
          ],
          BillingMode: 'PAY_PER_REQUEST',
        }));

        // Wait briefly for table to become active
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Enable TTL
        await client.send(new UpdateTimeToLiveCommand({
          TableName: CACHE_TABLE,
          TimeToLiveSpecification: {
            Enabled: true,
            AttributeName: 'ttl',
          },
        }));

        console.log(`[Cache] Table "${CACHE_TABLE}" created with TTL enabled`);
      } else {
        throw err;
      }
    }

    isReady = true;
  } catch (err) {
    console.warn(`[Cache] Initialization failed: ${err.message}. Caching disabled.`);
    isReady = false;
  }
}

/**
 * Get a cached value by key. Returns parsed JSON or null.
 */
async function get(key) {
  if (!isReady) return null;

  try {
    const { Item } = await docClient.send(new GetCommand({
      TableName: CACHE_TABLE,
      Key: { cacheKey: key },
    }));

    if (!Item) return null;

    // Check if expired (DynamoDB TTL deletion is async, can take up to 48h)
    const now = Math.floor(Date.now() / 1000);
    if (Item.ttl && Item.ttl < now) return null;

    return JSON.parse(Item.value);
  } catch (err) {
    console.warn(`[Cache] GET error for key "${key}": ${err.message}`);
    return null;
  }
}

/**
 * Set a cached value with TTL in seconds.
 */
async function set(key, value, ttlSeconds) {
  if (!isReady) return false;

  try {
    const ttl = Math.floor(Date.now() / 1000) + ttlSeconds;
    await docClient.send(new PutCommand({
      TableName: CACHE_TABLE,
      Item: {
        cacheKey: key,
        value: JSON.stringify(value),
        ttl,
        createdAt: new Date().toISOString(),
      },
    }));
    return true;
  } catch (err) {
    console.warn(`[Cache] SET error for key "${key}": ${err.message}`);
    return false;
  }
}

/**
 * Delete a single cached key.
 */
async function del(key) {
  if (!isReady) return false;

  try {
    await docClient.send(new DeleteCommand({
      TableName: CACHE_TABLE,
      Key: { cacheKey: key },
    }));
    return true;
  } catch (err) {
    console.warn(`[Cache] DEL error for key "${key}": ${err.message}`);
    return false;
  }
}

/**
 * Delete all keys matching a prefix pattern.
 * Pattern format: "marketplace:tdr4:*" → deletes all keys starting with "marketplace:tdr4:"
 */
async function delPattern(pattern) {
  if (!isReady) return false;

  try {
    const prefix = pattern.replace(/\*$/, '');
    const { Items } = await docClient.send(new ScanCommand({
      TableName: CACHE_TABLE,
      FilterExpression: 'begins_with(cacheKey, :prefix)',
      ExpressionAttributeValues: { ':prefix': prefix },
      ProjectionExpression: 'cacheKey',
    }));

    if (!Items || Items.length === 0) return true;

    // Delete matching items (batch, max 25 per request for free tier efficiency)
    const { BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
    const batches = [];
    for (let i = 0; i < Items.length; i += 25) {
      const batch = Items.slice(i, i + 25).map(item => ({
        DeleteRequest: { Key: { cacheKey: item.cacheKey } },
      }));
      batches.push(batch);
    }

    for (const batch of batches) {
      await docClient.send(new BatchWriteCommand({
        RequestItems: { [CACHE_TABLE]: batch },
      }));
    }

    return true;
  } catch (err) {
    console.warn(`[Cache] DEL_PATTERN error for "${pattern}": ${err.message}`);
    return false;
  }
}

/**
 * Get remaining TTL for a key in seconds. Returns -1 if not found.
 */
async function getTTL(key) {
  if (!isReady) return -1;

  try {
    const { Item } = await docClient.send(new GetCommand({
      TableName: CACHE_TABLE,
      Key: { cacheKey: key },
      ProjectionExpression: '#t',
      ExpressionAttributeNames: { '#t': 'ttl' },
    }));

    if (!Item || !Item.ttl) return -1;

    const remaining = Item.ttl - Math.floor(Date.now() / 1000);
    return remaining > 0 ? remaining : -1;
  } catch (err) {
    return -1;
  }
}

/**
 * Check if the cache is ready.
 */
function getIsReady() {
  return isReady;
}

module.exports = {
  createClient,
  get,
  set,
  del,
  delPattern,
  getTTL,
  getClient: () => (isReady ? docClient : null),
  isReady: getIsReady,
};
