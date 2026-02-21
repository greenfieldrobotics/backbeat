const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
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

export const api = {
  // Parts
  getParts: () => request('/parts'),
  getPart: (id) => request(`/parts/${id}`),
  createPart: (data) => request('/parts', { method: 'POST', body: JSON.stringify(data) }),
  updatePart: (id, data) => request(`/parts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePart: (id) => request(`/parts/${id}`, { method: 'DELETE' }),

  // Locations
  getLocations: () => request('/locations'),
  createLocation: (data) => request('/locations', { method: 'POST', body: JSON.stringify(data) }),
  updateLocation: (id, data) => request(`/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLocation: (id) => request(`/locations/${id}`, { method: 'DELETE' }),

  // Suppliers
  getSuppliers: () => request('/suppliers'),
  createSupplier: (data) => request('/suppliers', { method: 'POST', body: JSON.stringify(data) }),

  // Purchase Orders
  getPurchaseOrders: () => request('/purchase-orders'),
  getPurchaseOrder: (id) => request(`/purchase-orders/${id}`),
  createPurchaseOrder: (data) => request('/purchase-orders', { method: 'POST', body: JSON.stringify(data) }),
  updatePOStatus: (id, status) => request(`/purchase-orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  receivePO: (id, data) => request(`/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify(data) }),

  // Inventory
  getInventory: () => request('/inventory'),
  getFifoLayers: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/inventory/fifo-layers${qs ? '?' + qs : ''}`);
  },
  issueParts: (data) => request('/inventory/issue', { method: 'POST', body: JSON.stringify(data) }),
  moveInventory: (data) => request('/inventory/move', { method: 'POST', body: JSON.stringify(data) }),
  disposeInventory: (data) => request('/inventory/dispose', { method: 'POST', body: JSON.stringify(data) }),
  returnParts: (data) => request('/inventory/return', { method: 'POST', body: JSON.stringify(data) }),
  adjustInventory: (data) => request('/inventory/adjust', { method: 'POST', body: JSON.stringify(data) }),
  getTransactions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/inventory/transactions${qs ? '?' + qs : ''}`);
  },
  getValuation: () => request('/inventory/valuation'),
  getValuationCSV: () => request('/inventory/valuation?format=csv', { rawResponse: true }).then(r => r.text()),
};
