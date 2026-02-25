import request from 'supertest';
import app from '../src/app.js';
import { truncateAllTables } from './setup/testSetup.js';
import {
  createPart,
  createLocation,
  createSupplier,
  receiveInventory,
  expectCost,
  dbQuery,
} from './helpers/testHelpers.js';

describe('Dashboard API', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  describe('Response structure', () => {
    test('returns three top-level keys', async () => {
      const res = await request(app).get('/api/dashboard');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('inventory_by_type');
      expect(res.body).toHaveProperty('low_stock_alerts');
      expect(res.body).toHaveProperty('open_purchase_orders');
    });

    test('empty state returns empty arrays without errors', async () => {
      const res = await request(app).get('/api/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.inventory_by_type).toEqual([]);
      expect(res.body.low_stock_alerts).toEqual([]);
      expect(res.body.open_purchase_orders).toEqual([]);
    });
  });

  describe('Inventory by location type', () => {
    test('exact math with multiple parts and locations', async () => {
      const partX = await createPart({ part_number: 'DASH-X' });
      const partY = await createPart({ part_number: 'DASH-Y' });
      const warehouse = await createLocation({ name: 'Dashboard WH', type: 'Warehouse' });
      const regional = await createLocation({ name: 'Dashboard RS', type: 'Regional Site' });
      const cm = await createLocation({ name: 'Dashboard CM', type: 'Contract Manufacturer' });
      const supplier = await createSupplier();

      // Receive 10 units of Part X @ $5.00 at Warehouse
      await receiveInventory({ part: partX, location: warehouse, supplier, quantity: 10, unitCost: 5.00 });
      // Receive 5 units of Part X @ $5.00 at Regional Site
      await receiveInventory({ part: partX, location: regional, supplier, quantity: 5, unitCost: 5.00 });
      // Receive 3 units of Part Y @ $20.00 at Warehouse
      await receiveInventory({ part: partY, location: warehouse, supplier, quantity: 3, unitCost: 20.00 });

      const res = await request(app).get('/api/dashboard');
      expect(res.status).toBe(200);

      const wh = res.body.inventory_by_type.find(r => r.type === 'Warehouse');
      const rs = res.body.inventory_by_type.find(r => r.type === 'Regional Site');
      const cmEntry = res.body.inventory_by_type.find(r => r.type === 'Contract Manufacturer');

      // Warehouse: 10×$5 + 3×$20 = $110
      expect(Number(wh.total_qty)).toBe(13);
      expectCost(wh.total_value, 110.00);

      // Regional Site: 5×$5 = $25
      expect(Number(rs.total_qty)).toBe(5);
      expectCost(rs.total_value, 25.00);

      // Contract Manufacturer: 0
      expect(Number(cmEntry.total_qty)).toBe(0);
      expectCost(cmEntry.total_value, 0);
    });

    test('no double-counting: dashboard totals match valuation report totals', async () => {
      const partA = await createPart({ part_number: 'NODBL-A' });
      const partB = await createPart({ part_number: 'NODBL-B' });
      const warehouse = await createLocation({ name: 'NoDbl WH', type: 'Warehouse' });
      const regional = await createLocation({ name: 'NoDbl RS', type: 'Regional Site' });
      const supplier = await createSupplier();

      // Receive inventory at multiple locations
      await receiveInventory({ part: partA, location: warehouse, supplier, quantity: 20, unitCost: 8.00 });
      await receiveInventory({ part: partB, location: warehouse, supplier, quantity: 5, unitCost: 15.00 });
      await receiveInventory({ part: partA, location: regional, supplier, quantity: 10, unitCost: 8.00 });

      // Issue some from warehouse
      await request(app).post('/api/inventory/issue').send({
        part_id: partA.id, location_id: warehouse.id, quantity: 5, reason: 'test',
      });

      // Move some to regional
      await request(app).post('/api/inventory/move').send({
        part_id: partB.id, from_location_id: warehouse.id, to_location_id: regional.id, quantity: 2,
      });

      // Dispose some
      await request(app).post('/api/inventory/dispose').send({
        part_id: partA.id, location_id: regional.id, quantity: 3, reason: 'test',
      });

      // Get dashboard and valuation
      const [dashRes, valRes] = await Promise.all([
        request(app).get('/api/dashboard'),
        request(app).get('/api/inventory/valuation'),
      ]);

      expect(dashRes.status).toBe(200);
      expect(valRes.status).toBe(200);

      // Sum dashboard totals
      const dashQty = dashRes.body.inventory_by_type.reduce((sum, r) => sum + Number(r.total_qty), 0);
      const dashValue = dashRes.body.inventory_by_type.reduce((sum, r) => sum + Number(r.total_value), 0);

      // Sum inventory table directly
      const [invTotal] = await dbQuery('SELECT COALESCE(SUM(quantity_on_hand), 0) as total FROM inventory');

      // Valuation grand total
      const valTotal = valRes.body.grand_total;

      // Dashboard qty must match inventory table sum
      expect(dashQty).toBe(Number(invTotal.total));

      // Dashboard value must match valuation report grand total
      expectCost(dashValue, valTotal);
    });
  });

  describe('Low stock alerts', () => {
    test('threshold boundary: qty 0, 1, 3, 5, 6', async () => {
      const location = await createLocation({ name: 'LowStock Loc', type: 'Warehouse' });
      const supplier = await createSupplier();

      // Create parts with different quantities
      const partA = await createPart({ part_number: 'LS-A-3' });
      const partB = await createPart({ part_number: 'LS-B-5' });
      const partC = await createPart({ part_number: 'LS-C-6' });
      const partD = await createPart({ part_number: 'LS-D-1' });

      // Receive and issue to get exact quantities
      // Part A: qty=3 (receive 3)
      await receiveInventory({ part: partA, location, supplier, quantity: 3, unitCost: 1 });
      // Part B: qty=5 (receive 5)
      await receiveInventory({ part: partB, location, supplier, quantity: 5, unitCost: 1 });
      // Part C: qty=6 (receive 6)
      await receiveInventory({ part: partC, location, supplier, quantity: 6, unitCost: 1 });
      // Part D: qty=1 (receive 1)
      await receiveInventory({ part: partD, location, supplier, quantity: 1, unitCost: 1 });

      // Part with qty=0: receive 2 then issue 2
      const partE = await createPart({ part_number: 'LS-E-0' });
      await receiveInventory({ part: partE, location, supplier, quantity: 2, unitCost: 1 });
      await request(app).post('/api/inventory/issue').send({
        part_id: partE.id, location_id: location.id, quantity: 2, reason: 'test',
      });

      const res = await request(app).get('/api/dashboard');
      expect(res.status).toBe(200);

      const alerts = res.body.low_stock_alerts;
      const alertParts = alerts.map(a => a.part_number);

      // qty=1 appears
      expect(alertParts).toContain('LS-D-1');
      // qty=3 appears
      expect(alertParts).toContain('LS-A-3');
      // qty=5 appears
      expect(alertParts).toContain('LS-B-5');
      // qty=6 does NOT appear
      expect(alertParts).not.toContain('LS-C-6');
      // qty=0 does NOT appear
      expect(alertParts).not.toContain('LS-E-0');

      // Verify sorted by lowest quantity first
      const ourAlerts = alerts.filter(a => ['LS-D-1', 'LS-A-3', 'LS-B-5'].includes(a.part_number));
      expect(ourAlerts.length).toBe(3);
      expect(ourAlerts[0].part_number).toBe('LS-D-1');
      expect(ourAlerts[0].quantity_on_hand).toBe(1);
      expect(ourAlerts[1].part_number).toBe('LS-A-3');
      expect(ourAlerts[1].quantity_on_hand).toBe(3);
      expect(ourAlerts[2].part_number).toBe('LS-B-5');
      expect(ourAlerts[2].quantity_on_hand).toBe(5);
    });

    test('alert includes part_number, description, location_name, quantity_on_hand', async () => {
      const location = await createLocation({ name: 'Alert Fields Loc', type: 'Warehouse' });
      const supplier = await createSupplier();
      const part = await createPart({ part_number: 'ALERT-FIELDS', description: 'Alert test part' });
      await receiveInventory({ part, location, supplier, quantity: 2, unitCost: 5 });

      const res = await request(app).get('/api/dashboard');
      const alert = res.body.low_stock_alerts.find(a => a.part_number === 'ALERT-FIELDS');
      expect(alert).toBeDefined();
      expect(alert.part_number).toBe('ALERT-FIELDS');
      expect(alert.description).toBe('Alert test part');
      expect(alert.location_name).toBe('Alert Fields Loc');
      expect(alert.quantity_on_hand).toBe(2);
    });
  });

  describe('Open purchase orders', () => {
    test('multi-line PO aggregation math', async () => {
      const supplier = await createSupplier();
      const partA = await createPart({ part_number: 'PO-AGG-A' });
      const partB = await createPart({ part_number: 'PO-AGG-B' });
      const partC = await createPart({ part_number: 'PO-AGG-C' });

      // Create PO with 3 line items: 10@$5, 20@$8, 5@$15
      const poRes = await request(app).post('/api/purchase-orders').send({
        supplier_id: supplier.id,
        line_items: [
          { part_id: partA.id, quantity_ordered: 10, unit_cost: 5 },
          { part_id: partB.id, quantity_ordered: 20, unit_cost: 8 },
          { part_id: partC.id, quantity_ordered: 5, unit_cost: 15 },
        ],
      });
      expect(poRes.status).toBe(201);

      const res = await request(app).get('/api/dashboard');
      const openPO = res.body.open_purchase_orders.find(po => po.po_number === poRes.body.po_number);
      expect(openPO).toBeDefined();

      // total_value = (10×5) + (20×8) + (5×15) = 50+160+75 = 285
      expectCost(openPO.total_value, 285);
      // total_qty_ordered = 10+20+5 = 35
      expect(Number(openPO.total_qty_ordered)).toBe(35);
      // total_qty_received = 0
      expect(Number(openPO.total_qty_received)).toBe(0);
    });

    test('partial receipt updates total_qty_received', async () => {
      const supplier = await createSupplier();
      const part = await createPart({ part_number: 'PO-PARTIAL' });
      const location = await createLocation({ name: 'PO Partial Loc', type: 'Warehouse' });

      const poRes = await request(app).post('/api/purchase-orders').send({
        supplier_id: supplier.id,
        line_items: [{ part_id: part.id, quantity_ordered: 20, unit_cost: 10 }],
      });
      await request(app).put(`/api/purchase-orders/${poRes.body.id}/status`).send({ status: 'Ordered' });

      // Partial receive
      await request(app).post(`/api/purchase-orders/${poRes.body.id}/receive`).send({
        location_id: location.id,
        items: [{ line_item_id: poRes.body.line_items[0].id, quantity_received: 8 }],
      });

      const res = await request(app).get('/api/dashboard');
      const openPO = res.body.open_purchase_orders.find(po => po.po_number === poRes.body.po_number);
      expect(openPO).toBeDefined();
      expect(openPO.status).toBe('Partially Received');
      expect(Number(openPO.total_qty_received)).toBe(8);
      expect(Number(openPO.total_qty_ordered)).toBe(20);
    });

    test('closed PO excluded from open PO list', async () => {
      const supplier = await createSupplier();
      const part = await createPart({ part_number: 'PO-CLOSED' });
      const location = await createLocation({ name: 'PO Closed Loc', type: 'Warehouse' });

      const { po } = await receiveInventory({ part, location, supplier, quantity: 10, unitCost: 5 });

      const res = await request(app).get('/api/dashboard');
      const closedPO = res.body.open_purchase_orders.find(p => p.po_number === po.po_number);
      expect(closedPO).toBeUndefined();
    });
  });

  describe('Dashboard after transactions', () => {
    let partA, warehouse, regional, supplier;

    beforeEach(async () => {
      await truncateAllTables();
      partA = await createPart({ part_number: 'DASH-TXN' });
      warehouse = await createLocation({ name: 'Dash WH', type: 'Warehouse' });
      regional = await createLocation({ name: 'Dash RS', type: 'Regional Site' });
      supplier = await createSupplier();
      // Start with 20 units @ $10 at Warehouse
      await receiveInventory({ part: partA, location: warehouse, supplier, quantity: 20, unitCost: 10.00 });
    });

    test('after issue: totals decrease', async () => {
      // Before
      let res = await request(app).get('/api/dashboard');
      const whBefore = res.body.inventory_by_type.find(r => r.type === 'Warehouse');
      expect(Number(whBefore.total_qty)).toBe(20);
      expectCost(whBefore.total_value, 200);

      // Issue 5
      await request(app).post('/api/inventory/issue').send({
        part_id: partA.id, location_id: warehouse.id, quantity: 5, reason: 'test',
      });

      res = await request(app).get('/api/dashboard');
      const whAfter = res.body.inventory_by_type.find(r => r.type === 'Warehouse');
      expect(Number(whAfter.total_qty)).toBe(15);
      expectCost(whAfter.total_value, 150);
    });

    test('after move: location-type totals shift, grand total same', async () => {
      // Move 8 from Warehouse to Regional Site
      await request(app).post('/api/inventory/move').send({
        part_id: partA.id, from_location_id: warehouse.id, to_location_id: regional.id, quantity: 8,
      });

      const res = await request(app).get('/api/dashboard');
      const wh = res.body.inventory_by_type.find(r => r.type === 'Warehouse');
      const rs = res.body.inventory_by_type.find(r => r.type === 'Regional Site');

      expect(Number(wh.total_qty)).toBe(12);
      expect(Number(rs.total_qty)).toBe(8);
      // Grand total unchanged: 12+8 = 20
      const totalQty = res.body.inventory_by_type.reduce((sum, r) => sum + Number(r.total_qty), 0);
      expect(totalQty).toBe(20);
    });

    test('after dispose: totals decrease', async () => {
      await request(app).post('/api/inventory/dispose').send({
        part_id: partA.id, location_id: warehouse.id, quantity: 3, reason: 'damaged',
      });

      const res = await request(app).get('/api/dashboard');
      const wh = res.body.inventory_by_type.find(r => r.type === 'Warehouse');
      expect(Number(wh.total_qty)).toBe(17);
      expectCost(wh.total_value, 170);
    });

    test('after return: totals increase', async () => {
      await request(app).post('/api/inventory/return').send({
        part_id: partA.id, location_id: warehouse.id, quantity: 5, unit_cost: 10.00,
      });

      const res = await request(app).get('/api/dashboard');
      const wh = res.body.inventory_by_type.find(r => r.type === 'Warehouse');
      expect(Number(wh.total_qty)).toBe(25);
      expectCost(wh.total_value, 250);
    });

    test('after adjustment: totals change by delta', async () => {
      // Adjust down from 20 to 14 (delta = -6)
      await request(app).post('/api/inventory/adjust').send({
        part_id: partA.id, location_id: warehouse.id, new_quantity: 14, reason: 'count',
      });

      const res = await request(app).get('/api/dashboard');
      const wh = res.body.inventory_by_type.find(r => r.type === 'Warehouse');
      expect(Number(wh.total_qty)).toBe(14);
      expectCost(wh.total_value, 140);
    });

    test('issue creates low-stock alert', async () => {
      // Issue 17 of 20 → leaves 3, which is ≤ 5
      await request(app).post('/api/inventory/issue').send({
        part_id: partA.id, location_id: warehouse.id, quantity: 17, reason: 'test',
      });

      const res = await request(app).get('/api/dashboard');
      const alert = res.body.low_stock_alerts.find(a => a.part_number === 'DASH-TXN');
      expect(alert).toBeDefined();
      expect(alert.quantity_on_hand).toBe(3);
    });
  });
});
