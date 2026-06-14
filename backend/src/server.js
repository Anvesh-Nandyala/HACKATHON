require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const marketplaceRoutes = require('./routes/marketplace');
const transactionRoutes = require('./routes/transactions');
const creditsRoutes = require('./routes/credits');

const { errorHandler } = require('./middleware/errorHandler');
const { authMiddleware } = require('./middleware/auth');
const { rateLimiter } = require('./middleware/rateLimiter');
const { ensureTable } = require('./db/dynamodb');
const cache = require('./services/cache');
const queue = require('./services/queue');

const app = express();
const PORT = process.env.PORT || 8080;

// Global middleware
app.use(helmet());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));


app.use(express.json({ limit: '10mb' }));
app.use(compression()); // gzip/brotli for CloudFront + mobile performance
app.use(rateLimiter);

// Health check (extended with feature status)
app.get('/health', async (req, res) => {
  const cacheHealth = await cache.getHealth();
  res.json({
    status: 'healthy',
    service: 'circular-commerce-platform',
    features: {
      cache: { enabled: cacheHealth.connected, backend: cacheHealth.backend, latencyMs: cacheHealth.latencyMs },
      routingQueue: { enabled: !!process.env.ROUTING_QUEUE_URL },
      pricingQueue: { enabled: !!process.env.PRICING_QUEUE_URL },
      notifications: { enabled: !!process.env.WEBSOCKET_ENDPOINT || !!process.env.NOTIFICATION_TOPIC_ARN },
      reviews: { enabled: process.env.ENABLE_REVIEWS !== 'false' },
    },
  });
});
app.get('/', (req, res) => {
  res.json({
    message: 'Circular Commerce Platform API is running',
    health: '/health'
  });
});

// Public routes (no auth required)
app.use('/api/auth', authRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/seed', require('./routes/seed'));
app.use('/api/health', require('./routes/health'));
app.use('/api/compatibility', require('./routes/compatibility'));
app.use('/api/recommendations', require('./routes/recommendations'));
app.use('/api/location', require('./routes/location'));

// Protected routes
app.use('/api/uploads', authMiddleware, require('./routes/uploads'));
app.use('/api/products', authMiddleware, productRoutes);
app.use('/api/transactions', authMiddleware, transactionRoutes);
app.use('/api/credits', authMiddleware, creditsRoutes);
app.use('/api/reviews', authMiddleware, require('./routes/reviews'));
app.use('/api/notifications', authMiddleware, require('./routes/notifications'));
app.use('/api/admin', authMiddleware, require('./routes/admin'));

// Error handling
app.use(errorHandler);

// Start server after ensuring DynamoDB table exists
app.listen(PORT, () => {
  console.log(`Circular Commerce Platform running on port ${PORT}`);

  // Initialize DynamoDB
  ensureTable()
    .then(() => console.log('DynamoDB table checked'))
    .catch((err) => console.error('DynamoDB table check failed:', err.message));

  // Initialize cache (non-blocking)
  cache.initialize()
    .then(() => console.log('Cache service initialized'))
    .catch((err) => console.warn('Cache initialization warning:', err.message));

  // Log feature flag status
  console.log('[Features] Queue:', queue.isEnabled() ? 'ENABLED' : 'DISABLED');
  console.log('[Features] Cache: INITIALIZING');
  console.log('[Features] Notifications:', process.env.WEBSOCKET_ENDPOINT ? 'ENABLED' : 'DISABLED');
  console.log('[Features] Reviews:', process.env.ENABLE_REVIEWS !== 'false' ? 'ENABLED' : 'DISABLED');
});

module.exports = app;
