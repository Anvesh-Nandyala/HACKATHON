const { z } = require('zod');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CATEGORIES = [
  'electronics', 'clothing', 'furniture', 'books', 'toys',
  'appliances', 'sports', 'tools', 'jewelry', 'automotive',
  'home-garden', 'health-beauty', 'office', 'pet-supplies', 'other'
];

const GeoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const ProductSubmissionSchema = z.object({
  category: z.enum(CATEGORIES),
  brand: z.string().min(1).max(100).optional(),
  model: z.string().min(1).max(200).optional(),
  originalPrice: z.number().positive(),
  ageMonths: z.number().int().min(0),
  condition: z.enum(['new', 'like-new', 'refurbished', 'used']).default('used'),
  purchaseDate: z.string().min(1).max(30),
  imageKeys: z.array(z.string()).min(2).max(10),
  videoKey: z.string().min(1),
  location: GeoPointSchema.optional(),
  pickupAddress: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
});

const DiscoveryQuerySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusKm: z.number().positive().max(50).default(5),
  category: z.enum(CATEGORIES).optional(),
  priceRange: z.object({
    min: z.number().min(0),
    max: z.number().positive(),
  }).optional(),
  minCondition: z.number().min(0).max(100).optional(),
  sortBy: z.enum(['distance', 'price', 'condition', 'recency']).default('distance'),
  limit: z.number().int().positive().max(100).default(20),
  cursor: z.string().optional(),
});

const ReservationSchema = z.object({
  productId: z.string().regex(UUID_REGEX, 'Must be a valid UUID v4'),
  agreedPrice: z.number().positive(),
  pickupWindow: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }),
});

const CreditActionSchema = z.object({
  actionType: z.enum(['sell', 'buy_local', 'buy_refurbished', 'donate', 'recycle', 'avoid_return']),
  productId: z.string().regex(UUID_REGEX),
  metadata: z.record(z.unknown()).optional(),
});

module.exports = {
  UUID_REGEX,
  CATEGORIES,
  GeoPointSchema,
  ProductSubmissionSchema,
  DiscoveryQuerySchema,
  ReservationSchema,
  CreditActionSchema,
};
