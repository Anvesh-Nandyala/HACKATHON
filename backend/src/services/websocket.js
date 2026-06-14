const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { store } = require('../db/store');

/**
 * WebSocket Service — manages connections and delivers messages via API Gateway.
 */

const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;
const MAX_CONNECTIONS_PER_USER = 3;

let apigw = null;
function getApiGwClient() {
  if (!WEBSOCKET_ENDPOINT) return null;
  if (!apigw) {
    apigw = new ApiGatewayManagementApiClient({
      region: process.env.AWS_REGION || 'ap-south-2',
      endpoint: WEBSOCKET_ENDPOINT,
    });
  }
  return apigw;
}

async function registerConnection(userId, connectionId) {
  // Check max connections
  const existing = await store.getConnectionsByUser(userId);
  if (existing.length >= MAX_CONNECTIONS_PER_USER) {
    return { error: 'Maximum connection limit reached (3)' };
  }

  await store.saveWebSocketConnection({
    connectionId,
    userId,
    connectedAt: new Date().toISOString(),
    lastPingAt: new Date().toISOString(),
  });
  return { success: true };
}

async function deregisterConnection(connectionId) {
  await store.deleteWebSocketConnection(connectionId);
}

async function getActiveConnections(userId) {
  return store.getConnectionsByUser(userId);
}

async function sendToConnection(connectionId, payload) {
  const client = getApiGwClient();
  if (!client) return false;

  try {
    await client.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(payload)),
    }));
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.name === 'GoneException') {
      // Connection is stale, deregister it
      await deregisterConnection(connectionId);
      return false;
    }
    console.error(`[WebSocket] Send failed for ${connectionId}: ${err.message}`);
    return false;
  }
}

async function isConnected(userId) {
  const connections = await store.getConnectionsByUser(userId);
  return connections.length > 0;
}

function isEnabled() {
  return !!WEBSOCKET_ENDPOINT;
}

module.exports = {
  registerConnection,
  deregisterConnection,
  getActiveConnections,
  sendToConnection,
  isConnected,
  isEnabled,
};
