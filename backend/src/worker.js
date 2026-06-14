require('dotenv').config();

const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const routingWorker = require('./workers/routingWorker');
const pricingWorker = require('./workers/pricingWorker');

/**
 * Background Worker Entry Point.
 * Polls SQS routing and pricing queues concurrently.
 * Runs as a separate process (EB Worker tier or ECS task).
 *
 * Usage: node src/worker.js
 */

const AWS_REGION = process.env.AWS_REGION || 'ap-south-2';
const ROUTING_QUEUE_URL = process.env.ROUTING_QUEUE_URL;
const PRICING_QUEUE_URL = process.env.PRICING_QUEUE_URL;
const MAX_RECEIVE_COUNT = 3; // After 3 failures, message goes to DLQ

const sqs = new SQSClient({ region: AWS_REGION });

// Metrics tracking (rolling 5-minute window)
const metrics = {
  routing: { processed: 0, totalMs: 0, lastProcessedAt: null },
  pricing: { processed: 0, totalMs: 0, lastProcessedAt: null },
};

let metricsInterval = null;

function startMetricsReset() {
  if (metricsInterval) return;
  metricsInterval = setInterval(() => {
    metrics.routing = { processed: 0, totalMs: 0, lastProcessedAt: metrics.routing.lastProcessedAt };
    metrics.pricing = { processed: 0, totalMs: 0, lastProcessedAt: metrics.pricing.lastProcessedAt };
  }, 5 * 60 * 1000);
  metricsInterval.unref(); // Don't keep process alive
}

/**
 * Poll a single queue and process messages.
 */
async function pollQueue(queueUrl, queueName, worker) {
  if (!queueUrl) return;

  try {
    const result = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 5,
      WaitTimeSeconds: 20, // Long polling
      VisibilityTimeout: queueName === 'routing' ? 60 : 45,
      MessageAttributeNames: ['All'],
    }));

    const messages = result.Messages || [];

    for (const sqsMessage of messages) {
      const startTime = Date.now();
      let success = false;

      try {
        const body = JSON.parse(sqsMessage.Body);
        const receiveCount = parseInt(sqsMessage.Attributes?.ApproximateReceiveCount || '1', 10);

        // If this message has been received too many times, handle as failure
        if (receiveCount >= MAX_RECEIVE_COUNT) {
          console.warn(`[Worker] Message for ${body.productId} exceeded max retries (${receiveCount}), handling failure`);
          await worker.handleFailure(body);
          success = true;
        } else {
          success = await worker.processMessage(body);
        }
      } catch (err) {
        console.error(`[Worker] Error processing ${queueName} message: ${err.message}`);
        success = false;
      }

      // Delete message from queue if processed successfully
      if (success) {
        try {
          await sqs.send(new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: sqsMessage.ReceiptHandle,
          }));
        } catch (delErr) {
          console.error(`[Worker] Failed to delete message: ${delErr.message}`);
        }
      }

      // Track metrics
      const duration = Date.now() - startTime;
      metrics[queueName].processed++;
      metrics[queueName].totalMs += duration;
      metrics[queueName].lastProcessedAt = new Date().toISOString();
    }
  } catch (err) {
    // Don't crash on transient SQS errors
    if (err.name !== 'QueueDoesNotExist') {
      console.error(`[Worker] Poll error for ${queueName}: ${err.message}`);
    } else {
      console.error(`[Worker] Queue "${queueName}" does not exist. Check ROUTING_QUEUE_URL / PRICING_QUEUE_URL`);
    }
  }
}

/**
 * Main polling loop.
 */
async function run() {
  console.log('[Worker] Starting background worker...');
  console.log(`[Worker] Routing queue: ${ROUTING_QUEUE_URL || 'NOT CONFIGURED'}`);
  console.log(`[Worker] Pricing queue: ${PRICING_QUEUE_URL || 'NOT CONFIGURED'}`);

  if (!ROUTING_QUEUE_URL && !PRICING_QUEUE_URL) {
    console.error('[Worker] No queue URLs configured. Set ROUTING_QUEUE_URL and PRICING_QUEUE_URL.');
    process.exit(1);
  }

  startMetricsReset();

  // Poll both queues concurrently in an infinite loop
  while (true) {
    await Promise.all([
      pollQueue(ROUTING_QUEUE_URL, 'routing', routingWorker),
      pollQueue(PRICING_QUEUE_URL, 'pricing', pricingWorker),
    ]);
  }
}

/**
 * Get current worker metrics (for health endpoint).
 */
function getMetrics() {
  return {
    routing: {
      processed: metrics.routing.processed,
      avgMs: metrics.routing.processed > 0
        ? Math.round(metrics.routing.totalMs / metrics.routing.processed)
        : 0,
      lastProcessedAt: metrics.routing.lastProcessedAt,
    },
    pricing: {
      processed: metrics.pricing.processed,
      avgMs: metrics.pricing.processed > 0
        ? Math.round(metrics.pricing.totalMs / metrics.pricing.processed)
        : 0,
      lastProcessedAt: metrics.pricing.lastProcessedAt,
    },
  };
}

module.exports = { run, getMetrics };

// Run if executed directly
if (require.main === module) {
  run().catch(err => {
    console.error('[Worker] Fatal error:', err.message);
    process.exit(1);
  });
}
