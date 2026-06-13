const express = require('express');
const { v4: uuidv4 } = require('uuid');
const ngeohash = require('ngeohash');
const { store } = require('../db/store');

const router = express.Router();

const SAMPLE_PRODUCTS = [
  // ─── New Products (like Amazon) ───
  { brand: 'Apple', model: 'iPhone 15 Pro 128GB', category: 'electronics', originalPrice: 999, price: 999, condition: 'new', ageMonths: 0, description: 'Brand new, factory sealed. Latest A17 Pro chip.' },
  { brand: 'Samsung', model: 'Galaxy S24 Ultra', category: 'electronics', originalPrice: 1199, price: 1199, condition: 'new', ageMonths: 0, description: 'Brand new with warranty. AI-powered camera system.' },
  { brand: 'Sony', model: 'WH-1000XM5 Headphones', category: 'electronics', originalPrice: 349, price: 349, condition: 'new', ageMonths: 0, description: 'Industry-leading noise cancellation. 30hr battery.' },
  { brand: 'Nike', model: 'Air Max 90 - Size 10', category: 'clothing', originalPrice: 130, price: 130, condition: 'new', ageMonths: 0, description: 'Classic design. Brand new in box.' },
  { brand: 'Dyson', model: 'V15 Detect Vacuum', category: 'appliances', originalPrice: 749, price: 749, condition: 'new', ageMonths: 0, description: 'Laser reveals hidden dust. Brand new, sealed.' },
  { brand: 'IKEA', model: 'MALM Desk - White', category: 'furniture', originalPrice: 179, price: 179, condition: 'new', ageMonths: 0, description: 'Unassembled, new in box. 140x65cm work surface.' },
  { brand: 'Instant Pot', model: 'Duo Plus 6-Quart', category: 'appliances', originalPrice: 89, price: 89, condition: 'new', ageMonths: 0, description: '9-in-1 pressure cooker. Brand new, sealed.' },
  { brand: 'Adidas', model: 'Ultraboost Light Running', category: 'sports', originalPrice: 190, price: 190, condition: 'new', ageMonths: 0, description: 'Lightest Ultraboost ever. New with tags.' },
  { brand: 'Kindle', model: 'Paperwhite 11th Gen', category: 'electronics', originalPrice: 139, price: 139, condition: 'new', ageMonths: 0, description: '6.8" display, adjustable warm light. New in box.' },
  { brand: 'LEGO', model: 'Technic Porsche 911 GT3', category: 'toys', originalPrice: 149, price: 149, condition: 'new', ageMonths: 0, description: '1580 pieces, new sealed box.' },

  // ─── Like-New / Pre-owned Products ───
  { brand: 'Apple', model: 'MacBook Air M2 13"', category: 'electronics', originalPrice: 1199, price: 899, condition: 'like-new', ageMonths: 3, description: 'Barely used, no scratches. Battery cycle count: 12.' },
  { brand: 'Sony', model: 'PlayStation 5 Disc Edition', category: 'electronics', originalPrice: 499, price: 389, condition: 'like-new', ageMonths: 6, description: 'Comes with 2 controllers. Mint condition.' },
  { brand: 'Herman Miller', model: 'Aeron Chair Size B', category: 'furniture', originalPrice: 1395, price: 750, condition: 'like-new', ageMonths: 8, description: 'Fully loaded. Office closing sale. Pristine.' },

  // ─── Refurbished Products ───
  { brand: 'Apple', model: 'iPad Air 5th Gen 64GB', category: 'electronics', originalPrice: 599, price: 419, condition: 'refurbished', ageMonths: 12, description: 'Certified refurbished. New battery, new screen.' },
  { brand: 'Bose', model: 'QuietComfort 45', category: 'electronics', originalPrice: 329, price: 199, condition: 'refurbished', ageMonths: 14, description: 'Factory refurbished with warranty. Like new sound.' },
  { brand: 'Dyson', model: 'Airwrap Complete', category: 'appliances', originalPrice: 599, price: 349, condition: 'refurbished', ageMonths: 10, description: 'Refurbished by Dyson. All attachments included.' },

  // ─── Used Products ───
  { brand: 'Canon', model: 'EOS R6 Body Only', category: 'electronics', originalPrice: 2499, price: 1200, condition: 'used', ageMonths: 18, description: '45K shutter count. Minor body wear. Works perfectly.' },
  { brand: 'Peloton', model: 'Bike+ with Accessories', category: 'sports', originalPrice: 2495, price: 1100, condition: 'used', ageMonths: 24, description: 'Good condition. Includes mat, weights, shoes.' },
  { brand: 'West Elm', model: 'Mid-Century Sofa', category: 'furniture', originalPrice: 1899, price: 650, condition: 'used', ageMonths: 30, description: 'Some cushion wear. Solid frame. Great for apt.' },
  { brand: 'Samsung', model: 'Galaxy Watch 5 Pro', category: 'electronics', originalPrice: 449, price: 180, condition: 'used', ageMonths: 15, description: 'Screen has light scratches. Battery holds well.' },
];

// Spread locations around NYC area
const LOCATIONS = [
  { latitude: 40.7128, longitude: -74.0060 },  // Downtown Manhattan
  { latitude: 40.7580, longitude: -73.9855 },  // Midtown
  { latitude: 40.7282, longitude: -73.7949 },  // Queens
  { latitude: 40.6782, longitude: -73.9442 },  // Brooklyn
  { latitude: 40.7831, longitude: -73.9712 },  // Upper West Side
  { latitude: 40.7489, longitude: -73.9680 },  // Murray Hill
  { latitude: 40.6892, longitude: -74.0445 },  // Statue of Liberty area
  { latitude: 40.7614, longitude: -73.9776 },  // Rockefeller
];

/**
 * POST /api/seed
 * Seed the database with sample products (for demo purposes).
 */
router.post('/', async (req, res, next) => {
  try {
    const created = [];

    for (let i = 0; i < SAMPLE_PRODUCTS.length; i++) {
      const sample = SAMPLE_PRODUCTS[i];
      const location = LOCATIONS[i % LOCATIONS.length];
      const geohash = ngeohash.encode(location.latitude, location.longitude, 6);

      const productId = uuidv4();
      const conditionScore = sample.condition === 'new' ? 100
        : sample.condition === 'like-new' ? 92
        : sample.condition === 'refurbished' ? 78
        : 55 + Math.floor(Math.random() * 20);

      const grade = conditionScore >= 90 ? 'A' : conditionScore >= 70 ? 'B' : conditionScore >= 40 ? 'C' : 'D';

      const product = {
        productId,
        userId: 'system-seller',
        category: sample.category,
        brand: sample.brand,
        model: sample.model,
        originalPrice: sample.originalPrice,
        ageMonths: sample.ageMonths,
        condition: sample.condition,
        status: 'listed',
        mediaKeys: { images: ['img1.jpg', 'img2.jpg', 'img3.jpg'], video: 'video.mp4' },
        location: { latitude: location.latitude, longitude: location.longitude, geohash },
        description: sample.description,
        verification: {
          conditionScore,
          grade,
          working: true,
          confidence: 0.95,
          damageDetected: [],
          authenticityScore: 0.98,
          verifiedAt: new Date().toISOString(),
        },
        priceEstimate: {
          recommendedPrice: sample.price,
          priceRange: { min: Math.round(sample.price * 0.9), max: Math.round(sample.price * 1.1) },
          confidence: 0.9,
          estimatedDaysToSell: sample.condition === 'new' ? 3 : 7,
        },
        routingDecision: {
          destination: sample.condition === 'new' ? 'resell' : sample.condition === 'like-new' ? 'resell' : 'exchange',
          recoveryValue: sample.price * 0.85,
          reasoning: `${sample.condition} product listed for local sale.`,
        },
        createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
      };

      await store.saveProduct(product);
      created.push({ productId, name: `${sample.brand} ${sample.model}`, condition: sample.condition, price: sample.price });
    }

    res.json({ message: `Seeded ${created.length} products`, products: created });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
