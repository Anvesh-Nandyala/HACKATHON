# Technical Design Document

## Overview

This document describes the technical design for adding backend scaling infrastructure to the Circular Commerce Platform. The design covers four subsystems: a Redis caching layer (Amazon ElastiCache), message queues (AWS SQS) for background AI processing, real-time notifications (WebSocket + SNS), and a user reputation/review system. All components integrate into the existing Node.js/Express monolith running on Elastic Beanstalk with DynamoDB as the primary data store.

## Architecture

### System Context Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AWS Cloud (ap-south-2)                             │
│                                                                             │
│  ┌──────────────┐     ┌──────────────────┐     ┌────────────────────┐      │
│  │   Frontend   │     │   CloudFront     │     │  Amazon ElastiCache│      │
│  │  (S3 origin) │────▶│  Distribution    │     │  (Redis 7.x)       │      │
│  └──────────────┘     └────────┬─────────┘     └────────────────────┘      │
│                                │                                            │
│              ┌─────────────────┼─────────────────┐                          │
│              │ /static (S3)    │ /api/* (ALB)     │ WebSocket (APIGW)       │
│              ▼                 ▼                  ▼                          │
│  ┌──────────────┐     ┌──────────────────┐     ┌────────────────────┐      │
│  │   S3 Bucket  │     │  Elastic Beanstalk│     │  API Gateway       │      │
│  │  (Frontend)  │     │  ALB → Express    │     │  (WebSocket)       │      │
│  └──────────────┘     └────────┬─────────┘     └────────────────────┘      │
│                                │                                            │
│                                ▼                                            │
│                       ┌──────────────────┐     ┌────────────────────┐      │
│                       │    DynamoDB       │     │    AWS Bedrock     │      │
│                       │  (Single Table)   │     │  (Claude Haiku)    │      │
│                       └──────────────────┘     └────────────────────┘      │
│                                                                             │
│  ┌──────────────┐     ┌──────────────────┐     ┌────────────────────┐      │
│  │  SQS Routing │     │  SQS Pricing     │     │     Amazon SNS     │      │
│  │    Queue      │     │    Queue          │     │  (Notifications)   │      │
│  └──────┬───────┘     └───────┬──────────┘     └────────────────────┘      │
│         │                      │                                            │
│         ▼                      ▼                                            │
│  ┌──────────────────────────────────────┐                                   │
│  │         Background Worker            │                                   │
│  │   (Separate EB environment or ECS)   │                                   │
│  └──────────────────────────────────────┘                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Architecture

```
backend/src/
├── db/
│   ├── dynamodb.js          (existing - unchanged)
│   ├── store.js             (existing - add review/subscription operations)
│   └── redis.js             (NEW - Cache_Service client)
├── middleware/
│   ├── auth.js              (existing - unchanged)
│   ├── errorHandler.js      (existing - unchanged)
│   └── rateLimiter.js       (existing - unchanged)
├── routes/
│   ├── auth.js              (existing - unchanged)
│   ├── credits.js           (existing - unchanged)
│   ├── marketplace.js       (existing - modify for cache + real reviews)
│   ├── notifications.js     (NEW - subscription CRUD endpoints)
│   ├── products.js          (existing - modify for async queue dispatch)
│   ├── reviews.js           (NEW - review submission endpoints)
│   ├── health.js            (NEW - extended health with cache/queue status)
│   ├── transactions.js      (existing - unchanged)
│   └── uploads.js           (existing - unchanged)
├── services/
│   ├── cache.js             (NEW - cache abstraction with invalidation)
│   ├── notifications.js     (NEW - notification matching + delivery)
│   ├── personalization.js   (NEW - Bedrock AI relevance scoring)
│   ├── pricing.js           (existing - unchanged, called by worker)
│   ├── queue.js             (NEW - SQS send/receive abstraction)
│   ├── reputation.js        (NEW - score calculation)
│   ├── reviews.js           (NEW - review CRUD + validation)
│   ├── routing.js           (existing - unchanged, called by worker)
│   └── websocket.js         (NEW - WebSocket connection registry)
├── workers/
│   ├── index.js             (NEW - worker entry point)
│   ├── routingWorker.js     (NEW - SQS consumer for routing)
│   └── pricingWorker.js     (NEW - SQS consumer for pricing)
├── server.js                (existing - modify for Redis init + new routes)
└── worker.js                (NEW - standalone worker process entry)
```

## Data Models

### DynamoDB Entity Additions (Single-Table Design)

```
Review Entity:
  PK: REVIEW#{reviewId}
  SK: METADATA
  GSI1PK: USER#{revieweeId}       (query reviews FOR a user)
  GSI1SK: REVIEW#{timestamp}
  GSI2PK: TXN#{transactionId}     (query reviews for a transaction)
  GSI2SK: REVIEW#{reviewerId}
  Fields: reviewId, reviewerId, revieweeId, transactionId, productId,
          rating (1-5), title, text, createdAt

Interest Subscription Entity:
  PK: USER#{userId}
  SK: SUBSCRIPTION#{subscriptionId}
  GSI1PK: GEO#{geohash4}          (match subscriptions by location)
  GSI1SK: SUB#{category}#{priceMin}
  Fields: subscriptionId, userId, category, priceRange {min, max},
          location {latitude, longitude, geohash}, radiusKm, createdAt

User Profile Extension:
  PK: USER#{userId}
  SK: PROFILE
  Additional fields: reputationScore, reviewCount, avgRating, accountCreatedAt

WebSocket Connection Entity (in-memory or DynamoDB for multi-instance):
  PK: WSCONN#{connectionId}
  SK: METADATA
  GSI2PK: USER#{userId}
  GSI2SK: WSCONN#{connectedAt}
  Fields: connectionId, userId, connectedAt, lastPingAt
```

### Redis Key Patterns

```
marketplace:{geohash4}:{sha256(filters)}  → JSON (TTL: 60s)
marketplace:stats                          → JSON (TTL: 120s)
product:{productId}                        → JSON (TTL: 180s)
reputation:{userId}                        → JSON (TTL: 300s)
ws:connections:{userId}                    → SET of connectionIds (TTL: 700s)
queue:metrics:routing                      → HASH {processed, avgMs, lastProcessedAt}
queue:metrics:pricing                      → HASH {processed, avgMs, lastProcessedAt}
```

### SQS Message Schemas

```json
// Routing Queue Message
{
  "type": "ROUTE_PRODUCT",
  "productId": "uuid",
  "payload": {
    "conditionScore": 85,
    "grade": "A",
    "category": "electronics",
    "estimatedPrice": 450,
    "location": { "latitude": 40.71, "longitude": -74.0 },
    "working": true
  },
  "metadata": {
    "enqueuedAt": "ISO8601",
    "attempt": 1
  }
}

// Pricing Queue Message
{
  "type": "PRICE_PRODUCT",
  "productId": "uuid",
  "payload": {
    "category": "electronics",
    "brand": "Apple",
    "model": "iPhone 13",
    "originalPrice": 999,
    "ageMonths": 18,
    "conditionScore": 85,
    "grade": "A",
    "working": true,
    "location": { "latitude": 40.71, "longitude": -74.0 }
  },
  "metadata": {
    "enqueuedAt": "ISO8601",
    "attempt": 1
  }
}
```

## Components and Interfaces

### Cache_Service (src/services/cache.js)
- **Interface**: `initialize()`, `isConnected()`, `get(key)`, `set(key, value, ttlSeconds)`, `del(key)`, `delPattern(pattern)`, `getHealth()`
- **Dependencies**: ioredis, REDIS_ENDPOINT env var
- **Consumers**: marketplace routes, product routes, reputation service

### Queue_Service (src/services/queue.js)
- **Interface**: `enqueueRoutingTask(productId, payload)`, `enqueuePricingTask(productId, payload)`, `getQueueHealth()`, `isEnabled()`
- **Dependencies**: @aws-sdk/client-sqs, ROUTING_QUEUE_URL, PRICING_QUEUE_URL env vars
- **Consumers**: product submission route, health endpoint

### Notification_Service (src/services/notifications.js)
- **Interface**: `matchAndNotify(product)`, `sendToUser(userId, notification)`, `createSubscription(userId, criteria)`, `deleteSubscription(userId, subId)`, `getSubscriptions(userId)`, `updateNotificationMode(userId, mode)`
- **Dependencies**: DynamoDB (subscriptions), WebSocket service, SNS client, Personalization_Service
- **Consumers**: worker (on product listed), notification routes

### Personalization_Service (src/services/personalization.js)
- **Interface**: `scoreRelevance(userId, product)`, `getUserContext(userId)`, `isEnabled()`
- **Dependencies**: @aws-sdk/client-bedrock-runtime, DynamoDB (user transactions, subscriptions), PERSONALIZATION_THRESHOLD env var
- **Consumers**: Notification_Service (when user mode is "personalized")

### WebSocket_Service (src/services/websocket.js)
- **Interface**: `registerConnection(userId, connectionId)`, `deregisterConnection(connectionId)`, `getActiveConnections(userId)`, `sendToConnection(connectionId, payload)`, `isConnected(userId)`
- **Dependencies**: @aws-sdk/client-apigatewaymanagementapi, Redis (connection registry), API Gateway WebSocket endpoint
- **Consumers**: Notification_Service, API Gateway Lambda handlers

### Review_Service (src/services/reviews.js)
- **Interface**: `submitReview(reviewerId, transactionId, { rating, title, text })`, `getReviewsForUser(userId, { limit, cursor })`, `getReviewsForTransaction(transactionId)`, `hasUserReviewed(userId, transactionId)`
- **Dependencies**: DynamoDB (review entities), Reputation_Service
- **Consumers**: review routes, marketplace product detail route

### Reputation_Service (src/services/reputation.js)
- **Interface**: `calculateScore(userId)`, `getScore(userId)`, `invalidateScore(userId)`
- **Dependencies**: DynamoDB (reviews, user profile, transactions), Cache_Service
- **Consumers**: Review_Service (on submit), marketplace product detail route

### Workers (src/workers/)
- **Interface**: `routingWorker.processMessage(message)`, `pricingWorker.processMessage(message)`
- **Dependencies**: SQS (receive/delete), routing.js, pricing.js, store.js, Notification_Service
- **Consumers**: SQS queue event source (polling loop in worker.js)

## Detailed Component Design

### 1. Cache Service (`src/services/cache.js`)

```javascript
// Public Interface
module.exports = {
  initialize(),           // Connect to ElastiCache, setup event handlers
  isConnected(),          // Boolean health check
  get(key),              // Returns parsed JSON or null
  set(key, value, ttlSeconds),  // Serialize and store
  del(key),              // Delete single key
  delPattern(pattern),   // Delete keys matching glob pattern
  getHealth(),           // Connection status + latency
};
```

Implementation notes:
- Uses `ioredis` npm package (production-grade Redis client with built-in reconnection)
- Connection config from `REDIS_ENDPOINT` env var (format: `redis://host:6379`)
- Graceful degradation: all methods return null/false on connection failure (never throw)
- Exponential backoff reconnection built into ioredis `retryStrategy`

### 2. Redis Client (`src/db/redis.js`)

```javascript
// Low-level Redis connection singleton
const Redis = require('ioredis');

let client = null;
let isReady = false;

function createClient() {
  const endpoint = process.env.REDIS_ENDPOINT;
  if (!endpoint) {
    console.warn('[Redis] REDIS_ENDPOINT not set, caching disabled');
    return null;
  }

  client = new Redis(endpoint, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 1000, 30000);
      return delay;
    },
    connectTimeout: 5000,
    lazyConnect: false,
  });

  client.on('ready', () => { isReady = true; });
  client.on('error', (err) => { console.error('[Redis] Error:', err.message); });
  client.on('close', () => { isReady = false; });

  return client;
}

module.exports = { getClient: () => client, createClient, isReady: () => isReady };
```

### 3. Queue Service (`src/services/queue.js`)

```javascript
const { SQSClient, SendMessageCommand, ReceiveMessageCommand,
        DeleteMessageCommand, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');

// Public Interface
module.exports = {
  enqueueRoutingTask(productId, payload),    // Send to routing queue
  enqueuePricingTask(productId, payload),    // Send to pricing queue
  getQueueHealth(),                          // Approximate message counts
  isEnabled(),                               // Whether queue URLs are configured
};
```

Implementation notes:
- Uses `@aws-sdk/client-sqs` (already in the AWS SDK ecosystem)
- Queue URLs from `ROUTING_QUEUE_URL` and `PRICING_QUEUE_URL` env vars
- Messages include `MessageGroupId` = productId for FIFO dedup (if FIFO queues)
- Standard queues with `MessageDeduplicationId` based on productId + timestamp
- Falls back to synchronous processing if SQS is unavailable

### 4. Background Workers (`src/workers/`)

```javascript
// src/worker.js - Standalone entry point
// Runs as separate process (EB worker tier or ECS task)
// Polls both routing and pricing queues concurrently

// src/workers/routingWorker.js
module.exports = {
  async processMessage(message) {
    // 1. Parse message body
    // 2. Check for duplicate (product already has routing decision)
    // 3. Call determineRoute() from existing routing.js
    // 4. Store result on product record
    // 5. Check if pricing is also complete → update status to 'listed'
    // 6. If listed, trigger notification matching
  }
};

// src/workers/pricingWorker.js
module.exports = {
  async processMessage(message) {
    // 1. Parse message body
    // 2. Call estimatePrice() from existing pricing.js
    // 3. Store result on product record
    // 4. Check if routing is also complete → update status to 'listed'
    // 5. If listed, trigger notification matching
  }
};
```

Worker deployment options:
- **Option A (recommended for EB)**: Elastic Beanstalk Worker Environment with SQS daemon
- **Option B**: ECS Fargate task running `node src/worker.js`
- **Option C**: Lambda functions triggered by SQS (cold start concern for Bedrock calls)

### 5. Notification Service (`src/services/notifications.js`)

```javascript
// Public Interface
module.exports = {
  async matchAndNotify(product),              // Called when product becomes 'listed'
  async sendToUser(userId, notification),     // Route via WebSocket or SNS
  async createSubscription(userId, criteria), // Persist interest subscription
  async deleteSubscription(userId, subId),    // Remove subscription
  async getSubscriptions(userId),             // List user's subscriptions
};
```

Matching algorithm:
1. Compute product's 4-char geohash prefix + 8 adjacent prefixes
2. Query DynamoDB GSI1 for subscriptions in those geohash regions
3. For each subscription, check: category match, price in range, haversine distance ≤ radius
4. Deduplicate per user (one notification per product per user)
5. Check user's notification mode:
   - If "all": deliver notification directly
   - If "personalized": invoke Personalization_Service to score relevance; deliver only if score > threshold
6. Deliver via WebSocket if connected, else publish to SNS

### 6. WebSocket Service (`src/services/websocket.js`)

```javascript
// Public Interface
module.exports = {
  registerConnection(userId, connectionId),
  deregisterConnection(connectionId),
  getActiveConnections(userId),              // Returns array of connectionIds
  sendToConnection(connectionId, payload),   // Post to API Gateway Management API
  isConnected(userId),                       // Quick check via Redis SET
};
```

Implementation notes:
- Uses API Gateway WebSocket APIs with `@aws-sdk/client-apigatewaymanagementapi`
- Connection registry stored in Redis SET `ws:connections:{userId}`
- Backup registry in DynamoDB for multi-instance consistency
- API Gateway handles TLS, auth (via Lambda authorizer reusing JWT logic), and scaling

### 7. Personalization Service (`src/services/personalization.js`)

```javascript
// Public Interface
module.exports = {
  async scoreRelevance(userId, product),     // Returns 0.0–1.0 relevance score
  async getUserContext(userId),              // Gathers user history for Bedrock prompt
  isEnabled(),                               // Whether personalization is configured
};
```

Implementation notes:
- Uses existing Bedrock client (`@aws-sdk/client-bedrock-runtime` already in deps)
- Gathers user context: completed transactions (categories, brands, price ranges), active subscriptions, recently viewed categories
- Sends structured prompt to Bedrock asking for a relevance score (0.0–1.0) with brief reasoning
- Configurable threshold via `PERSONALIZATION_THRESHOLD` env var (default 0.7)
- 5-second timeout on Bedrock call; falls back to "deliver anyway" on failure
- Uses same Bedrock model as routing/pricing (configurable via `PERSONALIZATION_BEDROCK_MODEL_ID`)

### 8. Review Service (`src/services/reviews.js`)

```javascript
// Public Interface
module.exports = {
  async submitReview(reviewerId, transactionId, { rating, title, text }),
  async getReviewsForUser(userId, { limit, cursor }),
  async getReviewsForTransaction(transactionId),
  async hasUserReviewed(userId, transactionId),
};
```

Validation flow:
1. Verify transaction exists and status = 'completed'
2. Verify reviewer is buyer or seller on that transaction
3. Verify no existing review by this user for this transaction (GSI2 query)
4. Verify within 30-day review window
5. Store review, trigger reputation recalculation

### 9. Reputation Service (`src/services/reputation.js`)

```javascript
// Public Interface
module.exports = {
  async calculateScore(userId),
  async getScore(userId),          // Cache-first, compute on miss
  async invalidateScore(userId),   // Called after new review
};
```

Score formula:
```
ratingComponent   = (avgRating - 1) / 4 * 100 * 0.70
txnComponent      = min(completedTxns, 50) / 50 * 100 * 0.20
ageComponent      = min(accountAgeDays, 365) / 365 * 100 * 0.10
reputationScore   = round(ratingComponent + txnComponent + ageComponent)
```

### 10. Modified Product Submission Flow

Current (synchronous):
```
submit → verify → price (Bedrock) → route (Bedrock) → save → respond
```

New (async with queues):
```
submit → verify → enqueue(pricing) → enqueue(routing) → respond with "processing"
                                   ↓
              [Worker] pricing → store result → check if both done → list
              [Worker] routing → store result → check if both done → list → notify
```

Fallback (queue unavailable):
```
submit → verify → price (sync) → route (sync) → save → respond (original flow)
```

### 11. Modified Marketplace Routes

```javascript
// GET /api/marketplace/nearby - Add cache layer
router.get('/nearby', async (req, res, next) => {
  // 1. Build cache key from query params
  // 2. Check cache → return if hit (add x-cache: HIT header)
  // 3. On miss: query DynamoDB, cache result, return (add x-cache: MISS header)
});

// GET /api/marketplace/product/:productId - Real reviews
router.get('/product/:productId', async (req, res, next) => {
  // 1. Check product cache
  // 2. Fetch seller reviews from Review_Service (not mock generator)
  // 3. Include reputation score
  // 4. Cache full response
});
```

## API Endpoints (New)

### Notifications

```
POST   /api/notifications/subscriptions     - Create interest subscription
GET    /api/notifications/subscriptions     - List user's subscriptions
DELETE /api/notifications/subscriptions/:id - Delete subscription
PUT    /api/notifications/mode              - Update notification mode (all/personalized)
GET    /api/notifications/mode              - Get current notification mode
```

### Reviews

```
POST   /api/reviews                         - Submit review for transaction
GET    /api/reviews/user/:userId            - Get reviews for a user
GET    /api/reviews/transaction/:txnId      - Get reviews for a transaction
```

### Health (Extended)

```
GET    /health                              - Add cache + queue status
GET    /api/health/queues                   - Detailed queue metrics
```

### WebSocket (API Gateway)

```
$connect    - Authenticate + register connection
$disconnect - Deregister connection
$default    - Ping/pong handling
```

## Configuration

### New Environment Variables

```bash
# Cache
REDIS_ENDPOINT=redis://your-elasticache-endpoint:6379
CACHE_DEFAULT_TTL=300

# Queues
ROUTING_QUEUE_URL=https://sqs.ap-south-2.amazonaws.com/123456789/routing-queue
PRICING_QUEUE_URL=https://sqs.ap-south-2.amazonaws.com/123456789/pricing-queue
ROUTING_DLQ_URL=https://sqs.ap-south-2.amazonaws.com/123456789/routing-dlq
PRICING_DLQ_URL=https://sqs.ap-south-2.amazonaws.com/123456789/pricing-dlq
ENABLE_ASYNC_PROCESSING=true

# Notifications
WEBSOCKET_ENDPOINT=https://abc123.execute-api.ap-south-2.amazonaws.com/production
NOTIFICATION_TOPIC_ARN=arn:aws:sns:ap-south-2:123456789:product-notifications

# Personalization
PERSONALIZATION_THRESHOLD=0.7
PERSONALIZATION_BEDROCK_MODEL_ID=anthropic.claude-3-haiku-20240307-v1:0

# Feature flags
ENABLE_CACHE=true
ENABLE_NOTIFICATIONS=true
ENABLE_REVIEWS=true

# CloudFront
CLOUDFRONT_DISTRIBUTION_ID=E1234567890ABC
CLOUDFRONT_DOMAIN=d123456.cloudfront.net
```

### New Dependencies

```json
{
  "ioredis": "^5.4.1",
  "@aws-sdk/client-sqs": "^3.1068.0",
  "@aws-sdk/client-sns": "^3.1068.0",
  "@aws-sdk/client-apigatewaymanagementapi": "^3.1068.0"
}
```

## Error Handling

- **Cache failures**: All cache operations wrapped in try/catch; failures return null and log a warning. No request ever fails due to cache unavailability.
- **Queue send failures**: If SQS send fails, the product submission falls back to synchronous Bedrock calls (original behavior). An error is logged.
- **Worker processing failures**: Each message gets 3 attempts (via SQS maxReceiveCount). On final failure, message routes to DLQ, product status set to indicate failure, and a CloudWatch alarm can trigger.
- **WebSocket delivery failures**: If `postToConnection` returns 410 (GoneException), the connection is deregistered. Other errors trigger retry with exponential backoff (up to 3 attempts).
- **SNS publish failures**: Retry 3x with exponential backoff. On exhaustion, log the failure with notification payload for manual recovery.
- **Review submission conflicts**: Conditional DynamoDB put with `attribute_not_exists(PK)` prevents duplicate reviews. Returns 409 Conflict.
- **Reputation calculation failures**: On transient error, retain the last-known score and log for investigation. Cache miss triggers on-demand recalculation.

## Correctness Properties

### Property 1: Cache Consistency
Cache entries are invalidated eagerly on any write that affects the cached data. Stale reads are bounded by TTL (max 60s for marketplace, 180s for products, 300s for reputation). No request ever returns data older than the configured TTL for its cache key namespace.

**Validates: Requirements 2.4, 3.3, 10.6**

### Property 2: Exactly-Once Processing
Workers check for existing results before processing (idempotent). Duplicate SQS messages are discarded if the product already has the relevant decision stored. A product's routing and pricing decisions are written at most once per submission.

**Validates: Requirements 4.3, 5.6**

### Property 3: Review Uniqueness
Enforced by DynamoDB conditional write on GSI2 (TXN#{transactionId} + REVIEW#{reviewerId}). No race condition possible — concurrent attempts for the same reviewer + transaction result in exactly one persisted review.

**Validates: Requirements 9.4, 9.5**

### Property 4: Notification Deduplication
Per-user dedup during matching ensures a user receives at most one notification per listed product, even if multiple subscriptions match. The dedup window is the lifetime of the notification dispatch for a single product listing event.

**Validates: Requirements 7.7**

### Property 5: Product Status State Machine
Product status follows a strict state machine: `pending_verification → verified → processing → listed` (or `routing_failed` / `partially_processed`). Workers use conditional updates to prevent invalid transitions. No product can move backward in the state machine.

**Validates: Requirements 4.4, 4.5, 5.6, 5.7**

### Property 6: Subscription Limit Enforcement
Enforced at write time via count query + conditional put. A user can never have more than 10 active subscriptions persisted in DynamoDB, bounded by DynamoDB's single-item consistency guarantees.

**Validates: Requirements 6.2, 6.3**

## Error Handling & Resilience

| Component | Failure Mode | Behavior |
|-----------|-------------|----------|
| ElastiCache | Connection lost | Bypass cache, serve from DynamoDB directly |
| SQS | Send fails | Fall back to synchronous Bedrock call |
| SQS | Worker crash | Message returns to queue after visibility timeout |
| SQS | 3 failures | Message moves to DLQ, product marked failed |
| WebSocket | Connection drop | Deregister, fall back to SNS for pending notifications |
| SNS | Publish fails | Retry 3x with exponential backoff, log failure |
| Bedrock (worker) | Timeout/error | Use local fallback algorithms (existing behavior) |
| Bedrock (personalization) | Timeout/error (5s max) | Fall back to delivering notification (treat as "all" mode) |

## Cache Invalidation Strategy

| Trigger | Invalidation |
|---------|-------------|
| Product created | `marketplace:{geohash4}:*` + adjacent geohashes |
| Product status change | `product:{productId}` + `marketplace:{geohash4}:*` |
| Product reserved | `product:{productId}` + `marketplace:{geohash4}:*` |
| Review submitted | `reputation:{revieweeId}` |
| Product listed | `marketplace:stats` |

## Security Considerations

- WebSocket connections authenticated via JWT token passed as query parameter during `$connect`
- Lambda authorizer on API Gateway validates JWT before allowing WebSocket upgrade
- Review submissions validated against transaction participants (prevent unauthorized reviews)
- Rate limiting on subscription creation (existing rate limiter applies)
- SQS messages signed by AWS IAM (no external access)
- Redis access restricted to VPC security group (no public endpoint)

## CloudFront Edge Proxy Design

### Distribution Configuration

```
CloudFront Distribution
├── Behavior 1: Default (*)
│   └── Origin: S3 bucket (frontend static assets)
│       Cache: Long TTL (24h), immutable for hashed assets
│
├── Behavior 2: /api/marketplace/*
│   └── Origin: EB ALB
│       Cache: 30s TTL for GET requests
│       Forward: Query strings (all), Headers (none for cache sharing)
│       Compress: Yes (gzip + brotli)
│       Viewer: HTTPS only
│       Methods: GET, HEAD, OPTIONS, PUT, POST, DELETE, PATCH
│       Cache GET/HEAD only, forward all others
│
├── Behavior 3: /api/*
│   └── Origin: EB ALB
│       Cache: Disabled (forward all requests)
│       Forward: Query strings (all), Headers (Authorization, Content-Type)
│       Compress: Yes
│       Viewer: HTTPS only
│       Methods: GET, HEAD, OPTIONS, PUT, POST, DELETE, PATCH
│
└── Behavior 4: /health
    └── Origin: EB ALB
        Cache: 10s TTL
        Compress: Yes
```

### Cache Key Policy

| Path Pattern | Cache Key Components | TTL | Reasoning |
|---|---|---|---|
| `/api/marketplace/nearby` | Path + all query params (lat, lng, radius, category, etc.) | 30s | Public endpoint, shared cache across users |
| `/api/marketplace/stats` | Path only | 30s | Same stats for everyone |
| `/api/marketplace/product/*` | Path (includes productId) | 30s | Public product detail, shared |
| `/api/*` (other) | Not cached | 0 | Authenticated/write endpoints — pass through |
| `/health` | Path only | 10s | Quick health probes |

### Origin Configuration

```yaml
ALB Origin:
  DomainName: your-eb-env.ap-south-2.elasticbeanstalk.com
  Protocol: HTTPS only
  MinimumProtocolVersion: TLSv1.2
  ConnectionTimeout: 10s
  ReadTimeout: 30s
  KeepaliveTimeout: 5s
  CustomHeaders:
    X-Forwarded-By: cloudfront
```

### Origin Failover

- **Primary**: EB ALB (healthy when returns 2xx on /health)
- **Failover behavior**: If origin returns 5xx or times out on a cached path, serve stale cached content
- CloudFront's "Origin Shield" in ap-south-2 reduces origin load by collapsing duplicate cache-fill requests

### Response Headers

```
x-cache: Hit from cloudfront | Miss from cloudfront
x-edge-location: BOM50-C1 (Mumbai edge)
x-amz-cf-id: request trace ID
cache-control: public, max-age=30 (set by backend for cacheable responses)
```

### Security

- AWS Shield Standard (automatic, free) — volumetric DDoS protection
- HTTPS-only viewer policy (redirect HTTP → HTTPS)
- TLSv1.2 minimum for origin connections
- No `Authorization` header in cache key for public `/api/marketplace/*` routes (enables shared caching)
- `Authorization` header forwarded but NOT used in cache key — prevents per-user cache fragmentation on public endpoints
- For protected endpoints (`/api/products`, `/api/transactions`, etc.): requests forwarded without caching

### Integration with Backend Cache

```
User Request → CloudFront Edge (30s cache)
                    ↓ (miss)
              Express + Redis (60s cache for marketplace, 180s for product)
                    ↓ (miss)
              DynamoDB
```

Three-layer cache hierarchy:
1. **CloudFront edge** (30s) — geographic proximity, zero origin load
2. **Redis/ElastiCache** (60-180s) — shared across all Express instances
3. **DynamoDB** — source of truth

CloudFront TTL is intentionally shorter than Redis TTL so that edge-expired requests still hit Redis cache (not DynamoDB).

## Deployment Strategy

1. **Branch**: All work on `scaling-backend` branch
2. **Infrastructure**: ElastiCache cluster, SQS queues, API Gateway WebSocket API, SNS topic, and CloudFront distribution provisioned via CloudFormation or Terraform (separate from application code)
3. **CloudFront**: Configure distribution with S3 origin (frontend) + ALB origin (API), cache behaviors per path pattern, enable compression and Shield Standard
4. **Application**: Deploy updated Express server to existing EB environment
5. **Worker**: Deploy as separate EB Worker Environment (or ECS service) consuming from SQS
6. **Frontend**: Update `VITE_API_URL` to point to CloudFront distribution domain instead of direct EB ALB URL
7. **Feature flags**: All new capabilities controlled by env vars; disable any subsystem without code changes
8. **Rollback**: Feature flags allow instant rollback by setting `ENABLE_CACHE=false`, `ENABLE_ASYNC_PROCESSING=false`, etc. CloudFront can be bypassed by switching frontend back to direct ALB URL

## Testing Strategy

- Unit tests for cache service (mock ioredis)
- Unit tests for queue service (mock SQS client)
- Unit tests for reputation score calculation (pure math)
- Integration tests for review submission flow
- Integration tests for notification matching algorithm
- Load test marketplace/nearby endpoint with and without cache to verify improvement

## Frontend Graceful Degradation Design

### Architecture

```
frontend/src/
├── services/
│   └── cacheManager.js       (NEW - client-side cache with IndexedDB/localStorage)
├── hooks/
│   └── useGracefulFetch.js   (NEW - custom hook with stale-while-revalidate + fallback)
├── components/
│   ├── OfflineBanner.jsx     (NEW - persistent offline indicator)
│   ├── StaleDataBanner.jsx   (NEW - "Last updated X min ago" indicator)
│   ├── SkeletonProduct.jsx   (NEW - animated placeholder for processing products)
│   ├── ReconnectToast.jsx    (NEW - WebSocket reconnection indicator)
│   └── SectionUnavailable.jsx (NEW - placeholder for failed partial sections)
```

### Client-Side Cache Strategy

```javascript
// services/cacheManager.js
// Uses localStorage for small data, IndexedDB for larger datasets (50 product cap)
module.exports = {
  cacheResponse(key, data, maxAgeMs),     // Store API response with timestamp
  getCached(key),                          // Return { data, cachedAt, isStale }
  clearCache(pattern),                     // Clear entries matching pattern
  getCacheStats(),                         // Number of entries, total size
};
```

Cache key patterns:
```
marketplace:nearby:{lat}:{lng}:{radius}    → Last 50 products (IndexedDB)
product:{productId}                        → Product detail JSON (localStorage)
user:subscriptions                         → User's notification subscriptions
```

### Stale-While-Revalidate Hook

```javascript
// hooks/useGracefulFetch.js
// Custom React hook that:
// 1. Returns cached data immediately (if available)
// 2. Fetches fresh data in background
// 3. Updates UI when fresh data arrives
// 4. Falls back to cached data if fetch fails after 3 seconds
// 5. Shows appropriate staleness indicators

function useGracefulFetch(url, options) {
  // Returns: { data, isStale, isOffline, isFetching, error, lastUpdated }
}
```

### WebSocket Reconnection Strategy

```
disconnect detected → show toast "Reconnecting..."
  → attempt 1 (1s delay)
  → attempt 2 (2s delay)
  → attempt 3 (4s delay)
  → attempt 4 (8s delay)
  → ... up to 30s max interval
  → on success: dismiss toast, refresh active view
  → on offline: show offline banner, stop reconnection attempts until online
```

### Optimistic UI Pattern

```
User action (e.g., submit review)
  → Immediately update local UI (show success)
  → Send API request in background
  → If success: no change needed
  → If failure (after 3 retries): revert UI, show error toast
```

### Partial Rendering Strategy

When API returns degraded responses (e.g., product detail loads but reviews fail):
- Render all successfully loaded sections normally
- Replace failed sections with `<SectionUnavailable />` component showing:
  - What section is unavailable ("Reviews", "Price Estimate", etc.)
  - A retry button
  - No blocking of the rest of the page

### Offline Mode

- Detect via `navigator.onLine` + `online`/`offline` events
- When offline: show persistent banner, switch all data reads to cache-only
- Allow browsing cached marketplace listings and product details (read-only)
- Disable write actions (submit product, create reservation, post review) with tooltip "Available when online"
- When connectivity restores: auto-refresh current view within 5 seconds, dismiss banner