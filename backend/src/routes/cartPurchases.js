const express = require('express');
const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');
const { store } = require('../db/store');

const router = express.Router();

const CartItemSchema = z.object({
  id: z.union([z.string(), z.number()]),
  productId: z.string().optional(),
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(100).optional(),
  price: z.number().nonnegative(),
  quantity: z.number().int().positive().default(1),
});

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function estimateReturnDamage(item) {
  const name = `${item.name || ''} ${item.category || ''}`.toLowerCase();
  let damagePercent = 7;

  if (name.includes('tv') || name.includes('vacuum')) damagePercent = 18;
  if (name.includes('lego') || name.includes('shoes')) damagePercent = 12;
  if (name.includes('broken') || name.includes('crack') || name.includes('damage')) damagePercent = 68;

  const disposition = damagePercent <= 10
    ? 'refurbish'
    : damagePercent <= 60
      ? 'recycle'
      : 'admin_review';

  return {
    damagePercent,
    disposition,
    recommendation: disposition === 'refurbish'
      ? 'Low damage detected. Automatically refurbished into website products.'
      : disposition === 'recycle'
        ? 'Damage is above refurbish range. Send to recycle.'
        : 'High damage detected. Admin should review and choose donate or recycle.',
  };
}

router.post('/', async (req, res, next) => {
  try {
    const { items } = z.object({ items: z.array(CartItemSchema).min(1) }).parse(req.body);
    const purchasedAt = new Date().toISOString();
    const returnDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const purchases = items.map(item => ({
      purchaseId: uuidv4(),
      buyerId: req.user.userId,
      buyerEmail: req.user.email,
      productId: item.productId || (String(item.id).startsWith('demo-') ? String(item.id) : `demo-${item.id}`),
      id: item.id,
      name: item.name,
      category: item.category || 'Product',
      price: item.price,
      quantity: item.quantity,
      purchasedAt,
      returnDeadline,
      status: 'purchased',
      createdAt: purchasedAt,
    }));

    await Promise.all(purchases.map(purchase => store.saveCartPurchase(purchase)));
    res.status(201).json({ purchases, count: purchases.length });
  } catch (err) {
    next(err);
  }
});

router.get('/mine', async (req, res, next) => {
  try {
    const purchases = await store.getCartPurchasesForUser(req.user.userId);
    purchases.sort((a, b) => new Date(b.purchasedAt || 0) - new Date(a.purchasedAt || 0));
    res.json({ purchases, count: purchases.length });
  } catch (err) {
    next(err);
  }
});

router.post('/:purchaseId/return', async (req, res, next) => {
  try {
    const purchase = await store.getCartPurchase(req.params.purchaseId);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    if (purchase.buyerId !== req.user.userId) return res.status(403).json({ error: 'Only the buyer can return this product' });
    if (purchase.status !== 'purchased') return res.status(400).json({ error: 'Product is already returned or resolved' });
    if (Date.now() > new Date(purchase.returnDeadline).getTime()) return res.status(400).json({ error: 'Return window is closed' });

    const inspection = estimateReturnDamage(purchase);
    purchase.status = inspection.disposition === 'refurbish'
      ? 'refurbished'
      : inspection.disposition === 'recycle'
        ? 'recycled'
        : 'admin_review';
    purchase.aiReturnInspection = inspection;
    purchase.returnedAt = new Date().toISOString();

    await store.saveCartPurchase(purchase);
    res.json({ purchase });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/returns', requireAdmin, async (req, res, next) => {
  try {
    const purchases = await store.getReturnedCartPurchases();
    purchases.sort((a, b) => new Date(b.returnedAt || b.updatedAt || 0) - new Date(a.returnedAt || a.updatedAt || 0));
    res.json({ purchases, count: purchases.length });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/returns/:purchaseId/resolve', requireAdmin, async (req, res, next) => {
  try {
    const { disposition } = z.object({ disposition: z.enum(['donate', 'recycle']) }).parse(req.body);
    const purchase = await store.getCartPurchase(req.params.purchaseId);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

    purchase.status = disposition === 'donate' ? 'donated' : 'recycled';
    purchase.adminResolvedAt = new Date().toISOString();
    purchase.adminResolvedBy = req.user.userId;
    await store.saveCartPurchase(purchase);

    res.json({ purchase });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
