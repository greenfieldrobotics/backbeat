import request from 'supertest';
import app from '../src/app.js';
import { query } from '../src/db/connection.js';
import {
  createPart,
  createLocation,
  createSupplier,
  receiveInventory,
} from './helpers/testHelpers.js';

describe('Dashboard API', () => {
  let part, warehouse, regionalSite, supplier;

  beforeAll(async () => {
    part = await createPart({ part_number: `DASH-${Date.now()}` });
    warehouse = await createLocation({ name: `WH-DASH-${Date.now()}`, type: 'Warehouse' });
    regionalSite = await createLocation({ name: `RS-DASH-${Date.now()}`, type: 'Regional Site' });
    supplier = await createSupplier({ name: `SUP-DASH-${Date.now()}` });
  });

  test('returns inventory breakdown by location type', async () => {
    // Receive inventory into the warehouse
    await receiveInventory({
      part, location: warehouse, supplier, quantity: 20, unitCost: 10,
    });

    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.inventory_by_type).toBeDefined();
    expect(Array.isArray(res.body.inventory_by_type)).toBe(true);

    const warehouseEntry = res.body.inventory_by_type.find(r => r.type === 'Warehouse');
    expect(warehouseEntry).toBeDefined();
    expect(Number(warehouseEntry.total_qty)).toBeGreaterThan(0);
  });

  test('returns low-stock alerts when inventory is low', async () => {
    // Create a part with low stock (qty <= 5)
    const lowPart = await createPart({ part_number: `LOW-${Date.now()}` });
    await receiveInventory({
      part: lowPart, location: regionalSite, supplier, quantity: 3, unitCost: 5,
    });

    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.low_stock_alerts).toBeDefined();

    const alert = res.body.low_stock_alerts.find(a => a.part_number === lowPart.part_number);
    expect(alert).toBeDefined();
    expect(alert.quantity_on_hand).toBe(3);
    expect(alert.location_name).toBe(regionalSite.name);
  });

  test('returns empty low-stock alerts when all quantities are > 5', async () => {
    // The warehouse already has 20 items from the first test — check that it's NOT in the low stock list
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);

    const warehouseAlert = res.body.low_stock_alerts.find(
      a => a.part_number === part.part_number && a.location_name === warehouse.name
    );
    expect(warehouseAlert).toBeUndefined();
  });

  test('returns open PO summary (excludes Closed POs)', async () => {
    // Create an open PO (Draft status)
    const openPart = await createPart({ part_number: `OPEN-PO-${Date.now()}` });
    const poRes = await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: openPart.id, quantity_ordered: 50, unit_cost: 25 }],
    });
    expect(poRes.status).toBe(201);

    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.open_purchase_orders).toBeDefined();

    const openPO = res.body.open_purchase_orders.find(po => po.po_number === poRes.body.po_number);
    expect(openPO).toBeDefined();
    expect(openPO.status).toBe('Draft');
    expect(Number(openPO.total_value)).toBe(1250); // 50 * 25
  });

  test('excludes Closed POs from open PO summary', async () => {
    // Create a PO and close it via receive
    const closedPart = await createPart({ part_number: `CLOSED-PO-${Date.now()}` });
    const { po } = await receiveInventory({
      part: closedPart, location: warehouse, supplier, quantity: 10, unitCost: 5,
    });

    // The PO should be Closed after full receipt — verify it's not in open POs
    const res = await request(app).get('/api/dashboard');
    const closedPO = res.body.open_purchase_orders.find(p => p.po_number === po.po_number);
    expect(closedPO).toBeUndefined();
  });
});
