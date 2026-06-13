const { store } = require('../db/store');

/**
 * Green Credits Service.
 * Awards credits for sustainable actions and manages tier progression.
 */

const CREDIT_AMOUNTS = {
  sell: 50,
  buy_local: 30,
  buy_refurbished: 30,
  donate: 40,
  recycle: 20,
  avoid_return: 25,
};

const CO2_PER_ACTION = {
  sell: 3.0,
  buy_local: 2.5,
  buy_refurbished: 2.5,
  donate: 2.0,
  recycle: 1.5,
  avoid_return: 4.0,
};

const TIER_THRESHOLDS = {
  bronze: 0,
  silver: 200,
  gold: 500,
  platinum: 1000,
};

function calculateTier(lifetimeEarned) {
  if (lifetimeEarned >= TIER_THRESHOLDS.platinum) return 'platinum';
  if (lifetimeEarned >= TIER_THRESHOLDS.gold) return 'gold';
  if (lifetimeEarned >= TIER_THRESHOLDS.silver) return 'silver';
  return 'bronze';
}

function getNextTierThreshold(currentTier) {
  switch (currentTier) {
    case 'bronze': return TIER_THRESHOLDS.silver;
    case 'silver': return TIER_THRESHOLDS.gold;
    case 'gold': return TIER_THRESHOLDS.platinum;
    case 'platinum': return null;
    default: return TIER_THRESHOLDS.silver;
  }
}

function getTierMultiplier(tier) {
  switch (tier) {
    case 'platinum': return 1.5;
    case 'gold': return 1.3;
    case 'silver': return 1.15;
    default: return 1.0;
  }
}

/**
 * Award credits for a sustainable action.
 * Idempotent: same action+product+user combination only awards once.
 */
async function awardCredits(userId, action) {
  const { actionType, productId, metadata } = action;
  const userCredits = await store.getUserCredits(userId);

  // Idempotency check
  const alreadyAwarded = userCredits.actions.some(
    a => a.userId === userId && a.actionType === actionType && a.productId === productId
  );
  if (alreadyAwarded) {
    return { awarded: 0, reason: 'Credits already awarded for this action', balance: userCredits };
  }

  // Calculate credits
  const baseCredits = CREDIT_AMOUNTS[actionType] || 0;
  const tierMultiplier = getTierMultiplier(userCredits.tier);
  const creditsToAward = Math.round(baseCredits * tierMultiplier);

  // Calculate environmental impact
  const co2Saved = CO2_PER_ACTION[actionType] || 0;

  // Atomic update
  const previousTier = userCredits.tier;
  userCredits.totalCredits += creditsToAward;
  userCredits.lifetimeEarned += creditsToAward;
  userCredits.co2SavedKg += co2Saved;
  userCredits.wasteDivertedKg += (metadata?.weight || 0.5);

  // Update tier
  const newTier = calculateTier(userCredits.lifetimeEarned);
  userCredits.tier = newTier;

  // Record action (keep last 50)
  userCredits.actions.push({
    userId,
    actionType,
    productId,
    creditsAwarded: creditsToAward,
    co2Saved,
    timestamp: new Date().toISOString(),
  });
  if (userCredits.actions.length > 50) {
    userCredits.actions = userCredits.actions.slice(-50);
  }

  await store.saveUserCredits(userCredits);

  // Emit tier change event
  if (previousTier !== newTier) {
    store.emitEvent({
      type: 'TierUp',
      detail: { userId, previousTier, newTier, lifetimeEarned: userCredits.lifetimeEarned },
    });
  }

  return {
    awarded: creditsToAward,
    co2Saved,
    newBalance: userCredits.totalCredits,
    tier: userCredits.tier,
    tierChanged: previousTier !== newTier,
  };
}

/**
 * Get user credit balance.
 */
async function getBalance(userId) {
  const userCredits = await store.getUserCredits(userId);
  const nextThreshold = getNextTierThreshold(userCredits.tier);

  return {
    userId,
    totalCredits: userCredits.totalCredits,
    lifetimeEarned: userCredits.lifetimeEarned,
    lifetimeRedeemed: userCredits.lifetimeRedeemed,
    tier: userCredits.tier,
    co2SavedKg: Math.round(userCredits.co2SavedKg * 100) / 100,
    wasteDivertedKg: Math.round(userCredits.wasteDivertedKg * 100) / 100,
    tierProgress: {
      current: userCredits.lifetimeEarned,
      nextTierAt: nextThreshold,
    },
  };
}

/**
 * Redeem credits.
 */
async function redeemCredits(userId, amount, rewardType) {
  const userCredits = await store.getUserCredits(userId);

  if (amount <= 0) {
    const err = new Error('Redemption amount must be positive');
    err.statusCode = 400;
    throw err;
  }

  if (userCredits.totalCredits < amount) {
    const err = new Error('Insufficient credits');
    err.statusCode = 400;
    throw err;
  }

  userCredits.totalCredits -= amount;
  userCredits.lifetimeRedeemed += amount;
  await store.saveUserCredits(userCredits);

  return {
    redeemed: amount,
    rewardType,
    remainingBalance: userCredits.totalCredits,
  };
}

module.exports = {
  awardCredits,
  getBalance,
  redeemCredits,
  calculateTier,
  CREDIT_AMOUNTS,
  TIER_THRESHOLDS,
};
