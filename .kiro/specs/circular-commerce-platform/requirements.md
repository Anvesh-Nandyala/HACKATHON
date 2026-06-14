# Requirements Document

## Introduction

This feature introduces backend scaling infrastructure to the Circular Commerce Platform. It adds four major capabilities: a Redis caching layer (Amazon ElastiCache) for frequent read operations, message queues (AWS SQS) to offload heavy AI tasks to background workers, real-time notifications (AWS SNS + WebSockets via API Gateway) for interest-matched product alerts, and a user reputation and review system backed by DynamoDB replacing the current mock reviews. All components use Amazon/AWS technologies and integrate with the existing Node.js/Express backend running on Elastic Beanstalk.

## Glossary

- **Cache_Service**: The Redis-based caching layer powered by Amazon ElastiCache that stores frequently accessed read data
- **Queue_Service**: The AWS SQS-based message queue system that offloads heavy AI processing to background workers
- **Worker**: A background process that consumes messages from the Queue_Service and executes AI tasks asynchronously
- **Notification_Service**: The system composed of AWS SNS and WebSocket connections (via API Gateway) that delivers real-time alerts to users
- **Review_Service**: The DynamoDB-backed system that manages user reviews, ratings, and reputation scores for completed transactions
- **Platform**: The Circular Commerce Platform backend (Node.js/Express on Elastic Beanstalk)
- **Marketplace_API**: The existing marketplace route handlers that serve nearby product queries and product detail pages
- **Interest_Subscription**: A user-defined set of criteria (category, price range, location radius) that triggers notifications when matching products are listed
- **Reputation_Score**: A computed numeric score representing a user's trustworthiness based on completed transactions, reviews received, and platform behavior
- **Geohash_Query**: A DynamoDB GSI1 query using geohash prefixes to find products within a geographic area
- **Personalization_Score**: A 0.0–1.0 relevance score computed by AWS Bedrock that indicates how well a matched product fits a specific user's purchase history and preferences

## Requirements

### Requirement 1: Cache Initialization and Connection

**User Story:** As a platform operator, I want the caching layer to initialize on server startup with proper connection management, so that cached data is available immediately and failures are handled gracefully.

#### Acceptance Criteria

1. WHEN the Platform starts, THE Cache_Service SHALL attempt to establish a connection to Amazon ElastiCache Redis and succeed within 5 seconds or treat the attempt as failed
2. WHILE the Cache_Service connection is active, THE Cache_Service SHALL respond to health check queries within 10 milliseconds
3. IF the Cache_Service connection fails during startup, THEN THE Platform SHALL complete startup successfully and serve all requests by falling back to direct DynamoDB queries until the Cache_Service connection is restored
4. IF the Cache_Service connection is lost during operation, THEN THE Cache_Service SHALL attempt reconnection with exponential backoff starting at 1 second, doubling each interval up to a maximum interval of 30 seconds, and SHALL continue retrying indefinitely until the connection is restored
5. THE Cache_Service SHALL use a configurable TTL (time-to-live) for all cached entries with a default of 300 seconds and a permitted range of 1 to 86400 seconds
6. WHEN the Cache_Service reconnects after a connection loss, THE Cache_Service SHALL resume caching new queries immediately and SHALL allow previously cached entries that have not exceeded their TTL to be served without requiring a full cache repopulation

### Requirement 2: Marketplace Query Caching

**User Story:** As a buyer browsing nearby products, I want marketplace queries to return quickly, so that I can browse listings without waiting for database scans.

#### Acceptance Criteria

1. WHEN a Geohash_Query is requested, THE Cache_Service SHALL check for a cached result keyed by the 4-character geohash prefix, product status filter, category filter, price range filter, condition filter, sort order, limit, and cursor before querying DynamoDB
2. WHEN a cache hit occurs for a Geohash_Query, THE Marketplace_API SHALL return the cached result without querying DynamoDB
3. WHEN a cache miss occurs for a Geohash_Query, THE Marketplace_API SHALL query DynamoDB, store the result in the Cache_Service with a TTL of 60 seconds, and return the result, including results with zero matching products
4. WHEN a product is created, updated, or reserved, THE Cache_Service SHALL invalidate all cached entries for the 4-character geohash prefix of that product's location and all adjacent geohash prefixes
5. WHEN the marketplace stats endpoint is called, THE Cache_Service SHALL cache the stats response with a TTL of 120 seconds
6. THE Cache_Service SHALL use a key namespace pattern of "marketplace:{geohash}:{filters_hash}" for geohash query results
7. IF the Cache_Service is unavailable or returns an error, THEN THE Marketplace_API SHALL bypass the cache and query DynamoDB directly, returning results within 3000 milliseconds
8. WHEN a cached response is returned, THE Marketplace_API SHALL include a response header or field indicating the result was served from cache and the remaining TTL in seconds

### Requirement 3: Product Detail Caching

**User Story:** As a buyer viewing a product, I want product detail pages to load instantly, so that I can make quick purchase decisions.

#### Acceptance Criteria

1. WHEN a product detail is requested and a cached entry exists for that product identifier, THE Cache_Service SHALL return the cached product data without querying DynamoDB
2. WHEN a product detail is requested and no cached entry exists for that product identifier, THE Cache_Service SHALL query DynamoDB, store the result in cache with the configured TTL, and return the product data
3. WHEN a product is updated (status change, price update, or reservation), THE Cache_Service SHALL invalidate the cached entry for that product within 1 second of the update operation completing
4. THE Cache_Service SHALL cache individual product details with a TTL of 180 seconds
5. THE Cache_Service SHALL use a key namespace pattern of "product:{productId}" for individual product cache entries
6. IF the cache is unavailable, THEN THE Cache_Service SHALL fall back to querying DynamoDB directly and return the product data without caching

### Requirement 4: AI Task Queue for Routing

**User Story:** As a seller submitting a product, I want my submission to complete quickly without waiting for AI analysis, so that I get immediate feedback and can continue using the platform.

#### Acceptance Criteria

1. WHEN a product passes verification, THE Queue_Service SHALL enqueue a routing task message containing the product identifier, condition score, grade, category, estimated price, location, and working status to the SQS routing queue
2. WHEN a routing task message is enqueued, THE Platform SHALL respond to the seller with an HTTP response containing the product identifier and a "processing" status within 2 seconds of submission
3. WHEN the Worker receives a routing task message, THE Worker SHALL invoke the Bedrock routing model, store the routing decision on the product record, and discard any duplicate message for a product that already has a routing decision stored
4. WHEN the Worker completes a routing task, THE Worker SHALL update the product status from "verified" to "listed" in DynamoDB
5. IF the Worker fails to process a routing task after 3 attempts, THEN THE Worker SHALL move the message to a dead-letter queue and set the product status to "routing_failed"
6. THE Queue_Service SHALL configure a visibility timeout of 60 seconds for routing task messages
7. IF the Queue_Service fails to enqueue the routing task message, THEN THE Platform SHALL invoke the routing model synchronously and return the routing result within 10 seconds of submission

### Requirement 5: AI Task Queue for Pricing

**User Story:** As a seller submitting a product, I want pricing estimation to happen in the background, so that my submission is not blocked by AI model latency.

#### Acceptance Criteria

1. WHEN a product passes verification, THE Queue_Service SHALL enqueue a pricing task message containing the product identifier, category, brand, model, original price, age in months, condition score, grade, working status, and location to the SQS pricing queue
2. WHEN a pricing task message is enqueued, THE Queue_Service SHALL set the product status to "pricing_pending" and return the product identifier and current status to the seller within 2 seconds of the submission request
3. WHEN the Worker receives a pricing task message, THE Worker SHALL invoke the Bedrock pricing model and store the resulting recommended price, price range, confidence score, pricing factors, and estimated days to sell on the product record within 30 seconds of message receipt
4. IF the Worker fails to process a pricing task after 3 attempts, THEN THE Worker SHALL move the message to a dead-letter queue, apply the local pricing fallback to the product record, and set the product status to reflect that fallback pricing was used
5. THE Queue_Service SHALL configure a visibility timeout of 45 seconds for pricing task messages
6. WHEN both pricing and routing tasks complete successfully for a product, THE Worker SHALL update the product status to "listed"
7. IF the pricing task completes but the routing task has failed after exhausting retries (or vice versa), THEN THE Worker SHALL set the product status to "partially_processed" and store which task succeeded and which used a fallback on the product record

### Requirement 6: Interest Subscription Management

**User Story:** As a buyer, I want to subscribe to notifications for products matching my interests, so that I am alerted when relevant items become available nearby.

#### Acceptance Criteria

1. WHEN an authenticated user submits interest criteria (category, price range with minimum of 0.01 and maximum of 999,999.99, location radius), THE Notification_Service SHALL persist the Interest_Subscription in DynamoDB
2. THE Notification_Service SHALL allow a maximum of 10 active Interest_Subscriptions per user
3. IF an authenticated user attempts to create an Interest_Subscription and already has 10 active subscriptions, THEN THE Notification_Service SHALL reject the request with an error message indicating the subscription limit has been reached and preserve all existing subscriptions unchanged
4. WHEN a user requests their active subscriptions, THE Notification_Service SHALL return all Interest_Subscriptions for that user including subscription ID, category, price range, location radius, and creation timestamp
5. WHEN a user deletes a subscription that belongs to that user, THE Notification_Service SHALL remove the Interest_Subscription from DynamoDB
6. IF a user attempts to delete a subscription that does not exist or belongs to another user, THEN THE Notification_Service SHALL reject the request with an error message indicating the subscription was not found
7. IF the submitted location radius is less than 1 or greater than 50 kilometers, THEN THE Notification_Service SHALL reject the subscription request with an error message indicating the valid radius range

### Requirement 7: Real-time Product Match Notifications

**User Story:** As a buyer with active interest subscriptions, I want to receive immediate notifications when matching products are listed, so that I can act quickly on desirable items.

#### Acceptance Criteria

1. WHEN a product status changes to "listed", THE Notification_Service SHALL evaluate the product against all Interest_Subscriptions whose geohash region (4-character geohash prefix and its 8 adjacent prefixes) overlaps with the product's location
2. WHEN a product satisfies ALL of an Interest_Subscription's criteria (category matches, recommended price falls within the subscription's price range, and haversine distance from the subscription's center point to the product location is within the subscription's radius), THE Notification_Service SHALL send a notification to the subscribed user
3. WHEN a WebSocket connection is active for the subscribed user, THE Notification_Service SHALL deliver the notification via the WebSocket connection
4. WHEN no WebSocket connection is active for the subscribed user, THE Notification_Service SHALL publish the notification to an SNS topic for later delivery
5. THE Notification_Service SHALL include the product identifier, category, recommended price, and distance in kilometers (rounded to one decimal place) in the notification payload
6. THE Notification_Service SHALL deliver notifications within 30 seconds of a product being listed
7. IF a single product matches multiple Interest_Subscriptions for the same user, THEN THE Notification_Service SHALL send only one notification to that user for that product
8. IF the Notification_Service fails to deliver a notification via WebSocket or SNS, THEN THE Notification_Service SHALL retry delivery up to 3 times with exponential backoff starting at 1 second, and log the failure if all attempts are exhausted

### Requirement 8: WebSocket Connection Management

**User Story:** As a buyer, I want to maintain a persistent connection for real-time updates, so that I receive notifications without polling.

#### Acceptance Criteria

1. WHEN an authenticated user connects via WebSocket, THE Notification_Service SHALL register the connection with the user's identifier and send a confirmation message to the client within 2 seconds
2. WHEN a WebSocket connection has neither sent nor received any application-level message for more than 10 minutes, THE Notification_Service SHALL send a ping to verify the connection is alive
3. IF a WebSocket ping receives no response within 30 seconds, THEN THE Notification_Service SHALL close the connection and deregister it
4. WHEN a user disconnects, THE Notification_Service SHALL deregister the connection within 5 seconds
5. IF an authenticated user attempts to open a WebSocket connection and already has 3 active connections, THEN THE Notification_Service SHALL reject the new connection and return an error message indicating the maximum connection limit has been reached
6. IF an unauthenticated user attempts to open a WebSocket connection, THEN THE Notification_Service SHALL reject the connection within 2 seconds and return an error message indicating authentication is required

### Requirement 9: Submit Review After Transaction

**User Story:** As a buyer or seller who completed a transaction, I want to leave a review for the other party, so that the community can make informed trust decisions.

#### Acceptance Criteria

1. WHEN a transaction status changes to "completed", THE Review_Service SHALL allow both the buyer and the seller to submit one review each for that transaction within 30 days of the transaction completion timestamp
2. THE Review_Service SHALL require a rating between 1 and 5 (integer), a title (minimum 1 character, maximum 100 characters), and review text (minimum 1 character, maximum 500 characters) for each review submission
3. IF a user attempts to submit a review for a transaction that is not "completed", THEN THE Review_Service SHALL reject the submission with an error message indicating that the transaction is not in a reviewable state
4. IF a user attempts to submit a second review for the same transaction, THEN THE Review_Service SHALL reject the submission with an error message indicating that a review has already been submitted by that user for the transaction
5. WHEN a review is submitted, THE Review_Service SHALL store it with the reviewer identifier, reviewee identifier, transaction identifier, product identifier, rating, title, text, and a server-generated timestamp representing the moment of submission
6. IF a user attempts to submit a review for a transaction in which they are neither the buyer nor the seller, THEN THE Review_Service SHALL reject the submission with an error message indicating that the user is not a participant in the transaction
7. IF a review submission contains a rating outside the 1–5 integer range, a title shorter than 1 or longer than 100 characters, or review text shorter than 1 or longer than 500 characters, THEN THE Review_Service SHALL reject the submission with an error message identifying which field failed validation

### Requirement 10: User Reputation Score Calculation

**User Story:** As a buyer evaluating a seller, I want to see their reputation score based on real transaction history, so that I can assess trustworthiness before purchasing.

#### Acceptance Criteria

1. WHEN a new review is submitted, THE Review_Service SHALL recalculate the Reputation_Score for the reviewed user
2. THE Review_Service SHALL compute the Reputation_Score as a weighted average: 70% from average review rating (normalized linearly from 1–5 scale to 0–100), 20% from completed transaction count (linearly normalized where 0 transactions yields 0 and 50 or more transactions yields 100), and 10% from account age in days (linearly normalized where 0 days yields 0 and 365 or more days yields 100)
3. THE Review_Service SHALL normalize the Reputation_Score to an integer between 0 and 100, rounded to the nearest whole number
4. WHEN a user profile is requested and the user has zero reviews, THE Review_Service SHALL return a default Reputation_Score of 0, a total review count of 0, and an average rating of 0
5. WHEN a user profile is requested, THE Review_Service SHALL include the Reputation_Score, total review count, and average rating (rounded to one decimal place) in the response
6. THE Review_Service SHALL cache the computed Reputation_Score in the Cache_Service with a TTL of 300 seconds
7. IF the Cache_Service does not contain a cached Reputation_Score when a user profile is requested, THEN THE Review_Service SHALL recompute the Reputation_Score on demand and cache the result
8. IF the Reputation_Score recalculation fails due to a transient error, THEN THE Review_Service SHALL retain the previously stored Reputation_Score and log the failure for investigation

### Requirement 11: Display Reviews on Product Detail

**User Story:** As a buyer viewing a product, I want to see real reviews of the seller, so that I can make an informed purchase decision.

#### Acceptance Criteria

1. WHEN a product detail page is requested, THE Marketplace_API SHALL retrieve the seller's reviews from the Review_Service instead of generating mock reviews
2. WHEN a product detail page is requested, THE Marketplace_API SHALL return the 10 most recent reviews for the seller, ordered by submission timestamp descending, where each review includes the reviewer identifier, rating, title, text, and submission timestamp
3. WHEN a product detail page is requested, THE Marketplace_API SHALL include the seller's Reputation_Score (integer 0-100), average rating (rounded to one decimal place), and total review count in the product detail response
4. IF the seller has no reviews, THEN THE Marketplace_API SHALL return an empty review list, an average rating of 0, a total review count of 0, and a default Reputation_Score of 50
5. IF the Review_Service is unavailable when a product detail page is requested, THEN THE Marketplace_API SHALL return the product detail with an empty review list and a default Reputation_Score of 50 rather than failing the entire request

### Requirement 12: AI-Personalized Notification Mode

**User Story:** As a buyer who does not want to receive all subscription-matched notifications, I want to opt into AI-personalized notifications, so that I only receive alerts for products that Bedrock AI determines are the best fit for me based on my purchase history, browsing patterns, and preferences.

#### Acceptance Criteria

1. WHEN an authenticated user updates their notification preference, THE Notification_Service SHALL allow the user to choose between "all" mode (receive every subscription-matched notification) and "personalized" mode (receive only AI-filtered notifications)
2. THE Notification_Service SHALL persist the user's notification mode preference in DynamoDB on the user profile record
3. WHEN a product matches a user's Interest_Subscription and the user's notification mode is "all", THE Notification_Service SHALL deliver the notification without AI filtering
4. WHEN a product matches a user's Interest_Subscription and the user's notification mode is "personalized", THE Notification_Service SHALL invoke AWS Bedrock to score the relevance of the product to the user based on the user's purchase history (past categories, brands, price ranges), browsing behavior (recently viewed categories), and stated preferences
5. WHEN the Bedrock relevance score for a matched product exceeds a configurable threshold (environment variable `PERSONALIZATION_THRESHOLD`, default 0.7, range 0.0–1.0), THE Notification_Service SHALL deliver the notification to the user
6. WHEN the Bedrock relevance score for a matched product is at or below the threshold, THE Notification_Service SHALL suppress the notification and log the suppressed notification with the product identifier, user identifier, and relevance score
7. IF the Bedrock personalization call fails or times out (maximum 5 seconds), THEN THE Notification_Service SHALL fall back to delivering the notification (treat as "all" mode) and log the failure
8. THE Notification_Service SHALL pass the following context to Bedrock for personalization scoring: user's completed transaction history (categories, brands, price ranges), user's active Interest_Subscriptions, the matched product's category, brand, condition score, and recommended price
9. WHEN a user switches from "personalized" mode back to "all" mode, THE Notification_Service SHALL immediately resume delivering all subscription-matched notifications without AI filtering

### Requirement 13: Queue Health Monitoring

**User Story:** As a platform operator, I want visibility into queue processing health, so that I can detect and resolve bottlenecks before they affect users.

#### Acceptance Criteria

1. THE Platform SHALL expose a queue health endpoint that reports the approximate message count for each SQS queue (routing, pricing) and respond within 5 seconds
2. THE Platform SHALL expose the approximate number of messages in each dead-letter queue via the same queue health endpoint
3. WHEN the Platform checks dead-letter queue message counts and the count exceeds 10 for any queue, THE Platform SHALL log a warning containing the queue name and current message count, with checks occurring at least every 60 seconds
4. THE Worker SHALL log processing duration in milliseconds for each completed task and expose the average processing time per queue over a rolling 5-minute window via the queue health endpoint
5. IF the Platform cannot retrieve queue attributes from SQS, THEN THE Platform SHALL return the health endpoint response with a status indicating the affected queue is unreachable and log an error with the queue name and failure reason

### Requirement 14: Cache and Queue Configuration

**User Story:** As a platform operator, I want all scaling infrastructure to be configurable via environment variables, so that I can tune performance without code changes.

#### Acceptance Criteria

1. THE Platform SHALL read the ElastiCache Redis endpoint from the REDIS_ENDPOINT environment variable
2. THE Platform SHALL read SQS queue URLs from ROUTING_QUEUE_URL and PRICING_QUEUE_URL environment variables
3. THE Platform SHALL read the WebSocket API Gateway endpoint from WEBSOCKET_ENDPOINT environment variable
4. THE Platform SHALL read the SNS topic ARN from NOTIFICATION_TOPIC_ARN environment variable
5. IF a required queue or cache environment variable is missing, THEN THE Platform SHALL log a warning identifying the missing variable name and disable the corresponding feature gracefully rather than crashing
6. THE Platform SHALL read dead-letter queue URLs from ROUTING_DLQ_URL and PRICING_DLQ_URL environment variables
7. THE Platform SHALL expose the active/disabled status of each feature (cache, routing queue, pricing queue, notifications) via the health endpoint so operators can confirm which features are enabled

### Requirement 15: Frontend Graceful Degradation

**User Story:** As a buyer browsing the marketplace on a mobile device with inconsistent connectivity, I want the app to remain usable even when backend services are slow or partially unavailable, so that I can continue discovering and purchasing products without frustration.

#### Acceptance Criteria

1. WHEN the marketplace nearby API response is cached locally and a fresh request fails or exceeds 3 seconds, THE Frontend SHALL display the cached product listings with a visible "Last updated X minutes ago" indicator
2. WHEN a product detail API request fails but a cached version exists, THE Frontend SHALL display the cached product detail with a "Some details may be outdated" banner and a retry button
3. WHEN a product detail loads successfully but the reviews section fails (Review_Service unavailable), THE Frontend SHALL render the product information with a "Reviews temporarily unavailable" placeholder instead of blocking the entire page
4. WHEN the AI pricing and routing tasks are processing asynchronously (product status is "processing"), THE Frontend SHALL display a skeleton UI with animated placeholders and a "AI is analyzing your product..." progress indicator instead of a blank or error state
5. WHEN a WebSocket connection is lost, THE Frontend SHALL display a "Reconnecting..." toast notification, attempt automatic reconnection with exponential backoff (1s, 2s, 4s, up to 30s), and resume normal UI state upon successful reconnection
6. WHEN the user submits a review or creates a notification subscription, THE Frontend SHALL apply optimistic UI (show success immediately) and revert the UI change only if the server confirms failure after 3 retry attempts
7. THE Frontend SHALL cache the last successful marketplace query results (up to 50 products) in browser storage (localStorage or IndexedDB) and serve them as fallback data when the API is unreachable
8. WHEN the backend returns a degraded response (e.g., product detail without reviews, marketplace listing without pricing), THE Frontend SHALL render all available data and clearly indicate which sections are unavailable rather than showing a full error page
9. WHEN network connectivity is lost entirely, THE Frontend SHALL display a persistent offline banner and allow the user to browse previously cached marketplace listings and product details in read-only mode
10. WHEN network connectivity is restored after an offline period, THE Frontend SHALL automatically refresh the current view with fresh data and dismiss the offline banner within 5 seconds

### Requirement 16: CloudFront Edge Proxy for API

**User Story:** As a buyer accessing the marketplace from any geographic location, I want API responses to be served from edge locations close to me, so that I experience lower latency and the platform remains protected against DDoS attacks without additional application code.

#### Acceptance Criteria

1. THE Platform SHALL configure an Amazon CloudFront distribution with two origins: an S3 origin for static frontend assets (existing) and an Elastic Beanstalk ALB origin for API requests (path pattern `/api/*` and `/health`)
2. WHEN a GET request is made to `/api/marketplace/nearby`, `/api/marketplace/stats`, or `/api/marketplace/product/:productId`, THE CloudFront distribution SHALL cache the response at edge locations with a TTL of 30 seconds (shorter than the backend Redis TTL to ensure freshness)
3. WHEN a non-GET request (POST, PUT, DELETE) is made to any `/api/*` path, THE CloudFront distribution SHALL forward the request to the ALB origin without caching
4. THE CloudFront distribution SHALL forward the `Authorization` header to the ALB origin for all `/api/*` requests so that authenticated routes continue to function
5. THE CloudFront distribution SHALL forward query string parameters to the ALB origin for all `/api/*` requests so that marketplace query filters (latitude, longitude, radiusKm, category, etc.) are preserved
6. THE CloudFront distribution SHALL include AWS Shield Standard protection (free) to mitigate volumetric DDoS attacks against the API without any application-level code changes
7. THE CloudFront distribution SHALL set a custom response header `x-edge-location` on cached responses indicating the edge location that served the request
8. WHEN a cached API response exists at the edge and the backend origin is unreachable (origin failover scenario), THE CloudFront distribution SHALL serve the stale cached response rather than returning a 5xx error to the client
9. THE Platform SHALL configure CloudFront to compress API responses (gzip/brotli) for all JSON responses to reduce bandwidth and improve mobile performance
10. THE Platform SHALL configure the CloudFront distribution's API behavior to use HTTPS-only viewer policy and TLSv1.2 minimum for origin connections
11. THE CloudFront distribution SHALL use cache keys based on the request path, query string parameters, and `Authorization` header to ensure authenticated users do not receive cached responses intended for other users on protected endpoints
12. FOR public endpoints (`/api/marketplace/*`), THE CloudFront distribution SHALL cache responses without the `Authorization` header in the cache key so that all users benefit from shared edge caching