const express = require('express');
const queue = require('../services/queue');
const cache = require('../services/cache');

const router = express.Router();

/**
 * GET /api/health/queues — Detailed queue metrics
 */
router.get('/queues', async (req, res, next) => {
  try {
    const queueHealth = await queue.getQueueHealth();

    // Get worker metrics if available
    let workerMetrics = { routing: { processed: 0, avgMs: 0 }, pricing: { processed: 0, avgMs: 0 } };
    try {
      const worker = require('../worker');
      workerMetrics = worker.getMetrics();
    } catch (e) { /* worker not loaded in main process */ }

    res.json({
      queues: queueHealth,
      workerMetrics,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
