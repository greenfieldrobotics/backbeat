const BASE = 'http://localhost:3001/api';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function put(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

/** Create a test part and return the full row */
export async function createTestPart(overrides = {}) {
  return post('/parts', {
    part_number: `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description: 'E2E Test Part',
    classification: 'General',
    unit_of_measure: 'EA',
    cost: 10.00,
    ...overrides,
  });
}

/** Create a test location and return the full row */
export async function createTestLocation(overrides = {}) {
  return post('/locations', {
    name: `Test Location ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'Warehouse',
    ...overrides,
  });
}

/** Create a test supplier and return the full row */
export async function createTestSupplier(overrides = {}) {
  return post('/suppliers', {
    name: `Test Supplier ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...overrides,
  });
}

/**
 * Receive inventory via the PO workflow:
 * 1. Create a PO (Draft)
 * 2. Mark as Ordered
 * 3. Receive all items
 * Returns { po, lineItems } with the created PO data.
 */
export async function receiveInventoryViaAPI({ partId, locationId, supplierId, qty, unitCost }) {
  // Create PO
  const po = await post('/purchase-orders', {
    supplier_id: supplierId,
    expected_delivery_date: '2026-12-31',
    line_items: [{ part_id: partId, quantity_ordered: qty, unit_cost: unitCost }],
  });

  // Mark as Ordered
  await put(`/purchase-orders/${po.id}/status`, { status: 'Ordered' });

  // Receive
  await post(`/purchase-orders/${po.id}/receive`, {
    location_id: locationId,
    items: [{ line_item_id: po.line_items[0].id, quantity_received: qty }],
  });

  return po;
}

/**
 * Return parts to inventory via the API.
 * Returns the response body.
 */
/**
 * Select a part using the PartSearch autocomplete component.
 * Fills the text input and clicks the matching dropdown option.
 */
export async function selectPart(page, partNumber, container) {
  const scope = container || page;
  const partSearch = scope.locator('.part-search').first();
  await partSearch.locator('input[type="text"]').fill(partNumber);
  await partSearch.locator('.part-search-option').filter({ hasText: partNumber }).first().click();
}

export async function returnPartsViaAPI({ partId, locationId, qty, unitCost, reason, reference }) {
  return post('/inventory/return', {
    part_id: partId,
    location_id: locationId,
    quantity: qty,
    unit_cost: unitCost,
    reason: reason || undefined,
    reference: reference || undefined,
  });
}
