const express = require('express');
const { z } = require('zod');
const { store } = require('../db/store');
const { CATEGORIES } = require('../validators/schemas');

const router = express.Router();

const PRODUCT_STATUSES = [
  'pending_verification',
  'verified',
  'listed',
  'reserved',
  'sold',
  'returned',
  'return_requested',
  'refurbishment_review',
  'rejected_media_mismatch',
  'hidden',
  'archived',
];

const ProductUpdateSchema = z.object({
  status: z.enum(PRODUCT_STATUSES).optional(),
  category: z.enum(CATEGORIES).optional(),
  brand: z.string().min(1).max(100).optional(),
  model: z.string().min(1).max(200).optional(),
  condition: z.enum(['like-new', 'refurbished', 'used']).optional(),
  purchaseDate: z.string().min(1).max(30).optional(),
  pickupAddress: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).optional(),
  originalPrice: z.number().positive().optional(),
  recommendedPrice: z.number().positive().optional(),
  adminNote: z.string().max(1000).optional(),
  returnReason: z.string().max(1000).optional(),
});

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function productName(product) {
  return [product.brand, product.model].filter(Boolean).join(' ') || product.category || 'Product';
}

function serializeProduct(product) {
  return {
    productId: product.productId,
    name: productName(product),
    category: product.category,
    brand: product.brand,
    model: product.model,
    status: product.status,
    condition: product.condition,
    purchaseDate: product.purchaseDate,
    originalPrice: product.originalPrice,
    recommendedPrice: product.priceEstimate?.recommendedPrice,
    conditionScore: product.verification?.conditionScore,
    grade: product.verification?.grade,
    routingDestination: product.routingDecision?.destination,
    sellerId: product.userId,
    pickupAddress: product.pickupAddress || product.location?.address,
    description: product.description,
    adminNote: product.adminNote,
    returnReason: product.returnReason,
    returnedAt: product.returnedAt,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

function filterProducts(products, query) {
  const status = query.status || '';
  const category = query.category || '';
  const q = String(query.q || '').trim().toLowerCase();

  return products.filter(product => {
    if (status && product.status !== status) return false;
    if (category && product.category !== category) return false;
    if (q) {
      const haystack = [
        product.productId,
        product.brand,
        product.model,
        product.category,
        product.status,
        product.userId,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

router.use(requireAdmin);

router.get('/stats', async (req, res, next) => {
  try {
    const products = await store.getAllProducts();
    const byStatus = {};
    const byCategory = {};
    for (const product of products) {
      byStatus[product.status] = (byStatus[product.status] || 0) + 1;
      byCategory[product.category] = (byCategory[product.category] || 0) + 1;
    }

    res.json({
      totalProducts: products.length,
      activeListed: byStatus.listed || 0,
      returned: (byStatus.returned || 0) + (byStatus.return_requested || 0),
      reserved: byStatus.reserved || 0,
      sold: byStatus.sold || 0,
      byStatus,
      byCategory,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/products', async (req, res, next) => {
  try {
    const products = filterProducts(await store.getAllProducts(), req.query)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .map(serializeProduct);

    res.json({ products, count: products.length });
  } catch (err) {
    next(err);
  }
});

router.get('/returns', async (req, res, next) => {
  try {
    const returnedStatuses = new Set(['returned', 'return_requested', 'refurbishment_review']);
    const products = (await store.getAllProducts())
      .filter(product => returnedStatuses.has(product.status))
      .sort((a, b) => new Date(b.returnedAt || b.updatedAt || 0) - new Date(a.returnedAt || a.updatedAt || 0))
      .map(serializeProduct);

    res.json({ products, count: products.length });
  } catch (err) {
    next(err);
  }
});

router.patch('/products/:productId', async (req, res, next) => {
  try {
    const updates = ProductUpdateSchema.parse(req.body);
    const product = await store.getProduct(req.params.productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    Object.assign(product, {
      ...(updates.status && { status: updates.status }),
      ...(updates.category && { category: updates.category }),
      ...(updates.brand && { brand: updates.brand.trim() }),
      ...(updates.model && { model: updates.model.trim() }),
      ...(updates.condition && { condition: updates.condition }),
      ...(updates.purchaseDate && { purchaseDate: updates.purchaseDate }),
      ...(updates.pickupAddress && {
        pickupAddress: updates.pickupAddress.trim(),
        location: {
          ...(product.location || {}),
          address: updates.pickupAddress.trim(),
        },
      }),
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.originalPrice && { originalPrice: updates.originalPrice }),
      ...(updates.adminNote !== undefined && { adminNote: updates.adminNote }),
      ...(updates.returnReason !== undefined && { returnReason: updates.returnReason }),
    });

    if (updates.recommendedPrice) {
      product.priceEstimate = {
        ...(product.priceEstimate || {}),
        productId: product.productId,
        recommendedPrice: updates.recommendedPrice,
        priceRange: {
          min: Math.max(1, Math.round(updates.recommendedPrice * 0.85)),
          max: Math.max(1, Math.round(updates.recommendedPrice * 1.15)),
        },
      };
    }

    if (updates.status === 'returned' && !product.returnedAt) {
      product.returnedAt = new Date().toISOString();
    }

    await store.saveProduct(product);
    res.json({ product: serializeProduct(product) });
  } catch (err) {
    next(err);
  }
});

router.post('/products/:productId/return', async (req, res, next) => {
  try {
    const updates = ProductUpdateSchema.pick({
      returnReason: true,
      condition: true,
      adminNote: true,
    }).parse(req.body);
    const product = await store.getProduct(req.params.productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    product.status = 'returned';
    product.condition = updates.condition || product.condition || 'used';
    product.returnReason = updates.returnReason || product.returnReason || 'Returned by buyer';
    product.adminNote = updates.adminNote || product.adminNote;
    product.returnedAt = new Date().toISOString();

    await store.saveProduct(product);
    res.json({ product: serializeProduct(product) });
  } catch (err) {
    next(err);
  }
});

router.delete('/products/:productId', async (req, res, next) => {
  try {
    const product = await store.getProduct(req.params.productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    await store.deleteProduct(req.params.productId);
    res.json({ productId: req.params.productId, deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
