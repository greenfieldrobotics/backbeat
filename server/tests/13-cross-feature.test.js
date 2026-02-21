import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createPart, createLocation, createSupplier, receiveInventory, expectCost, dbQuery, assertInventoryConsistency } from './helpers/testHelpers.js';

describe('Cross-Feature Workflow Tests', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  test('12A: Full PO lifecycle → Issue → Valuation', async () => {
    const supplier = await createSupplier({ name: 'WF-A Supplier' });
    const partA = await createPart({ part_number: 'WF-A-PART-A' });
    const partB = await createPart({ part_number: 'WF-A-PART-B' });
    const warehouse = await createLocation({ name: 'WF-A Warehouse', type: 'Warehouse' });

    // 4. Create PO with 2 line items
    const poRes = await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [
        { part_id: partA.id, quantity_ordered: 10, unit_cost: 5.00 },
        { part_id: partB.id, quantity_ordered: 5, unit_cost: 12.00 },
      ],
    });
    expect(poRes.status).toBe(201);
    const po = poRes.body;

    // 5. Update to Ordered
    await request(app).put(`/api/purchase-orders/${po.id}/status`).send({ status: 'Ordered' });

    // 6. Receive all items
    const recRes = await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
      location_id: warehouse.id,
      items: [
        { line_item_id: po.line_items[0].id, quantity_received: 10 },
        { line_item_id: po.line_items[1].id, quantity_received: 5 },
      ],
    });
    expect(recRes.body.po_status).toBe('Closed');

    // 8. Verify inventory
    const invA = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [partA.id, warehouse.id]);
    expect(invA[0].quantity_on_hand).toBe(10);
    const invB = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [partB.id, warehouse.id]);
    expect(invB[0].quantity_on_hand).toBe(5);

    // 9. Verify 2 FIFO layers
    const layers = await dbQuery('SELECT * FROM fifo_layers WHERE remaining_qty > 0');
    expect(layers.length).toBe(2);

    // 10. Issue 3 of Part A
    const issueRes = await request(app).post('/api/inventory/issue').send({
      part_id: partA.id,
      location_id: warehouse.id,
      quantity: 3,
      reason: 'repair',
      target_ref: 'Bot-42',
    });
    expect(issueRes.status).toBe(200);

    // 11-12. Verify Part A inventory and FIFO
    const invA2 = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [partA.id, warehouse.id]);
    expect(invA2[0].quantity_on_hand).toBe(7);
    const layerA = await dbQuery('SELECT * FROM fifo_layers WHERE part_id = $1 AND remaining_qty > 0', [partA.id]);
    expect(layerA[0].remaining_qty).toBe(7);

    // 13-16. Run valuation report
    const valRes = await request(app).get('/api/inventory/valuation');
    const partASummary = valRes.body.summary.find(s => s.part_number === 'WF-A-PART-A');
    expectCost(partASummary.total_value, 35.00); // 7 * 5
    const partBSummary = valRes.body.summary.find(s => s.part_number === 'WF-A-PART-B');
    expectCost(partBSummary.total_value, 60.00); // 5 * 12
    expectCost(valRes.body.grand_total, 95.00);

    // 17. Verify audit trail (2 RECEIVE + 1 ISSUE = 3)
    const txns = await dbQuery(
      'SELECT * FROM inventory_transactions WHERE part_id IN ($1, $2) ORDER BY created_at',
      [partA.id, partB.id]
    );
    expect(txns.length).toBe(3);
    expect(txns.filter(t => t.transaction_type === 'RECEIVE').length).toBe(2);
    expect(txns.filter(t => t.transaction_type === 'ISSUE').length).toBe(1);
  });

  test('12B: Receive → Move → Issue at new location', async () => {
    const part = await createPart({ part_number: 'WF-B-PART' });
    const locA = await createLocation({ name: 'WF-B Loc A', type: 'Warehouse' });
    const locB = await createLocation({ name: 'WF-B Loc B', type: 'Regional Site' });
    const supplier = await createSupplier({ name: 'WF-B Supplier' });

    // Receive 20 @ $8
    await receiveInventory({ part, location: locA, supplier, quantity: 20, unitCost: 8.00 });

    // Move 12 from A to B
    await request(app).post('/api/inventory/move').send({
      part_id: part.id,
      from_location_id: locA.id,
      to_location_id: locB.id,
      quantity: 12,
    });

    // Verify quantities
    const invA = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, locA.id]);
    expect(invA[0].quantity_on_hand).toBe(8);
    const invB = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, locB.id]);
    expect(invB[0].quantity_on_hand).toBe(12);

    // Verify FIFO layers
    const layersA = await dbQuery('SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2 AND remaining_qty > 0', [part.id, locA.id]);
    expect(layersA[0].remaining_qty).toBe(8);
    const layersB = await dbQuery('SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2 AND remaining_qty > 0', [part.id, locB.id]);
    expect(layersB[0].remaining_qty).toBe(12);
    expect(layersB[0].unit_cost).toBe(8.00);

    // Issue 5 from B
    await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: locB.id,
      quantity: 5,
    });

    const invB2 = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, locB.id]);
    expect(invB2[0].quantity_on_hand).toBe(7);

    const layersB2 = await dbQuery('SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2 AND remaining_qty > 0', [part.id, locB.id]);
    expect(layersB2[0].remaining_qty).toBe(7);

    // Valuation
    const valRes = await request(app).get('/api/inventory/valuation');
    const summA = valRes.body.summary.find(s => s.location_name === locA.name);
    expectCost(summA.total_value, 64.00); // 8 * 8
    const summB = valRes.body.summary.find(s => s.location_name === locB.name);
    expectCost(summB.total_value, 56.00); // 7 * 8
    expectCost(valRes.body.grand_total, 120.00);
  });

  test('12C: Multiple receipts → Move → Issue (FIFO across moves)', async () => {
    const part = await createPart({ part_number: 'WF-C-PART' });
    const locA = await createLocation({ name: 'WF-C Loc A', type: 'Warehouse' });
    const locB = await createLocation({ name: 'WF-C Loc B', type: 'Regional Site' });
    const supplier = await createSupplier({ name: 'WF-C Supplier' });

    // 1-2. Receive at A: 5 @ $10, then 5 @ $20
    await receiveInventory({ part, location: locA, supplier, quantity: 5, unitCost: 10.00 });
    await receiveInventory({ part, location: locA, supplier, quantity: 5, unitCost: 20.00 });

    // 3. Move 7 from A to B (takes 5 from Layer 1 + 2 from Layer 2)
    await request(app).post('/api/inventory/move').send({
      part_id: part.id,
      from_location_id: locA.id,
      to_location_id: locB.id,
      quantity: 7,
    });

    // 4. Verify B has 2 layers: 5 @ $10, 2 @ $20
    const layersB = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2 AND remaining_qty > 0 ORDER BY unit_cost',
      [part.id, locB.id]
    );
    expect(layersB.length).toBe(2);
    expect(layersB[0].remaining_qty).toBe(5);
    expect(layersB[0].unit_cost).toBe(10.00);
    expect(layersB[1].remaining_qty).toBe(2);
    expect(layersB[1].unit_cost).toBe(20.00);

    // 5. Issue 6 from B (consumes 5 @ $10 + 1 @ $20)
    const issueRes = await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: locB.id,
      quantity: 6,
    });
    expect(issueRes.status).toBe(200);
    // 6. Cost: (5 * 10) + (1 * 20) = 70
    expectCost(issueRes.body.total_cost, 70.00);

    // 7. B remaining: 1 @ $20 = $20
    const invB = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, locB.id]);
    expect(invB[0].quantity_on_hand).toBe(1);
    const layersB2 = await dbQuery('SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2 AND remaining_qty > 0', [part.id, locB.id]);
    expect(layersB2.length).toBe(1);
    expect(layersB2[0].unit_cost).toBe(20.00);

    // 8. A remaining: 3 @ $20 = $60
    const invA = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, locA.id]);
    expect(invA[0].quantity_on_hand).toBe(3);
    const layersA = await dbQuery('SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2 AND remaining_qty > 0', [part.id, locA.id]);
    expect(layersA.length).toBe(1);
    expect(layersA[0].unit_cost).toBe(20.00);
    expect(layersA[0].remaining_qty).toBe(3);
  });

  test('12D: Dispose after partial issue', async () => {
    const part = await createPart({ part_number: 'WF-D-PART' });
    const warehouse = await createLocation({ name: 'WF-D Warehouse', type: 'Warehouse' });
    const supplier = await createSupplier({ name: 'WF-D Supplier' });

    // 1. Receive 10 @ $15
    await receiveInventory({ part, location: warehouse, supplier, quantity: 10, unitCost: 15.00 });

    // 2. Issue 3 (cost = $45)
    const issueRes = await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: warehouse.id,
      quantity: 3,
    });
    expectCost(issueRes.body.total_cost, 45.00);

    // 3. Dispose 2 (cost = $30)
    const disposeRes = await request(app).post('/api/inventory/dispose').send({
      part_id: part.id,
      location_id: warehouse.id,
      quantity: 2,
      reason: 'damaged',
    });
    expectCost(disposeRes.body.total_cost, 30.00);

    // 4. Remaining: 5 units, one layer
    const inv = await dbQuery('SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2', [part.id, warehouse.id]);
    expect(inv[0].quantity_on_hand).toBe(5);
    const layers = await dbQuery('SELECT * FROM fifo_layers WHERE part_id = $1 AND remaining_qty > 0', [part.id]);
    expect(layers.length).toBe(1);
    expect(layers[0].remaining_qty).toBe(5);

    // 5. Valuation = 5 * 15 = 75
    const valRes = await request(app).get('/api/inventory/valuation');
    expectCost(valRes.body.grand_total, 75.00);

    // 6. Audit trail: RECEIVE, ISSUE, DISPOSE in chronological order
    const txns = await dbQuery(
      'SELECT * FROM inventory_transactions WHERE part_id = $1 ORDER BY created_at',
      [part.id]
    );
    expect(txns.length).toBe(3);
    expect(txns[0].transaction_type).toBe('RECEIVE');
    expect(txns[1].transaction_type).toBe('ISSUE');
    expect(txns[2].transaction_type).toBe('DISPOSE');
  });
});
