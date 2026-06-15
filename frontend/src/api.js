const API_ROOT = import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_URL || 'http://localhost:8080';
const API_BASE = `${API_ROOT.replace(/\/+$/, '').replace(/\/api$/, '')}/api`;

function getToken() {
  return localStorage.getItem('auth_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const isFormData = options.body instanceof FormData;
  const config = {
    headers: {
      ...(!isFormData && { 'Content-Type': 'application/json' }),
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...options.headers,
    },
    ...options,
  };

  const res = await fetch(`${API_BASE}${path}`, config);
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await res.json()
    : { error: 'Backend API is not responding. Start the backend server on port 8080 and try again.' };

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

async function requestBlob(path) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      ...(token && { 'Authorization': `Bearer ${token}` }),
    },
  });

  if (!res.ok) {
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await res.json()
      : { error: 'Request failed' };
    throw new Error(data.error || 'Request failed');
  }

  return URL.createObjectURL(await res.blob());
}

export const api = {
  // Auth
  login: (data) => request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  register: (data) => request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),

  // Products
  uploadImage: (file) => {
    const formData = new FormData();
    formData.append('image', file);
    return request('/uploads/image', { method: 'POST', body: formData });
  },
  uploadVideo: (file) => {
    const formData = new FormData();
    formData.append('video', file);
    return request('/uploads/video', { method: 'POST', body: formData });
  },
  submitProduct: (data) => request('/products/submit', { method: 'POST', body: JSON.stringify(data) }),
  getProduct: (id) => request(`/products/${id}`),
  getMyProducts: () => request('/products'),

  // Marketplace
  geocodeAddress: (address) => request('/location/geocode', { method: 'POST', body: JSON.stringify({ address }) }),
  discoverNearby: (params) => {
    const query = new URLSearchParams(params).toString();
    return request(`/marketplace/nearby?${query}`);
  },
  getMarketStats: () => request('/marketplace/stats'),
  getBatchStatus: () => request('/marketplace/batch-status'),
  getProductDetail: (id) => request(`/marketplace/product/${id}`),
  getRescueRecommendations: () => request('/recommendations/rescue'),
  getRefurbishedRecommendations: () => request('/recommendations/refurbished'),
  checkReturnRisk: (data) => request('/compatibility/return-risk', { method: 'POST', body: JSON.stringify(data) }),
  checkCompatibility: (data) => request('/compatibility/check', { method: 'POST', body: JSON.stringify(data) }),

  // Transactions
  reserveProduct: (data) => request('/transactions/reserve', { method: 'POST', body: JSON.stringify(data) }),
  getTransactions: () => request('/transactions'),
  getTransaction: (id) => request(`/transactions/${id}`),
  verifyPickup: (id, otp) => request(`/transactions/${id}/verify-pickup`, { method: 'POST', body: JSON.stringify({ otp }) }),
  completeTransaction: (id) => request(`/transactions/${id}/complete`, { method: 'POST' }),
  cancelTransaction: (id) => request(`/transactions/${id}/cancel`, { method: 'POST' }),
  requestReturn: (id, data) => request(`/transactions/${id}/return`, { method: 'POST', body: JSON.stringify(data) }),

  // Cart purchases
  createCartPurchases: (items) => request('/cart-purchases', { method: 'POST', body: JSON.stringify({ items }) }),
  getMyCartPurchases: () => request('/cart-purchases/mine'),
  returnCartPurchase: (id) => request(`/cart-purchases/${id}/return`, { method: 'POST' }),
  getAdminCartReturns: () => request('/cart-purchases/admin/returns'),
  resolveAdminCartReturn: (id, disposition) => request(`/cart-purchases/admin/returns/${id}/resolve`, { method: 'POST', body: JSON.stringify({ disposition }) }),

  // Credits
  getBalance: () => request('/credits/balance'),
  getHistory: () => request('/credits/history'),
  redeemCredits: (amount, rewardType) => request('/credits/redeem', { method: 'POST', body: JSON.stringify({ amount, rewardType }) }),

  // Notifications
  getNotificationSubscriptions: () => request('/notifications/subscriptions'),
  createNotificationSubscription: (data) => request('/notifications/subscriptions', { method: 'POST', body: JSON.stringify(data) }),
  deleteNotificationSubscription: (id) => request(`/notifications/subscriptions/${id}`, { method: 'DELETE' }),
  getNotificationMode: () => request('/notifications/mode'),
  updateNotificationMode: (mode) => request('/notifications/mode', { method: 'PUT', body: JSON.stringify({ mode }) }),

  // Admin
  getAdminStats: () => request('/admin/stats'),
  getAdminProducts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/admin/products${query ? `?${query}` : ''}`);
  },
  getAdminReturns: () => request('/admin/returns'),
  getAdminMediaUrl: (id, kind, index = 0) => requestBlob(`/admin/products/${id}/media/${kind}/${index}`),
  updateAdminProduct: (id, data) => request(`/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  markAdminProductReturned: (id, data) => request(`/admin/products/${id}/return`, { method: 'POST', body: JSON.stringify(data) }),
  resolveAdminReturn: (id, data) => request(`/admin/products/${id}/return-disposition`, { method: 'POST', body: JSON.stringify(data) }),
  deleteAdminProduct: (id) => request(`/admin/products/${id}`, { method: 'DELETE' }),
};
