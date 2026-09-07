const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'include',
    ...options,
  });

  if (options.rawResponse) return res;

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

// Auth helpers (use /auth prefix, not /api)
export async function getMe() {
  try {
    const res = await fetch('/auth/me', { credentials: 'include' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function logout() {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
}

export const api = {
  // Parts
  getParts: () => request('/stash/parts'),
  getPart: (id) => request(`/stash/parts/${id}`),
  createPart: (data) => request('/stash/parts', { method: 'POST', body: JSON.stringify(data) }),
  updatePart: (id, data) => request(`/stash/parts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePart: (id) => request(`/stash/parts/${id}`, { method: 'DELETE' }),

  // Locations
  getLocations: () => request('/locations'),
  createLocation: (data) => request('/locations', { method: 'POST', body: JSON.stringify(data) }),
  updateLocation: (id, data) => request(`/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLocation: (id) => request(`/locations/${id}`, { method: 'DELETE' }),

  // Suppliers
  getSuppliers: () => request('/stash/suppliers'),
  createSupplier: (data) => request('/stash/suppliers', { method: 'POST', body: JSON.stringify(data) }),

  // Purchase Orders
  getPurchaseOrders: () => request('/stash/purchase-orders'),
  getPurchaseOrder: (id) => request(`/stash/purchase-orders/${id}`),
  createPurchaseOrder: (data) => request('/stash/purchase-orders', { method: 'POST', body: JSON.stringify(data) }),
  updatePOStatus: (id, status) => request(`/stash/purchase-orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  receivePO: (id, data) => request(`/stash/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify(data) }),

  // Inventory
  getInventory: () => request('/stash/inventory'),
  getFifoLayers: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/stash/inventory/fifo-layers${qs ? '?' + qs : ''}`);
  },
  issueParts: (data) => request('/stash/inventory/issue', { method: 'POST', body: JSON.stringify(data) }),
  moveInventory: (data) => request('/stash/inventory/move', { method: 'POST', body: JSON.stringify(data) }),
  disposeInventory: (data) => request('/stash/inventory/dispose', { method: 'POST', body: JSON.stringify(data) }),
  returnParts: (data) => request('/stash/inventory/return', { method: 'POST', body: JSON.stringify(data) }),
  adjustInventory: (data) => request('/stash/inventory/adjust', { method: 'POST', body: JSON.stringify(data) }),
  getTransactions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/stash/inventory/transactions${qs ? '?' + qs : ''}`);
  },
  getValuation: () => request('/stash/inventory/valuation'),
  getValuationCSV: () => request('/stash/inventory/valuation?format=csv', { rawResponse: true }).then(r => r.text()),

  // Dashboard
  getDashboard: () => request('/dashboard'),

  // Users
  getUsers: () => request('/users'),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),

  // Gear — Assets
  getAssets: () => request('/gear/assets'),
  getAsset: (id) => request(`/gear/assets/${id}`),
  createAsset: (data) => request('/gear/assets', { method: 'POST', body: JSON.stringify(data) }),
  updateAsset: (id, data) => request(`/gear/assets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAsset: (id) => request(`/gear/assets/${id}`, { method: 'DELETE' }),

  // Gear — reference data (asset types, lifecycle states are admin-managed vocabularies)
  getAssetTypes: () => request('/gear/asset-types'),
  getLifecycleStates: () => request('/gear/lifecycle-states'),

  // Cross-module workflows (span multiple modules in one transaction)
  commissionAsset: (data) => request('/workflows/commission-asset', { method: 'POST', body: JSON.stringify(data) }),
};
