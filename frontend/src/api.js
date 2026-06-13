const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api';

function getToken() {
  return localStorage.getItem('auth_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...options.headers,
    },
    ...options,
  };

  const res = await fetch(`${API_BASE}${path}`, config);
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await res.json()
    : { error: 'Backend API is not responding. Start the backend server on port 3000 and try again.' };

  if (!res.ok) {
    if (res.status === 401) {
      // Don't force redirect — just throw so the caller can handle it
      throw new Error(data.error || 'Authentication required');
    }
    throw new Error(data.error || 'Request failed');
  }

  if (!contentType.includes('application/json')) {
    throw new Error(data.error);
  }

  return data;
}

export const api = {
  // Auth
  login: (data) => request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  register: (data) => request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),

  // Products
  submitProduct: (data) => request('/products/submit', { method: 'POST', body: JSON.stringify(data) }),
  getProduct: (id) => request(`/products/${id}`),
  getMyProducts: () => request('/products'),

  // Marketplace
  discoverNearby: (params) => {
    const query = new URLSearchParams(params).toString();
    return request(`/marketplace/nearby?${query}`);
  },
  getMarketStats: () => request('/marketplace/stats'),
  getBatchStatus: () => request('/marketplace/batch-status'),
  getProductDetail: (id) => request(`/marketplace/product/${id}`),

  // Transactions
  reserveProduct: (data) => request('/transactions/reserve', { method: 'POST', body: JSON.stringify(data) }),
  getTransactions: () => request('/transactions'),
  getTransaction: (id) => request(`/transactions/${id}`),
  verifyPickup: (id, otp) => request(`/transactions/${id}/verify-pickup`, { method: 'POST', body: JSON.stringify({ otp }) }),
  completeTransaction: (id) => request(`/transactions/${id}/complete`, { method: 'POST' }),
  cancelTransaction: (id) => request(`/transactions/${id}/cancel`, { method: 'POST' }),

  // Credits
  getBalance: () => request('/credits/balance'),
  getHistory: () => request('/credits/history'),
  redeemCredits: (amount, rewardType) => request('/credits/redeem', { method: 'POST', body: JSON.stringify({ amount, rewardType }) }),
};
