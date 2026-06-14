const express = require('express');
const { submitReview, getReviewsForUser, getReviewsForTransaction } = require('../services/reviews');
const reputation = require('../services/reputation');

const router = express.Router();

/**
 * POST /api/reviews — Submit a review for a completed transaction
 */
router.post('/', async (req, res, next) => {
  try {
    const { transactionId, rating, title, text } = req.body;
    if (!transactionId) {
      return res.status(400).json({ error: 'transactionId is required' });
    }

    const review = await submitReview(req.user.userId, transactionId, { rating, title, text });
    res.status(201).json(review);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reviews/user/:userId — Get reviews for a user
 */
router.get('/user/:userId', async (req, res, next) => {
  try {
    const reviews = await getReviewsForUser(req.params.userId);
    const rep = await reputation.getScore(req.params.userId);
    res.json({ reviews, ...rep });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reviews/transaction/:txnId — Get reviews for a transaction
 */
router.get('/transaction/:txnId', async (req, res, next) => {
  try {
    const reviews = await getReviewsForTransaction(req.params.txnId);
    res.json({ reviews });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
