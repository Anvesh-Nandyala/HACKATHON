const express = require('express');
const { ReservationSchema } = require('../validators/schemas');
const { reserveProduct } = require('../services/marketplace');
const { awardCredits } = require('../services/credits');
const { store } = require('../db/store');
const { invalidateOnProductChange } = require('../services/cacheInvalidation');
const { inspectReturnedProduct } = require('../services/returnInspection');

const router = express.Router();

function formatPickupAddress({ transaction, product }) {
  const address = transaction.sellerAddress
    || product?.pickupAddress
    || product?.location?.address
    || transaction.pickupLocation?.address;
  if (address) return address;

  const latitude = transaction.pickupLocation?.latitude || product?.location?.latitude;
  const longitude = transaction.pickupLocation?.longitude || product?.location?.longitude;
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return `Pickup coordinates: ${latitude}, ${longitude}`;
  }

  return 'Seller pickup address not provided';
}

function returnWindow(transaction) {
  const completedAt = transaction.completedAt || transaction.pickupVerifiedAt;
  if (!completedAt) return { eligible: false, deadline: null, daysLeft: 0 };
  const deadlineMs = new Date(completedAt).getTime() + 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  return {
    eligible: now <= deadlineMs && transaction.status === 'completed',
    deadline: new Date(deadlineMs).toISOString(),
    daysLeft: Math.max(0, Math.ceil((deadlineMs - now) / (24 * 60 * 60 * 1000))),
  };
}

/**
 * POST /api/transactions/reserve
 */
router.post('/reserve', async (req, res, next) => {
  try {
    const data = ReservationSchema.parse(req.body);
    const buyerId = req.user.userId;

    const transaction = await reserveProduct(
      data.productId,
      buyerId,
      data.agreedPrice,
      data.pickupWindow
    );

    res.status(201).json(transaction);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/transactions
 * List reservations where the current user is buyer or seller.
 */
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const transactions = await store.getTransactionsForUser(userId);

    const enriched = await Promise.all(transactions.map(async (transaction) => {
      const product = await store.getProduct(transaction.productId);
      const seller = await store.getUser(transaction.sellerId);
      const isBuyer = transaction.buyerId === userId;
      const isSeller = transaction.sellerId === userId;
      const sellerEmail = transaction.sellerEmail || seller?.email || '';
      const sellerName = transaction.sellerName || seller?.name || 'Seller';
      const sellerAddress = formatPickupAddress({ transaction, product });
      if (!transaction.pickupOtp && (transaction.status === 'reserved' || transaction.status === 'pickup_scheduled')) {
        transaction.pickupOtp = String(Math.floor(100000 + Math.random() * 900000));
        await store.saveTransaction(transaction);
      }

      return {
        transactionId: transaction.transactionId,
        productId: transaction.productId,
        productName: product ? `${product.brand || ''} ${product.model || ''}`.trim() || product.category : 'Product',
        category: product?.category,
        purchaseDate: product?.purchaseDate,
        grade: product?.verification?.grade,
        conditionScore: product?.verification?.conditionScore,
        status: transaction.status,
        agreedPrice: transaction.agreedPrice,
        pickupWindow: transaction.pickupWindow,
        pickupLocation: transaction.pickupLocation,
        createdAt: transaction.createdAt,
        completedAt: transaction.completedAt,
        returnWindow: returnWindow(transaction),
        returnDetails: transaction.returnDetails,
        role: isBuyer ? 'buyer' : 'seller',
        buyerId: transaction.buyerId,
        sellerId: transaction.sellerId,
        sellerEmail,
        sellerName,
        sellerAddress,
        pickupOtp: isBuyer && transaction.status !== 'completed' ? transaction.pickupOtp : undefined,
        requiresOtp: isSeller && transaction.status !== 'completed',
        creditsAwarded: transaction.creditsAwarded,
      };
    }));

    enriched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ transactions: enriched });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/transactions/:transactionId/verify-pickup
 * Seller verifies the buyer by entering the buyer's pickup OTP.
 */
router.post('/:transactionId/verify-pickup', async (req, res, next) => {
  try {
    const { transactionId } = req.params;
    const { otp } = req.body;
    const transaction = await store.getTransaction(transactionId);

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (transaction.sellerId !== req.user.userId) {
      return res.status(403).json({ error: 'Only the seller can verify pickup' });
    }

    if (transaction.status !== 'reserved' && transaction.status !== 'pickup_scheduled') {
      return res.status(400).json({ error: `Cannot verify transaction in status: ${transaction.status}` });
    }

    if (!otp || String(otp).trim() !== String(transaction.pickupOtp)) {
      return res.status(400).json({ error: 'Invalid pickup OTP' });
    }

    transaction.status = 'completed';
    transaction.pickupVerifiedAt = new Date().toISOString();
    transaction.completedAt = transaction.pickupVerifiedAt;
    await store.saveTransaction(transaction);

    const product = await store.getProduct(transaction.productId);
    if (product) {
      product.status = 'sold';
      await store.saveProduct(product);
      await invalidateOnProductChange(product);
    }

    const sellerCredits = await awardCredits(transaction.sellerId, {
      actionType: 'sell',
      productId: transaction.productId,
      metadata: { price: transaction.agreedPrice, verifiedByOtp: true },
    });

    const buyerCredits = await awardCredits(transaction.buyerId, {
      actionType: 'buy_local',
      productId: transaction.productId,
      metadata: { price: transaction.agreedPrice, verifiedByOtp: true },
    });

    transaction.creditsAwarded = {
      seller: sellerCredits.awarded,
      buyer: buyerCredits.awarded,
    };
    await store.saveTransaction(transaction);

    res.json({
      transactionId,
      status: 'completed',
      creditsAwarded: transaction.creditsAwarded,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/transactions/:transactionId/complete
 */
router.post('/:transactionId/complete', async (req, res, next) => {
  try {
    const { transactionId } = req.params;
    const transaction = await store.getTransaction(transactionId);

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (transaction.status !== 'reserved' && transaction.status !== 'pickup_scheduled') {
      return res.status(400).json({ error: `Cannot complete transaction in status: ${transaction.status}` });
    }

    if (transaction.buyerId !== req.user.userId && transaction.sellerId !== req.user.userId) {
      return res.status(403).json({ error: 'Not authorized to complete this transaction' });
    }

    transaction.status = 'completed';
    transaction.completedAt = new Date().toISOString();
    await store.saveTransaction(transaction);

    const product = await store.getProduct(transaction.productId);
    if (product) {
      product.status = 'sold';
      await store.saveProduct(product);
      await invalidateOnProductChange(product);
    }

    const sellerCredits = await awardCredits(transaction.sellerId, {
      actionType: 'sell',
      productId: transaction.productId,
      metadata: { price: transaction.agreedPrice },
    });

    const buyerCredits = await awardCredits(transaction.buyerId, {
      actionType: 'buy_local',
      productId: transaction.productId,
      metadata: { price: transaction.agreedPrice },
    });

    transaction.creditsAwarded = {
      seller: sellerCredits.awarded,
      buyer: buyerCredits.awarded,
    };
    await store.saveTransaction(transaction);

    res.json({
      transactionId,
      status: 'completed',
      creditsAwarded: transaction.creditsAwarded,
      sellerNewBalance: sellerCredits.newBalance,
      buyerNewBalance: buyerCredits.newBalance,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/transactions/:transactionId/cancel
 */
router.post('/:transactionId/cancel', async (req, res, next) => {
  try {
    const { transactionId } = req.params;
    const transaction = await store.getTransaction(transactionId);

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (transaction.status !== 'reserved') {
      return res.status(400).json({ error: 'Can only cancel reserved transactions' });
    }

    if (transaction.buyerId !== req.user.userId) {
      return res.status(403).json({ error: 'Only the buyer can cancel a reservation' });
    }

    transaction.status = 'cancelled';
    await store.saveTransaction(transaction);

    const product = await store.getProduct(transaction.productId);
    if (product) {
      product.status = 'listed';
      await store.saveProduct(product);
      await invalidateOnProductChange(product);
    }

    res.json({ transactionId, status: 'cancelled' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/transactions/:transactionId
 */
router.get('/:transactionId', async (req, res, next) => {
  try {
    const transaction = await store.getTransaction(req.params.transactionId);

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (transaction.buyerId !== req.user.userId && transaction.sellerId !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const product = await store.getProduct(transaction.productId);
    const seller = await store.getUser(transaction.sellerId);
    const buyer = await store.getUser(transaction.buyerId);
    const isBuyer = transaction.buyerId === req.user.userId;
    const sellerEmail = transaction.sellerEmail || seller?.email || '';
    const sellerName = transaction.sellerName || seller?.name || 'Seller';
    const sellerAddress = formatPickupAddress({ transaction, product });

    res.json({
      transactionId: transaction.transactionId,
      productId: transaction.productId,
      productName: product ? `${product.brand || ''} ${product.model || ''}`.trim() || product.category : 'Product',
      category: product?.category,
      purchaseDate: product?.purchaseDate,
      grade: product?.verification?.grade,
      conditionScore: product?.verification?.conditionScore,
      description: product?.description,
      status: transaction.status,
      agreedPrice: transaction.agreedPrice,
      pickupWindow: transaction.pickupWindow,
      pickupLocation: transaction.pickupLocation,
      sellerId: transaction.sellerId,
      buyerId: transaction.buyerId,
      sellerName,
      sellerEmail,
      sellerAddress,
      buyerName: buyer?.name,
      buyerEmail: buyer?.email,
      role: isBuyer ? 'buyer' : 'seller',
      pickupOtp: isBuyer && transaction.status !== 'completed' ? transaction.pickupOtp : undefined,
      createdAt: transaction.createdAt,
      completedAt: transaction.completedAt,
      returnWindow: returnWindow(transaction),
      returnDetails: transaction.returnDetails,
      creditsAwarded: transaction.creditsAwarded,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/transactions/:transactionId/return
 * Buyer can request return within 7 days after completed pickup.
 */
router.post('/:transactionId/return', async (req, res, next) => {
  try {
    const { transactionId } = req.params;
    const { reason, damageLevel = 'minor', notes = '' } = req.body;
    const transaction = await store.getTransaction(transactionId);

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (transaction.buyerId !== req.user.userId) {
      return res.status(403).json({ error: 'Only the buyer can return this product' });
    }

    const window = returnWindow(transaction);
    if (!window.eligible) {
      return res.status(400).json({ error: 'Return window is closed or transaction is not completed' });
    }

    if (!reason || String(reason).trim().length < 5) {
      return res.status(400).json({ error: 'Return reason is required' });
    }

    const product = await store.getProduct(transaction.productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const returnDetails = {
      reason: String(reason).trim(),
      damageLevel,
      notes: String(notes || '').trim(),
      requestedAt: new Date().toISOString(),
    };

    const inspection = await inspectReturnedProduct(product, returnDetails);

    transaction.status = 'return_requested';
    transaction.returnDetails = {
      ...returnDetails,
      inspection,
    };
    await store.saveTransaction(transaction);

    product.status = inspection.disposition === 'refurbish'
      ? 'listed'
      : inspection.disposition === 'recycle'
        ? 'recycled'
        : 'return_requested';
    if (inspection.disposition === 'refurbish') {
      product.condition = 'refurbished';
      product.refurbishedAt = returnDetails.requestedAt;
      product.refurbishedTag = 'Refurbished';
      product.routingDecision = {
        ...(product.routingDecision || {}),
        destination: 'refurbish',
        reasoning: inspection.recommendation,
      };
    }
    if (inspection.disposition === 'recycle') {
      product.routingDecision = {
        ...(product.routingDecision || {}),
        destination: 'recycle',
        reasoning: inspection.recommendation,
      };
    }
    product.returnReason = returnDetails.reason;
    product.returnedAt = returnDetails.requestedAt;
    product.returnInspection = inspection;
    product.returnTransactionId = transaction.transactionId;

    await store.saveProduct(product);
    await invalidateOnProductChange(product);

    res.json({
      transactionId,
      status: transaction.status,
      productStatus: product.status,
      inspection,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
