# Implementation Plan: Backend Scaling Infrastructure

## Overview

This plan implements four backend scaling subsystems for the Circular Commerce Platform: Redis caching (ElastiCache), SQS message queues for async AI processing, real-time WebSocket notifications via API Gateway + SNS, and a DynamoDB-backed user reputation/review system. Each subsystem integrates into the existing Node.js/Express monolith with graceful degradation via feature flags.

## Tasks

- [ ] 1. Set up infrastructure layer and shared utilities
  - [x] 1.1 Install new dependencies and create Redis client module
    - Add `ioredis`, `@aws-sdk/client-sqs`, `@aws-sdk/client-sns`, `@aws-sdk/client-apigatewaymanagementapi` to package.json
    - Create `src/db/redis.js` with connection singleton, exponential backoff reconnection (1s to 30s), 5-second connect timeout, and ready/error/close event handlers
    - Export `getClient()`, `createClient()`, `isReady()` functions
    - _Requirements: 1.1, 1.2, 1.4, 13.1_

  - [x] 1.2 Create Cache Service abstraction
    - Create `src/services/cache.js` implementing: `initialize()`, `isConnected()`, `get(key)`, `set(key, value, ttlSeconds)`, `del(key)`, `delPattern(pattern)`, `getHealth()`
    - All methods must gracefully return null/false on connection failure (never throw)
    - Support configurable default TTL (env `CACHE_DEFAULT_TTL`, default 300s, range 1–86400s)
    - Log warnings on connection loss; auto-resume caching on reconnect
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 13.1_

  - [x] 1.3 Create Queue Service abstraction
    - Create `src/services/queue.js` implementing: `enqueueRoutingTask(productId, payload)`, `enqueuePricingTask(productId, payload)`, `getQueueHealth()`, `isEnabled()`
    - Read queue URLs from `ROUTING_QUEUE_URL`, `PRICING_QUEUE_URL` env vars
    - Configure visibility timeout of 60s for routing, 45s for pricing
    - If queue URL env vars are missing, `isEnabled()` returns false and enqueue methods return null
    - _Requirements: 4.1, 4.6, 5.1, 5.5, 13.2, 13.5_

  - [x] 1.4 Update server.js with Redis initialization, new routes, and feature flag configuration
    - Import and call `cache.initialize()` on startup (non-blocking, log warning on failure)
    - Register new route modules: `/api/notifications`, `/api/reviews`, `/api/health`
    - Read all new env vars and log warnings for any missing ones
    - Expose feature status (cache, routing queue, pricing queue, notifications) on `/health` endpoint
    - _Requirements: 1.1, 1.3, 13.1, 13.2, 13.3, 13.4, 13.5, 13.7_

- [ ] 2. Implement marketplace and product caching
  - [x] 2.1 Add cache layer to marketplace nearby endpoint
    - Modify `src/routes/marketplace.js` GET `/nearby` to check cache before DynamoDB query
    - Build cache key as `marketplace:{geohash4}:{sha256(filters)}` using query params
    - On cache hit: return cached result with `x-cache: HIT` header and remaining TTL
    - On cache miss: query DynamoDB, store result with 60s TTL, return with `x-cache: MISS` header
    - If cache unavailable: bypass and query DynamoDB directly
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.7, 2.8_

  - [x] 2.2 Add cache layer to marketplace stats endpoint
    - Modify `src/routes/marketplace.js` GET `/stats` to cache response with 120s TTL
    - Use key `marketplace:stats`
    - _Requirements: 2.5_

  - [x] 2.3 Add cache layer to product detail endpoint
    - Modify `src/routes/marketplace.js` GET `/product/:productId` to check cache key `product:{productId}`
    - On hit: return cached product detail; on miss: fetch from DynamoDB, cache with 180s TTL
    - If cache unavailable: fall back to DynamoDB directly
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6_

  - [x] 2.4 Implement cache invalidation on product writes
    - Modify `src/routes/products.js` and relevant store operations to invalidate:
      - `product:{productId}` on product update/reservation
      - `marketplace:{geohash4}:*` and adjacent geohash prefixes on product create/update/reserve
      - `marketplace:stats` on product listed
    - Invalidation must complete within 1 second of the write operation
    - _Requirements: 2.4, 3.3_

  - [ ]* 2.5 Write property test for cache consistency
    - **Property 1: Cache Consistency**
    - Verify that after any write operation (create/update/reserve), the corresponding cache entries are invalidated and subsequent reads return fresh data
    - **Validates: Requirements 2.4, 3.3, 10.6**

- [ ] 3. Checkpoint - Cache layer verification
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement async AI task queues and workers
  - [x] 4.1 Modify product submission to dispatch async queue messages
    - Modify `src/routes/products.js` POST `/submit`: after verification passes, enqueue routing and pricing tasks to SQS instead of calling Bedrock synchronously
    - Respond with `{ productId, status: "processing" }` within 2 seconds
    - If queue is disabled or enqueue fails, fall back to synchronous Bedrock calls (existing behavior)
    - _Requirements: 4.1, 4.2, 4.7, 5.1, 5.2_

  - [x] 4.2 Create routing worker
    - Create `src/workers/routingWorker.js` with `processMessage(message)` function
    - Parse message, check for duplicate (product already has routing decision), call `determineRoute()` from existing routing.js
    - Store routing decision on product record; update status to "listed" if pricing also complete
    - On 3rd failure: message moves to DLQ, set product status to "routing_failed"
    - _Requirements: 4.3, 4.4, 4.5_

  - [x] 4.3 Create pricing worker
    - Create `src/workers/pricingWorker.js` with `processMessage(message)` function
    - Parse message, call `estimatePrice()` from existing pricing.js
    - Store pricing result on product record; update status to "listed" if routing also complete
    - On 3rd failure: message moves to DLQ, apply local pricing fallback, set status accordingly
    - Handle "partially_processed" status when one task fails and the other succeeds
    - _Requirements: 5.3, 5.4, 5.6, 5.7_

  - [x] 4.4 Create worker entry point and polling loop
    - Create `src/worker.js` as standalone process entry point
    - Poll both routing and pricing queues concurrently using long-polling
    - Delete messages from queue after successful processing
    - Log processing duration in milliseconds for each completed task
    - Track average processing time per queue over rolling 5-minute window
    - _Requirements: 4.3, 5.3, 12.4_

  - [ ]* 4.5 Write property test for exactly-once processing
    - **Property 2: Exactly-Once Processing**
    - Verify that duplicate SQS messages for the same product are discarded if the product already has the relevant decision stored
    - **Validates: Requirements 4.3, 5.6**

  - [ ]* 4.6 Write property test for product status state machine
    - **Property 5: Product Status State Machine**
    - Verify that product status transitions follow the strict state machine and no product can move backward
    - **Validates: Requirements 4.4, 4.5, 5.6, 5.7**

- [ ] 5. Checkpoint - Queue and worker verification
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement user reputation and review system
  - [x] 6.1 Add review and subscription data operations to store.js
    - Extend `src/db/store.js` with methods: `saveReview(review)`, `getReviewsForUser(userId, limit)`, `getReviewsForTransaction(transactionId)`, `hasUserReviewed(userId, transactionId)`, `saveSubscription(subscription)`, `getSubscriptions(userId)`, `deleteSubscription(userId, subId)`, `getSubscriptionsByGeohash(geohash4)`, `saveWebSocketConnection(conn)`, `deleteWebSocketConnection(connectionId)`, `getConnectionsByUser(userId)`
    - Use DynamoDB entity patterns defined in design (GSI1, GSI2)
    - Use conditional puts to prevent duplicate reviews
    - _Requirements: 9.5, 6.1, 6.5, 8.1_

  - [x] 6.2 Create Review Service
    - Create `src/services/reviews.js` implementing: `submitReview(reviewerId, transactionId, { rating, title, text })`, `getReviewsForUser(userId, { limit, cursor })`, `getReviewsForTransaction(transactionId)`, `hasUserReviewed(userId, transactionId)`
    - Validation: verify transaction is "completed", reviewer is buyer or seller, no existing review, within 30-day window
    - Validate rating (1–5 integer), title (1–100 chars), text (1–500 chars)
    - Reject with specific error messages for each validation failure
    - Trigger reputation recalculation after successful submission
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 6.3 Create Reputation Service
    - Create `src/services/reputation.js` implementing: `calculateScore(userId)`, `getScore(userId)`, `invalidateScore(userId)`
    - Score formula: 70% avg rating (normalized 1–5 → 0–100) + 20% completed txn count (cap 50 → 0–100) + 10% account age days (cap 365 → 0–100)
    - Round to nearest integer 0–100
    - Cache score in Redis with 300s TTL; recompute on cache miss
    - Return default score of 0 with 0 reviews and 0 avg rating for users with no reviews
    - On transient calculation failure, retain previously stored score and log error
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [x] 6.4 Create review routes
    - Create `src/routes/reviews.js` with endpoints:
      - POST `/api/reviews` — submit review (authenticated)
      - GET `/api/reviews/user/:userId` — get reviews for a user
      - GET `/api/reviews/transaction/:txnId` — get reviews for a transaction
    - Wire into server.js as authenticated routes
    - _Requirements: 9.1, 9.2, 9.5_

  - [x] 6.5 Replace mock reviews with real reviews on product detail
    - Modify `src/routes/marketplace.js` GET `/product/:productId` to fetch seller's 10 most recent reviews from Review_Service
    - Include seller's reputation score, average rating (1 decimal), and total review count
    - If seller has no reviews: return empty list, avg rating 0, count 0, reputation 50
    - If Review_Service unavailable: return empty list and default reputation 50
    - Remove the `generateReviews()` mock function and `REVIEW_TEMPLATES`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ]* 6.6 Write property test for review uniqueness
    - **Property 3: Review Uniqueness**
    - Verify that concurrent review submission attempts for the same reviewer + transaction result in exactly one persisted review
    - **Validates: Requirements 9.4, 9.5**

  - [ ]* 6.7 Write unit tests for reputation score calculation
    - Test score formula with various inputs: no reviews (score=0), one review, many reviews, edge cases at normalization boundaries (50+ txns, 365+ days)
    - _Requirements: 10.2, 10.3, 10.4_

- [ ] 7. Checkpoint - Review and reputation verification
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement real-time notifications
  - [x] 8.1 Create WebSocket Service
    - Create `src/services/websocket.js` implementing: `registerConnection(userId, connectionId)`, `deregisterConnection(connectionId)`, `getActiveConnections(userId)`, `sendToConnection(connectionId, payload)`, `isConnected(userId)`
    - Store connection registry in Redis SET `ws:connections:{userId}` with 700s TTL
    - Backup in DynamoDB for multi-instance consistency
    - Use `@aws-sdk/client-apigatewaymanagementapi` for posting to connections
    - Handle GoneException (410) by deregistering stale connections
    - Enforce max 3 active connections per user
    - _Requirements: 8.1, 8.4, 8.5, 8.6_

  - [x] 8.2 Create Notification Service with subscription management and matching
    - Create `src/services/notifications.js` implementing: `matchAndNotify(product)`, `sendToUser(userId, notification)`, `createSubscription(userId, criteria)`, `deleteSubscription(userId, subId)`, `getSubscriptions(userId)`
    - Subscription validation: max 10 per user, radius 1–50 km, price range 0.01–999999.99
    - Matching algorithm: compute product geohash + 8 adjacent prefixes, query subscriptions, check category + price + haversine distance
    - Deduplicate: one notification per product per user even with multiple matching subscriptions
    - Deliver via WebSocket if connected, else publish to SNS
    - Retry delivery 3x with exponential backoff (starting 1s) on failure
    - Include productId, category, recommended price, distance (1 decimal) in notification payload
    - Deliver within 30 seconds of product listing
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [x] 8.3 Create notification routes
    - Create `src/routes/notifications.js` with endpoints:
      - POST `/api/notifications/subscriptions` — create interest subscription (authenticated)
      - GET `/api/notifications/subscriptions` — list user's subscriptions (authenticated)
      - DELETE `/api/notifications/subscriptions/:id` — delete subscription (authenticated)
    - Wire into server.js as authenticated routes
    - _Requirements: 6.1, 6.4, 6.5, 6.6_

  - [x] 8.4 Integrate notification trigger into worker listing flow
    - Modify routing/pricing workers: when product status changes to "listed", call `matchAndNotify(product)`
    - _Requirements: 7.1, 7.6_

  - [x] 8.5 Create Personalization Service
    - Create `src/services/personalization.js` implementing: `scoreRelevance(userId, product)`, `getUserContext(userId)`, `isEnabled()`
    - Gather user context: completed transactions (categories, brands, price ranges), active subscriptions
    - Send structured prompt to Bedrock asking for a 0.0–1.0 relevance score
    - Use configurable model via `PERSONALIZATION_BEDROCK_MODEL_ID` env var (default: same as routing model)
    - 5-second timeout on Bedrock call; return score of 1.0 (deliver anyway) on failure
    - Configurable threshold via `PERSONALIZATION_THRESHOLD` env var (default 0.7)
    - _Requirements: 12.4, 12.5, 12.7, 12.8_

  - [x] 8.6 Add notification mode preference endpoints
    - Add to `src/routes/notifications.js`:
      - PUT `/api/notifications/mode` — update notification mode ("all" or "personalized")
      - GET `/api/notifications/mode` — get current notification mode
    - Persist mode on user profile in DynamoDB
    - Default mode is "all" for existing users
    - _Requirements: 12.1, 12.2, 12.9_

  - [x] 8.7 Integrate personalization filtering into notification delivery
    - Modify `matchAndNotify()` in notification service: after subscription matching and dedup, check user's mode
    - If "personalized": call `scoreRelevance()`, only deliver if score > threshold
    - If score ≤ threshold: suppress and log (productId, userId, score)
    - If Bedrock fails: deliver notification anyway (fallback to "all" behavior)
    - _Requirements: 12.3, 12.4, 12.5, 12.6, 12.7_

  - [ ]* 8.8 Write property test for notification deduplication
    - **Property 4: Notification Deduplication**
    - Verify that a user receives at most one notification per listed product regardless of how many subscriptions match
    - **Validates: Requirements 7.7**

  - [ ]* 8.9 Write property test for subscription limit enforcement
    - **Property 6: Subscription Limit Enforcement**
    - Verify that a user can never have more than 10 active subscriptions persisted
    - **Validates: Requirements 6.2, 6.3**

- [ ] 9. Implement health monitoring and queue metrics
  - [x] 9.1 Create extended health endpoint
    - Create `src/routes/health.js` with GET `/api/health/queues` endpoint
    - Report approximate message count for routing queue, pricing queue, and their DLQs
    - Report average processing time per queue over rolling 5-minute window
    - Log warning when any DLQ exceeds 10 messages (check every 60s)
    - If SQS attributes unreachable, return status indicating queue is unreachable and log error
    - Respond within 5 seconds
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 9.2 Update main health endpoint with feature status
    - Modify `/health` in server.js to include active/disabled status for each feature (cache, routing queue, pricing queue, notifications)
    - Include cache connection status and latency
    - _Requirements: 14.7, 1.2_

- [ ] 10. Implement frontend graceful degradation
  - [x] 10.1 Create client-side cache manager
    - Create `frontend/src/services/cacheManager.js` using localStorage for small data and IndexedDB for marketplace listings (up to 50 products)
    - Implement: `cacheResponse(key, data, maxAgeMs)`, `getCached(key)` returning `{ data, cachedAt, isStale }`, `clearCache(pattern)`
    - Key patterns: `marketplace:nearby:{params}`, `product:{productId}`, `user:subscriptions`
    - _Requirements: 15.7_

  - [x] 10.2 Create stale-while-revalidate fetch hook
    - Create `frontend/src/hooks/useGracefulFetch.js` custom React hook
    - Return cached data immediately, fetch fresh data in background
    - If fresh fetch fails or exceeds 3 seconds, keep showing cached data with staleness indicator
    - Return `{ data, isStale, isOffline, isFetching, error, lastUpdated }`
    - _Requirements: 15.1, 15.2, 15.7_

  - [x] 10.3 Create UI degradation components
    - Create `frontend/src/components/OfflineBanner.jsx` — persistent banner when network lost
    - Create `frontend/src/components/StaleDataBanner.jsx` — "Last updated X min ago" indicator
    - Create `frontend/src/components/SkeletonProduct.jsx` — animated placeholder for AI processing state
    - Create `frontend/src/components/ReconnectToast.jsx` — WebSocket reconnection indicator
    - Create `frontend/src/components/SectionUnavailable.jsx` — placeholder for failed partial sections with retry button
    - _Requirements: 15.4, 15.5, 15.9_

  - [x] 10.4 Integrate graceful degradation into Marketplace page
    - Modify `frontend/src/pages/Marketplace.jsx` to use `useGracefulFetch` hook
    - Show cached listings when API is slow/unreachable with `StaleDataBanner`
    - Show `OfflineBanner` when fully offline with cached browse capability (read-only)
    - Auto-refresh when connectivity restores within 5 seconds
    - _Requirements: 15.1, 15.7, 15.9, 15.10_

  - [x] 10.5 Integrate graceful degradation into ProductDetail page
    - Modify `frontend/src/pages/ProductDetail.jsx` to use `useGracefulFetch`
    - Show cached product detail when fetch fails with "Some details may be outdated" banner
    - Render product info even when reviews section fails — show `SectionUnavailable` for reviews
    - Show `SkeletonProduct` when product status is "processing" (async AI flow)
    - _Requirements: 15.2, 15.3, 15.4, 15.8_

  - [x] 10.6 Implement WebSocket reconnection and optimistic UI
    - Add exponential backoff reconnection logic (1s → 2s → 4s → ... → 30s max) to WebSocket client
    - Show `ReconnectToast` during reconnection attempts
    - Implement optimistic UI for review submission and subscription creation — revert only on confirmed failure after 3 retries
    - Disable write actions with tooltip when offline
    - _Requirements: 15.5, 15.6, 15.9_

- [ ] 11. Implement CloudFront edge proxy configuration
  - [x] 11.1 Add cache-control headers to public API responses
    - Modify `src/routes/marketplace.js` GET `/nearby`, `/stats`, and `/product/:productId` to include `Cache-Control: public, max-age=30` header on successful responses
    - Ensure non-GET endpoints and authenticated endpoints do NOT include public cache headers
    - Add `x-edge-location` pass-through support (CloudFront sets this automatically)
    - _Requirements: 16.2, 16.3, 16.7_

  - [x] 11.2 Configure backend to work behind CloudFront
    - Update CORS configuration in `src/server.js` to accept requests from CloudFront distribution domain
    - Ensure `X-Forwarded-For` and `X-Forwarded-Proto` headers are trusted (EB ALB already handles this)
    - Enable gzip/brotli compression on Express responses via `compression` middleware for JSON payloads
    - _Requirements: 16.9, 16.10_

  - [x] 11.3 Update frontend API base URL for CloudFront
    - Modify `frontend/.env.production` to set `VITE_API_URL` to the CloudFront distribution domain
    - Ensure `frontend/src/api.js` uses the updated base URL for all API calls
    - WebSocket connection URL remains separate (API Gateway endpoint, not through CloudFront)
    - _Requirements: 16.1, 16.4, 16.5_

  - [x] 11.4 Create CloudFront distribution infrastructure template
    - Create `infrastructure/cloudfront.yaml` (CloudFormation) defining:
      - Distribution with S3 origin (default behavior) and ALB origin (`/api/*`, `/health`)
      - Cache behaviors: public marketplace endpoints (30s TTL), health (10s TTL), other API (no cache, forward all)
      - Cache key policy: path + query strings for marketplace, no Authorization in cache key for public endpoints
      - Origin failover: serve stale cache on 5xx from origin
      - Compression enabled (gzip + brotli)
      - HTTPS-only viewer policy, TLSv1.2 minimum
      - Shield Standard (automatic)
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.8, 16.9, 16.10, 16.11, 16.12_

- [ ] 12. Final checkpoint - Full integration verification
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Implement UX enhancement features
  - [x] 13.1 Predictive Return Prevention — AI Compatibility Check widget
    - Create `backend/src/routes/compatibility.js` with POST `/api/compatibility/check` endpoint
    - Accept: `{ productId, userQuery }` (e.g., "Will this laptop handle video editing?")
    - Call Bedrock with product specs + user query, return: `{ compatible: true/false, confidence: 0-1, explanation: "...", warnings: [] }`
    - Create `frontend/src/components/CompatibilityCheck.jsx` — text input + "Check Fit" button above Reserve button on ProductDetail page
    - Shows green checkmark or yellow warning with AI explanation
    - Wire into `ProductDetail.jsx` before the reserve section
    - _Requirements: Reduces returns, builds buyer confidence_

  - [x] 13.2 AI Inspection Report — Radical Transparency Trust Badges
    - Create `frontend/src/components/AIInspectionReport.jsx` — visual breakdown of AI verification
    - Display: screen condition, body condition, hardware status, authenticity score, detected damage list
    - Use product's existing `verification` data (conditionScore, damageDetected, authenticityScore, working)
    - Style as Amazon-style badge cards with icons (✅ Flawless, ⚠️ Minor wear, ❌ Issue)
    - Add "Analyzed by Bedrock AI" label with confidence percentage
    - Integrate into `ProductDetail.jsx` between product info and reviews section
    - _Requirements: Builds trust in second-hand products_

  - [x] 13.3 Rescue Recommendations — "Save This Item" personalized row
    - Create `backend/src/routes/recommendations.js` with GET `/api/recommendations/rescue`
    - Query products with routing destination "recycle" or "donate" that were listed in last 48 hours
    - Use Personalization Service to rank by user relevance (or fall back to recency)
    - Return top 5 items with countdown timer ("Being recycled in X hours")
    - Create `frontend/src/components/RescueRecommendations.jsx` — horizontal scroll row
    - Show urgency badge: "⏰ Recycled in 12h if not purchased"
    - Add to Marketplace page and Dashboard
    - _Requirements: Drives engagement, reduces waste, personalized recommendations_

  - [x] 13.4 Green Impact Checkout Modal
    - Create `frontend/src/components/GreenImpactModal.jsx` — celebratory popup after reservation
    - Display: CO2 saved (from routing decision), credits earned, tier progress bar, waste diverted
    - Pull data from transaction completion response (creditsAwarded, routing.co2SavedKg)
    - Add confetti animation or green particle effect
    - Show: "🎉 You saved X kg of e-waste! Earned Y credits. Z% to next tier."
    - Trigger after successful reservation in Marketplace.jsx and after verify-pickup in PickupDetail.jsx
    - _Requirements: Reinforces sustainable behavior at moment of purchase_

  - [x] 13.5 Personalized Recommendations for Certified Refurbished Products
    - Create `backend/src/routes/recommendations.js` GET `/api/recommendations/refurbished` endpoint
    - Query products with routing destination "refurbish" or condition "refurbished" that are listed
    - Use Personalization Service (Bedrock) to rank by user relevance based on purchase history
    - If Bedrock disabled, fall back to recency + category matching
    - Return top 8 items with refurbished badge, warranty info, and savings vs new price
    - Create `frontend/src/components/RefurbishedRecommendations.jsx` — horizontal card row
    - Show "Certified Refurbished" badge, savings percentage, AI-matched reason
    - Add to Marketplace page (below Rescue Recommendations) and Dashboard
    - _Requirements: Personalized recommendations, builds trust in refurbished products_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The worker process (`src/worker.js`) runs as a separate EB Worker Environment or ECS task
- All new features are controlled by environment variables and degrade gracefully when disabled
- The existing synchronous product submission flow is preserved as a fallback when queues are unavailable

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "6.1"] },
    { "id": 2, "tasks": ["1.4", "6.2", "6.3"] },
    { "id": 3, "tasks": ["2.1", "2.2", "2.3", "6.4", "6.5"] },
    { "id": 4, "tasks": ["2.4", "4.1", "6.6", "6.7"] },
    { "id": 5, "tasks": ["2.5", "4.2", "4.3"] },
    { "id": 6, "tasks": ["4.4", "8.1"] },
    { "id": 7, "tasks": ["4.5", "4.6", "8.2"] },
    { "id": 8, "tasks": ["8.3", "8.4", "8.5"] },
    { "id": 9, "tasks": ["8.6", "8.7"] },
    { "id": 10, "tasks": ["8.8", "8.9", "9.1", "10.1"] },
    { "id": 11, "tasks": ["9.2", "10.2", "10.3", "11.1", "11.2"] },
    { "id": 12, "tasks": ["10.4", "10.5", "10.6", "11.3", "11.4"] }
  ]
}
```