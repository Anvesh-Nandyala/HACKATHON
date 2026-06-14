const {
  SQSClient,
  SendMessageCommand,
  GetQueueAttributesCommand,
} = require('@aws-sdk/client-sqs');

/**
 * Queue Service — SQS abstraction for async AI task processing.
 * Enqueues routing and pricing tasks to separate SQS queues.
 * Falls back gracefully when queue URLs are not configured.
 */

const AWS_REGION = process.env.AWS_REGION || 'ap-south-2';
const ROUTING_QUEUE_URL = process.env.ROUTING_QUEUE_URL;
const PRICING_QUEUE_URL = process.env.PRICING_QUEUE_URL;
const ROUTING_DLQ_URL = process.env.ROUTING_DLQ_URL;
const PRICING_DLQ_URL = process.env.PRICING_DLQ_URL;

const sqs = new SQSClient({ region: AWS_REGION });

/**
 * Check if the queue service is enabled (queue URLs configured).
 */
function isEnabled() {
  return !!(ROUTING_QUEUE_URL && PRICING_QUEUE_URL);
}

/**
 * Enqueue a routing task for background processing.
 * @param {string} productId - The product identifier
 * @param {object} payload - Routing parameters (conditionScore, grade, category, etc.)
 * @returns {object|null} - SQS message metadata or null if disabled/failed
 */
async function enqueueRoutingTask(productId, payload) {
  if (!ROUTING_QUEUE_URL) {
    console.warn('[Queue] ROUTING_QUEUE_URL not set, routing task not enqueued');
    return null;
  }

  try {
    const message = {
      type: 'ROUTE_PRODUCT',
      productId,
      payload,
      metadata: {
        enqueuedAt: new Date().toISOString(),
        attempt: 1,
      },
    };

    const result = await sqs.send(new SendMessageCommand({
      QueueUrl: ROUTING_QUEUE_URL,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        productId: { DataType: 'String', StringValue: productId },
        taskType: { DataType: 'String', StringValue: 'routing' },
      },
      // Visibility timeout: 60 seconds for routing tasks
      DelaySeconds: 0,
    }));

    console.log(`[Queue] Routing task enqueued for product ${productId}: ${result.MessageId}`);
    return { messageId: result.MessageId, productId };
  } catch (err) {
    console.error(`[Queue] Failed to enqueue routing task for ${productId}: ${err.message}`);
    return null;
  }
}

/**
 * Enqueue a pricing task for background processing.
 * @param {string} productId - The product identifier
 * @param {object} payload - Pricing parameters (category, brand, originalPrice, etc.)
 * @returns {object|null} - SQS message metadata or null if disabled/failed
 */
async function enqueuePricingTask(productId, payload) {
  if (!PRICING_QUEUE_URL) {
    console.warn('[Queue] PRICING_QUEUE_URL not set, pricing task not enqueued');
    return null;
  }

  try {
    const message = {
      type: 'PRICE_PRODUCT',
      productId,
      payload,
      metadata: {
        enqueuedAt: new Date().toISOString(),
        attempt: 1,
      },
    };

    const result = await sqs.send(new SendMessageCommand({
      QueueUrl: PRICING_QUEUE_URL,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        productId: { DataType: 'String', StringValue: productId },
        taskType: { DataType: 'String', StringValue: 'pricing' },
      },
      DelaySeconds: 0,
    }));

    console.log(`[Queue] Pricing task enqueued for product ${productId}: ${result.MessageId}`);
    return { messageId: result.MessageId, productId };
  } catch (err) {
    console.error(`[Queue] Failed to enqueue pricing task for ${productId}: ${err.message}`);
    return null;
  }
}

/**
 * Get health metrics for all queues (approximate message counts).
 * @returns {object} - Queue health status
 */
async function getQueueHealth() {
  const health = {
    routing: { available: !!ROUTING_QUEUE_URL, messages: null, dlqMessages: null },
    pricing: { available: !!PRICING_QUEUE_URL, messages: null, dlqMessages: null },
  };

  const attributes = ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'];

  // Routing queue
  if (ROUTING_QUEUE_URL) {
    try {
      const result = await sqs.send(new GetQueueAttributesCommand({
        QueueUrl: ROUTING_QUEUE_URL,
        AttributeNames: attributes,
      }));
      health.routing.messages = parseInt(result.Attributes?.ApproximateNumberOfMessages || '0', 10);
      health.routing.inflight = parseInt(result.Attributes?.ApproximateNumberOfMessagesNotVisible || '0', 10);
    } catch (err) {
      console.error(`[Queue] Failed to get routing queue attributes: ${err.message}`);
      health.routing.error = err.message;
    }
  }

  // Routing DLQ
  if (ROUTING_DLQ_URL) {
    try {
      const result = await sqs.send(new GetQueueAttributesCommand({
        QueueUrl: ROUTING_DLQ_URL,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }));
      health.routing.dlqMessages = parseInt(result.Attributes?.ApproximateNumberOfMessages || '0', 10);
      if (health.routing.dlqMessages > 10) {
        console.warn(`[Queue] WARNING: Routing DLQ has ${health.routing.dlqMessages} messages`);
      }
    } catch (err) {
      health.routing.dlqError = err.message;
    }
  }

  // Pricing queue
  if (PRICING_QUEUE_URL) {
    try {
      const result = await sqs.send(new GetQueueAttributesCommand({
        QueueUrl: PRICING_QUEUE_URL,
        AttributeNames: attributes,
      }));
      health.pricing.messages = parseInt(result.Attributes?.ApproximateNumberOfMessages || '0', 10);
      health.pricing.inflight = parseInt(result.Attributes?.ApproximateNumberOfMessagesNotVisible || '0', 10);
    } catch (err) {
      console.error(`[Queue] Failed to get pricing queue attributes: ${err.message}`);
      health.pricing.error = err.message;
    }
  }

  // Pricing DLQ
  if (PRICING_DLQ_URL) {
    try {
      const result = await sqs.send(new GetQueueAttributesCommand({
        QueueUrl: PRICING_DLQ_URL,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }));
      health.pricing.dlqMessages = parseInt(result.Attributes?.ApproximateNumberOfMessages || '0', 10);
      if (health.pricing.dlqMessages > 10) {
        console.warn(`[Queue] WARNING: Pricing DLQ has ${health.pricing.dlqMessages} messages`);
      }
    } catch (err) {
      health.pricing.dlqError = err.message;
    }
  }

  return health;
}

module.exports = {
  isEnabled,
  enqueueRoutingTask,
  enqueuePricingTask,
  getQueueHealth,
};
