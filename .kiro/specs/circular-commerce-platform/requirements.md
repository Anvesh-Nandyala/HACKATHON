# Requirements Document

## Introduction

The Circular Commerce Platform is an AI-powered system within Amazon that intelligently routes returned, underused, and discarded products to their most valuable and sustainable destination — Resell, Refurbish, Donate, Recycle, or Exchange. The platform leverages computer vision, large language models, and optimization algorithms to verify product condition, estimate fair pricing, and match products with nearby buyers through a hyperlocal marketplace. Green Credits incentivize sustainable behavior, creating a closed-loop economy where environmental impact is a first-class optimization dimension alongside revenue recovery.

## Glossary

- **Platform**: The Circular Commerce Platform system as a whole
- **Verification_Service**: The AI-powered service that analyzes uploaded media to assess product condition, detect damage, and authenticate products
- **Price_Estimation_Service**: The service that determines fair resale value based on condition, market demand, and historical trends
- **Marketplace_Service**: The hyperlocal marketplace that lists verified products to nearby users and facilitates self-pickup transactions
- **Routing_Engine**: The AI-powered engine that determines the optimal destination for each product
- **Credits_Service**: The Green Credits incentive system that rewards users for sustainable actions
- **Batch_Collection_Service**: The logistics optimization service that consolidates low-value products at local hubs
- **Product**: An item submitted to the platform for routing to its optimal destination
- **Condition_Score**: A numeric value from 0-100 representing the assessed physical condition of a product
- **Grade**: A letter grade (A, B, C, D) derived from the condition score
- **Recovery_Value**: The net value recovered after subtracting all logistics costs from expected resale value
- **Geohash**: A spatial encoding used to index products for efficient proximity-based queries
- **Green_Credits**: Virtual credits awarded to users for sustainable actions on the platform
- **Tier**: A user rank (bronze, silver, gold, platinum) based on lifetime earned credits

## Requirements

### Requirement 1: Product Submission and Media Upload

**User Story:** As a seller, I want to submit my product with photos and a video, so that the platform can verify its condition and list it for resale or route it appropriately.

#### Acceptance Criteria

1. WHEN a user submits a product with 2-10 photos and a video under 60 seconds, THE Platform SHALL accept the submission and initiate the verification pipeline
2. WHEN a user submits a product with fewer than 2 photos or more than 10 photos, THE Platform SHALL reject the submission with a descriptive error message
3. WHEN a user submits a product without a video, THE Platform SHALL reject the submission with a descriptive error message
4. WHEN media upload to S3 fails due to a network error, THE Platform SHALL provide a resumable upload URL for retry
5. WHEN media upload fails due to an invalid format, THE Platform SHALL return an error specifying the accepted media formats
6. WHEN media is uploaded successfully, THE Platform SHALL scan the media for malware before processing
7. THE Platform SHALL enforce a maximum of 10 product submissions per user per day

### Requirement 2: AI Product Verification

**User Story:** As a seller, I want the platform to automatically assess my product's condition using AI, so that buyers can trust the product grading without manual inspection.

#### Acceptance Criteria

1. WHEN a product submission is accepted, THE Verification_Service SHALL analyze the uploaded images using Amazon Rekognition for damage detection, label matching, and text extraction
2. WHEN image analysis completes, THE Verification_Service SHALL synthesize findings through Amazon Bedrock for holistic condition assessment
3. WHEN verification completes, THE Verification_Service SHALL produce a condition score in the range 0-100
4. WHEN the condition score is 90-100, THE Verification_Service SHALL assign Grade A
5. WHEN the condition score is 70-89, THE Verification_Service SHALL assign Grade B
6. WHEN the condition score is 40-69, THE Verification_Service SHALL assign Grade C
7. WHEN the condition score is 0-39, THE Verification_Service SHALL assign Grade D
8. THE Verification_Service SHALL calculate the condition score as a weighted sum: surface damage (25%), structural integrity (30%), functional status (30%), completeness (10%), and AI adjustment (5%)
9. WHEN identical media inputs are processed with the same model version, THE Verification_Service SHALL produce identical condition scores and grades
10. IF Rekognition or Bedrock returns an error or timeout during verification, THEN THE Verification_Service SHALL retry with exponential backoff up to 3 attempts
11. IF all retry attempts fail, THEN THE Verification_Service SHALL mark the product as pending manual review and notify the operations team
12. WHEN verification completes successfully, THE Verification_Service SHALL emit a ProductVerified event to EventBridge

### Requirement 3: AI Price Estimation

**User Story:** As a seller, I want to receive an accurate price recommendation for my product, so that I can set a competitive price that reflects market conditions and product condition.

#### Acceptance Criteria

1. WHEN a product is verified, THE Price_Estimation_Service SHALL calculate a recommended price based on category depreciation curves, condition score, and local market demand
2. THE Price_Estimation_Service SHALL produce a price range where the minimum is less than or equal to the recommended price, and the recommended price is less than or equal to the maximum
3. THE Price_Estimation_Service SHALL ensure the recommended price is greater than zero for all valid products
4. THE Price_Estimation_Service SHALL ensure the minimum price in the range is greater than zero
5. WHEN fewer than 3 comparable products are found for price estimation, THE Price_Estimation_Service SHALL widen search criteria to broader categories and wider geography
6. IF widened search still yields insufficient data, THEN THE Price_Estimation_Service SHALL use a depreciation-only model with a lower confidence score
7. WHEN price confidence is low, THE Price_Estimation_Service SHALL flag the estimate for seller review and allow the seller to set a custom price within plus or minus 30% of the estimate
8. WHEN price estimation completes, THE Price_Estimation_Service SHALL emit a PriceEstimated event to EventBridge

### Requirement 4: AI Routing Engine

**User Story:** As a platform operator, I want products to be automatically routed to the best destination, so that recovery value is maximized while minimizing environmental impact.

#### Acceptance Criteria

1. WHEN a product has a condition score above 90 and positive recovery value, THE Routing_Engine SHALL route the product to resell
2. WHEN a product has a condition score between 70 and 90, THE Routing_Engine SHALL consider the refurbish destination
3. WHEN a product has a condition score between 40 and 70, THE Routing_Engine SHALL consider the donate destination
4. WHEN a product has a condition score at or below 40, THE Routing_Engine SHALL consider the recycle destination
5. WHEN a product has a condition score above 60, THE Routing_Engine SHALL consider the exchange destination
6. THE Routing_Engine SHALL calculate recovery value as expected resale value minus shipping cost minus inspection cost minus repair cost
7. WHEN the optimal route yields a negative recovery value, THE Routing_Engine SHALL suggest alternatives in priority order: local resale at reduced price, batch collection at nearest hub, donation, then recycling
8. WHEN a routing decision is made, THE Routing_Engine SHALL provide a non-empty human-readable reasoning explanation
9. THE Routing_Engine SHALL include at most 3 alternative routes with each routing decision
10. WHEN routing completes, THE Routing_Engine SHALL emit a RouteDecided event to EventBridge

### Requirement 5: Hyperlocal Marketplace Discovery

**User Story:** As a buyer, I want to discover products available near me for self-pickup, so that I can avoid shipping costs and get products quickly.

#### Acceptance Criteria

1. WHEN a buyer searches for nearby products, THE Marketplace_Service SHALL return only products within the specified radius from the buyer's location
2. THE Marketplace_Service SHALL calculate distances using the haversine formula for geographic accuracy
3. THE Marketplace_Service SHALL ensure distance calculations are symmetric: distance from A to B equals distance from B to A
4. WHEN a discovery query specifies a sort order, THE Marketplace_Service SHALL return results sorted according to that preference (distance, price, condition, or recency)
5. THE Marketplace_Service SHALL limit discovery results to a maximum of 100 products per query
6. THE Marketplace_Service SHALL return only products with status listed and not return expired or non-listed products
7. WHEN more results exist beyond the page limit, THE Marketplace_Service SHALL provide a cursor for pagination
8. WHEN Amazon Location Service is unavailable, THE Marketplace_Service SHALL fall back to DynamoDB geohash-based queries with approximate distance filtering
9. THE Marketplace_Service SHALL default the search radius to 5 km when no radius is specified

### Requirement 6: Product Reservation and Transaction

**User Story:** As a buyer, I want to reserve a product for pickup, so that another buyer cannot purchase it while I arrange collection.

#### Acceptance Criteria

1. WHEN a buyer reserves a product, THE Marketplace_Service SHALL lock the product using a DynamoDB conditional write to prevent concurrent reservations
2. IF two buyers attempt to reserve the same product simultaneously, THEN THE Marketplace_Service SHALL ensure only one reservation succeeds
3. WHEN a reservation fails due to a concurrent conflict, THE Marketplace_Service SHALL return a product unavailable message and suggest similar nearby products
4. THE Marketplace_Service SHALL ensure the seller and buyer are different users for any transaction
5. THE Marketplace_Service SHALL ensure the agreed price is within 80-120% of the recommended price
6. THE Marketplace_Service SHALL ensure the pickup window duration is between 1 and 72 hours
7. WHEN a product is reserved, THE Marketplace_Service SHALL notify the seller via SNS push notification

### Requirement 7: Green Credits System

**User Story:** As a user, I want to earn Green Credits for sustainable actions, so that I am incentivized to sell, donate, and recycle instead of discarding products.

#### Acceptance Criteria

1. WHEN a user performs a sustainable action (sell, buy refurbished, donate, recycle, or avoid return), THE Credits_Service SHALL award credits based on the action type and impact multiplier
2. THE Credits_Service SHALL ensure credits awarded are greater than or equal to zero for all valid actions
3. THE Credits_Service SHALL ensure the user's total credit balance is never negative
4. THE Credits_Service SHALL process credit awards idempotently: the same action for the same user, product, and action type succeeds at most once
5. THE Credits_Service SHALL calculate environmental impact (CO2 saved in kilograms) for each credited action
6. THE Credits_Service SHALL update the user balance atomically with no partial updates
7. WHEN a user's lifetime earned credits cross a tier threshold, THE Credits_Service SHALL advance the user to the next tier
8. THE Credits_Service SHALL ensure tier progression is monotonically non-decreasing: a user's tier never regresses
9. THE Credits_Service SHALL ensure lifetime earned credits never decrease

### Requirement 8: Batch Collection Optimization

**User Story:** As a platform operator, I want low-value products to be consolidated at local hubs for batch transport, so that logistics costs are minimized.

#### Acceptance Criteria

1. WHEN a product is assigned for batch collection, THE Batch_Collection_Service SHALL assign the product to the geographically nearest hub
2. THE Batch_Collection_Service SHALL ensure every product is assigned to exactly one hub
3. WHEN a hub meets the minimum batch size and batch transport cost is less than the sum of individual transport costs, THE Batch_Collection_Service SHALL mark the batch as viable
4. THE Batch_Collection_Service SHALL ensure total savings from batch collection are greater than or equal to zero
5. THE Batch_Collection_Service SHALL ensure viable batches always have positive savings over individual transport

### Requirement 9: Data Validation

**User Story:** As a platform operator, I want all inputs to be validated, so that the system processes only well-formed data and rejects malformed requests.

#### Acceptance Criteria

1. THE Platform SHALL validate that product IDs are valid UUID v4 format
2. THE Platform SHALL validate that product categories belong to the approved category taxonomy
3. THE Platform SHALL validate that original price is a positive number
4. THE Platform SHALL validate that age in months is a non-negative number
5. THE Platform SHALL validate that latitude values are between -90 and 90
6. THE Platform SHALL validate that longitude values are between -180 and 180
7. THE Platform SHALL validate all API inputs using Zod schemas at the Lambda handler layer before processing
8. WHEN input validation fails, THE Platform SHALL reject the request with a descriptive error before initiating any business logic

### Requirement 10: Authentication and Authorization

**User Story:** As a user, I want my data and products to be secure, so that only I can manage my submissions and only authenticated users can access the platform.

#### Acceptance Criteria

1. THE Platform SHALL require a valid Amazon Cognito JWT for all API endpoints
2. THE Platform SHALL enforce that users can only modify their own products through DynamoDB conditional expressions
3. THE Platform SHALL enforce role-based permissions scoped to seller, buyer, and admin roles
4. THE Platform SHALL rate-limit API requests to 100 requests per second per user via API Gateway throttling
5. THE Platform SHALL store user location as geohash (approximate) in marketplace listings and share exact location only after transaction agreement

### Requirement 11: Event-Driven Orchestration

**User Story:** As a platform operator, I want the processing pipeline to be event-driven, so that services are loosely coupled and can scale independently.

#### Acceptance Criteria

1. WHEN a product is verified, THE Platform SHALL emit a ProductVerified event to EventBridge to trigger price estimation
2. WHEN price estimation completes, THE Platform SHALL emit a PriceEstimated event to EventBridge to trigger routing
3. WHEN a routing decision is made, THE Platform SHALL emit a RouteDecided event to EventBridge to trigger notifications and analytics
4. WHEN a user's tier changes, THE Credits_Service SHALL emit a TierUp event to EventBridge
