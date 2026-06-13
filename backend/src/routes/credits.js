const express = require('express');
const { CreditActionSchema } = require('../validators/schemas');
const { awardCredits, getBalance, redeemCredits } = require('../services/credits');
const { store } = require('../db/store');

const router = express.Router();

/**
 * GET /api/credits/balance
 */
router.get('/balance', async (req, res, next) => {
  try {
    const balance = await getBalance(req.user.userId);
    res.json(balance);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/credits/award
 */
router.post('/award', async (req, res, next) => {
  try {
    const data = CreditActionSchema.parse(req.body);
    const result = await awardCredits(req.user.userId, data);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/credits/redeem
 */
router.post('/redeem', async (req, res, next) => {
  try {
    const { amount, rewardType } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }

    const result = await redeemCredits(req.user.userId, amount, rewardType || 'discount');
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/credits/history
 */
router.get('/history', async (req, res, next) => {
  try {
    const userCredits = await store.getUserCredits(req.user.userId);
    res.json({
      actions: userCredits.actions,
      count: userCredits.actions.length,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
