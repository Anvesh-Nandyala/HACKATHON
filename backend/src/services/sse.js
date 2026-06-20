/**
 * Server-Sent Events (SSE) Service — manages open HTTP connections and delivers messages.
 */

const clients = new Map();

function addClient(userId, res) {
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  const userClients = clients.get(userId);
  userClients.add(res);

  // When connection closes, remove the client
  res.on('close', () => {
    userClients.delete(res);
    if (userClients.size === 0) {
      clients.delete(userId);
    }
  });
}

async function sendToUser(userId, notification) {
  const userClients = clients.get(userId);
  if (!userClients || userClients.size === 0) {
    return false; // No active clients
  }

  const payload = `data: ${JSON.stringify(notification)}\n\n`;
  for (const res of userClients) {
    try {
      res.write(payload);
    } catch (err) {
      console.error(`[SSE] Failed to send to a client of ${userId}: ${err.message}`);
    }
  }
  return true; // Delivered via at least one connection
}

module.exports = {
  addClient,
  sendToUser,
};
