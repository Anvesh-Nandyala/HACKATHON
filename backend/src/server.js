require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const marketplaceRoutes = require('./routes/marketplace');
const transactionRoutes = require('./routes/transactions');
const creditsRoutes = require('./routes/credits');

const { errorHandler } = require('./middleware/errorHandler');
const { authMiddleware } = require('./middleware/auth');
const { rateLimiter } = require('./middleware/rateLimiter');
const { ensureTable } = require('./db/dynamodb');

const app = express();
const PORT = process.env.PORT || 8080;

// Global middleware
app.use(helmet());
app.use(cors());


app.use(express.json({ limit: '10mb' }));
app.use(rateLimiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'circular-commerce-platform' });
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

// Protected routes
app.use('/api/products', authMiddleware, productRoutes);
app.use('/api/transactions', authMiddleware, transactionRoutes);
app.use('/api/credits', authMiddleware, creditsRoutes);

// Error handling
app.use(errorHandler);

// Start server after ensuring DynamoDB table exists
app.listen(PORT, () => {
  console.log(`Circular Commerce Platform running on port ${PORT}`);

  ensureTable()
    .then(() => console.log('DynamoDB table checked'))
    .catch((err) => console.error('DynamoDB table check failed:', err.message));
});

module.exports = app;
