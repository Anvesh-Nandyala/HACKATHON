const express = require('express');
const { z } = require('zod');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { store } = require('../db/store');
const { CATEGORIES } = require('../validators/schemas');

const router = express.Router();

const s3Client = new S3Client({
  region: process.env.S3_REGION || process.env.AWS_REGION || 'ap-south-2',
});
const S3_BUCKET = process.env.S3_BUCKET;

const PRODUCT_STATUSES = [
  'pending_verification',
  'verified',
  'listed',
  'reserved',
  'sold',
  'returned',
  'return_requested',
  'refurbishment_review',
  'recycled',
  'donated',
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
    returnInspection: product.returnInspection,
    returnTransactionId: product.returnTransactionId,
    refurbishedAt: product.refurbishedAt,
    returnedAt: product.returnedAt,
    media: {
      imageCount: product.mediaKeys?.images?.length || 0,
      hasVideo: Boolean(product.mediaKeys?.video),
    },
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
    const [products, users, transactions, cartPurchases] = await Promise.all([
      store.getAllProducts(),
      store.getAllUsers(),
      store.getAllTransactions(),
      store.getAllCartPurchases(),
    ]);
    const byStatus = {};
    const byCategory = {};
    for (const product of products) {
      byStatus[product.status] = (byStatus[product.status] || 0) + 1;
      byCategory[product.category] = (byCategory[product.category] || 0) + 1;
    }
    const completedTxns = transactions.filter(t => t.status === 'completed');
    const completedValue = completedTxns.reduce((sum, t) => sum + (t.agreedPrice || 0), 0);
    const cartValue = cartPurchases.reduce((sum, cp) => sum + ((cp.price || 0) * (cp.quantity || 1)), 0);

    res.json({
      totalUsers: users.length,
      totalProducts: products.length,
      activeListed: byStatus.listed || 0,
      returned: products.filter(product => product.returnInspection || product.returnedAt).length,
      reserved: byStatus.reserved || 0,
      sold: byStatus.sold || 0,
      totalTransactions: transactions.length + cartPurchases.length,
      completedTransactions: completedTxns.length,
      cartPurchases: cartPurchases.length,
      completedValue: completedValue + cartValue,
      byStatus,
      byCategory,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/products', async (req, res, next) => {
  try {
    const [allProducts, allUsers] = await Promise.all([
      store.getAllProducts(),
      store.getAllUsers(),
    ]);
    const userMap = {};
    for (const user of allUsers) {
      userMap[user.userId] = user.name || user.email || user.userId;
    }
    const products = filterProducts(allProducts, req.query)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .map(p => ({ ...serializeProduct(p), sellerName: userMap[p.userId] || p.userId }));

    res.json({ products, count: products.length });
  } catch (err) {
    next(err);
  }
});

router.get('/products/:productId/media/:kind/:index?', async (req, res, next) => {
  try {
    if (!S3_BUCKET) return res.status(500).json({ error: 'S3 bucket is not configured' });

    const product = await store.getProduct(req.params.productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const { kind } = req.params;
    const index = parseInt(req.params.index || '0', 10);
    const key = kind === 'video'
      ? product.mediaKeys?.video
      : product.mediaKeys?.images?.[index];

    if (!key) return res.status(404).json({ error: 'Media not found' });

    const object = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }));

    res.setHeader('Content-Type', object.ContentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    object.Body.pipe(res);
  } catch (err) {
    next(err);
  }
});

router.get('/returns', async (req, res, next) => {
  try {
    const returnedStatuses = new Set(['returned', 'return_requested', 'refurbishment_review', 'recycled', 'donated']);
    const products = (await store.getAllProducts())
      .filter(product => returnedStatuses.has(product.status) || product.returnInspection || product.returnedAt)
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

router.post('/products/:productId/return-disposition', async (req, res, next) => {
  try {
    const { disposition, adminNote } = z.object({
      disposition: z.enum(['refurbish', 'donate', 'recycle']),
      adminNote: z.string().max(1000).optional(),
    }).parse(req.body);

    const product = await store.getProduct(req.params.productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const now = new Date().toISOString();
    product.adminNote = adminNote || product.adminNote;

    if (disposition === 'refurbish') {
      product.status = 'listed';
      product.condition = 'refurbished';
      product.refurbishedAt = now;
      product.refurbishedTag = 'Refurbished';
      product.routingDecision = {
        ...(product.routingDecision || {}),
        destination: 'refurbish',
        reasoning: 'Admin approved returned item for refurbishment and relisting.',
      };
    }

    if (disposition === 'donate') {
      product.status = 'donated';
      product.routingDecision = {
        ...(product.routingDecision || {}),
        destination: 'donate',
        reasoning: 'Admin selected donation for returned product.',
      };
    }

    if (disposition === 'recycle') {
      product.status = 'recycled';
      product.routingDecision = {
        ...(product.routingDecision || {}),
        destination: 'recycle',
        reasoning: 'Admin selected recycling for returned product.',
      };
    }

    product.returnResolution = {
      disposition,
      resolvedAt: now,
      resolvedBy: req.user.userId,
      adminNote: product.adminNote,
    };

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

router.get('/users', async (req, res, next) => {
  try {
    const [users, allProducts, allCredits] = await Promise.all([
      store.getAllUsers(),
      store.getAllProducts(),
      store.getAllCredits(),
    ]);
    const productCountByUser = {};
    for (const p of allProducts) {
      if (p.userId) productCountByUser[p.userId] = (productCountByUser[p.userId] || 0) + 1;
    }
    const creditsByUser = {};
    for (const c of allCredits) {
      creditsByUser[c.userId] = c;
    }
    const result = users
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .map(user => ({
        userId: user.userId,
        name: user.name || user.email?.split('@')[0] || 'Unknown',
        email: user.email,
        role: user.role || 'seller',
        productCount: productCountByUser[user.userId] || 0,
        credits: creditsByUser[user.userId]?.totalCredits || 0,
        tier: creditsByUser[user.userId]?.tier || 'bronze',
        createdAt: user.createdAt,
      }));
    res.json({ users: result, count: result.length });
  } catch (err) {
    next(err);
  }
});

router.get('/transactions', async (req, res, next) => {
  try {
    const [transactions, cartPurchases, allUsers, allProducts] = await Promise.all([
      store.getAllTransactions(),
      store.getAllCartPurchases(),
      store.getAllUsers(),
      store.getAllProducts(),
    ]);
    const userMap = {};
    for (const user of allUsers) {
      userMap[user.userId] = user.name || user.email || user.userId;
    }
    const productMap = {};
    for (const p of allProducts) {
      productMap[p.productId] = p;
    }

    // Reservation-based transactions
    const reservationRows = transactions.map(txn => {
      const product = productMap[txn.productId] || {};
      const pName = [product.brand, product.model].filter(Boolean).join(' ') || product.category || 'Product';
      return {
        transactionId: txn.transactionId,
        productId: txn.productId,
        productName: pName,
        type: 'reservation',
        sellerId: txn.sellerId,
        sellerName: userMap[txn.sellerId] || txn.sellerId || 'Unknown',
        buyerId: txn.buyerId,
        buyerName: userMap[txn.buyerId] || txn.buyerId || 'Unknown',
        status: txn.status,
        price: txn.agreedPrice,
        createdAt: txn.createdAt,
      };
    });

    // Cart purchase transactions
    const cartRows = cartPurchases.map(cp => ({
      transactionId: cp.purchaseId,
      productId: cp.productId,
      productName: cp.name || 'Cart Product',
      type: 'cart_purchase',
      sellerId: null,
      sellerName: 'ReCircle Store',
      buyerId: cp.buyerId,
      buyerName: userMap[cp.buyerId] || cp.buyerEmail || cp.buyerId || 'Unknown',
      status: cp.status,
      price: (cp.price || 0) * (cp.quantity || 1),
      createdAt: cp.purchasedAt || cp.createdAt,
    }));

    const result = [...reservationRows, ...cartRows]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    res.json({ transactions: result, count: result.length });
  } catch (err) {
    next(err);
  }
});

router.patch('/transactions/:transactionId', async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.string() }).parse(req.body);
    const txn = await store.getTransaction(req.params.transactionId);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    txn.status = status;
    await store.saveTransaction(txn);
    res.json({ transactionId: txn.transactionId, status: txn.status });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
