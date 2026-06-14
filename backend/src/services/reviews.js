const { v4: uuidv4 } = require('uuid');
const { store } = require('../db/store');

/**
 * Review Service — handles review submission and retrieval.
 */

async function submitReview(reviewerId, transactionId, { rating, title, text }) {
  // Validate fields
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    const err = new Error('Rating must be an integer between 1 and 5');
    err.statusCode = 400;
    throw err;
  }
  if (!title || title.length < 1 || title.length > 100) {
    const err = new Error('Title must be between 1 and 100 characters');
    err.statusCode = 400;
    throw err;
  }
  if (!text || text.length < 1 || text.length > 500) {
    const err = new Error('Review text must be between 1 and 500 characters');
    err.statusCode = 400;
    throw err;
  }

  // Get transaction
  const transaction = await store.getTransaction(transactionId);
  if (!transaction) {
    const err = new Error('Transaction not found');
    err.statusCode = 404;
    throw err;
  }

  // Must be completed
  if (transaction.status !== 'completed') {
    const err = new Error('Transaction is not in a reviewable state');
    err.statusCode = 400;
    throw err;
  }

  // Reviewer must be buyer or seller
  if (transaction.buyerId !== reviewerId && transaction.sellerId !== reviewerId) {
    const err = new Error('You are not a participant in this transaction');
    err.statusCode = 403;
    throw err;
  }

  // Check 30-day window
  const completedAt = new Date(transaction.completedAt || transaction.createdAt);
  const daysSince = (Date.now() - completedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince > 30) {
    const err = new Error('Review window has expired (30 days)');
    err.statusCode = 400;
    throw err;
  }

  // Check duplicate
  const alreadyReviewed = await store.hasUserReviewed(reviewerId, transactionId);
  if (alreadyReviewed) {
    const err = new Error('You have already submitted a review for this transaction');
    err.statusCode = 409;
    throw err;
  }

  // Determine reviewee
  const revieweeId = reviewerId === transaction.buyerId
    ? transaction.sellerId
    : transaction.buyerId;

  const review = {
    reviewId: uuidv4(),
    reviewerId,
    revieweeId,
    transactionId,
    productId: transaction.productId,
    rating,
    title,
    text,
    createdAt: new Date().toISOString(),
  };

  await store.saveReview(review);

  // Trigger reputation recalculation
  try {
    const reputation = require('./reputation');
    await reputation.invalidateScore(revieweeId);
    await reputation.calculateScore(revieweeId);
  } catch (err) {
    console.warn(`[Reviews] Reputation recalculation failed: ${err.message}`);
  }

  return review;
}

async function getReviewsForUser(userId, { limit = 10 } = {}) {
  return store.getReviewsForUser(userId, limit);
}

async function getReviewsForTransaction(transactionId) {
  return store.getReviewsForTransaction(transactionId);
}

async function hasUserReviewed(userId, transactionId) {
  return store.hasUserReviewed(userId, transactionId);
}

module.exports = {
  submitReview,
  getReviewsForUser,
  getReviewsForTransaction,
  hasUserReviewed,
};
