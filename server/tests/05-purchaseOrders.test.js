import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createPart, createLocation, createSupplier, dbQuery } from './helpers/testHelpers.js';

describe('Purchase Orders', () => {
  let supplier, partA, partB, location;

  beforeEach(async () => {
    await truncateAllTables();
    supplier = await createSupplier({ name: 'PO Supplier' });
    partA = await createPart({ part_number: 'PO-PART-A' });
    partB = await createPart({ part_number: 'PO-PART-B' });
    location = await createLocation({ name: 'PO Warehouse', type: 'Warehouse' });
  });

  // --- PO Creation ---

  test('Create PO with one line item', async () => {
    const res = await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: partA.id, quantity_ordered: 10, unit_cost: 5.00 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.po_number).toMatch(/^PO-\d{4}-\d{3}$/);
    expect(res.body.status).toBe('Draft');
    expect(res.body.line_items.length).toBe(1);
    expect(res.body.line_items[0].part_number).toBe('PO-PART-A');
  });

  test('Create PO with multiple line items', async () => {
    const res = await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [
        { part_id: partA.id, quantity_ordered: 10, unit_cost: 5.00 },
        { part_id: partB.id, quantity_ordered: 20, unit_cost: 12.50 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.line_items.length).toBe(2);
  });

  test('PO number auto-increments', async () => {
    const res1 = await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: partA.id, quantity_ordered: 1, unit_cost: 1.00 }],
    });
    const res2 = await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: partA.id, quantity_ordered: 1, unit_cost: 1.00 }],
    });
    const num1 = parseInt(res1.body.po_number.split('-')[2]);
    const num2 = parseInt(res2.body.po_number.split('-')[2]);
    expect(num2).toBe(num1 + 1);
  });

  test('Missing supplier_id returns 400', async () => {
    const res = await request(app).post('/api/purchase-orders').send({
      line_items: [{ part_id: partA.id, quantity_ordered: 1, unit_cost: 1.00 }],
    });
    expect(res.status).toBe(400);
  });

  test('Non-existent supplier returns 400', async () => {
    const res = await request(app).post('/api/purchase-orders').send({
      supplier_id: 99999,
      line_items: [{ part_id: partA.id, quantity_ordered: 1, unit_cost: 1.00 }],
    });
    expect(res.status).toBe(400);
  });

  test('Empty line_items array returns 400', async () => {
    const res = await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [],
    });
    expect(res.status).toBe(400);
  });

  test('Missing line_items returns 400', async () => {
    const res = await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
    });
    expect(res.status).toBe(400);
  });

  test('Line item missing part_id returns 400', async () => {
    const res = await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ quantity_ordered: 10, unit_cost: 5.00 }],
    });
    expect(res.status).toBe(400);
  });

  test('Line item with non-existent part_id returns 400', async () => {
    const res = await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: 99999, quantity_ordered: 10, unit_cost: 5.00 }],
    });
    expect(res.status).toBe(400);
  });

  test('Line item missing quantity_ordered returns 400', async () => {
    const res = await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: partA.id, unit_cost: 5.00 }],
    });
    expect(res.status).toBe(400);
  });

  test('Line item missing unit_cost returns 400', async () => {
    const res = await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: partA.id, quantity_ordered: 10 }],
    });
    expect(res.status).toBe(400);
  });

  // --- PO Status Updates ---

  test('Update status Draft to Ordered', async () => {
    const po = (await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: partA.id, quantity_ordered: 10, unit_cost: 5.00 }],
    })).body;

    const res = await request(app).put(`/api/purchase-orders/${po.id}/status`).send({ status: 'Ordered' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Ordered');
  });

  test('Invalid status value returns 400', async () => {
    const po = (await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: partA.id, quantity_ordered: 10, unit_cost: 5.00 }],
    })).body;

    const res = await request(app).put(`/api/purchase-orders/${po.id}/status`).send({ status: 'Invalid' });
    expect(res.status).toBe(400);
  });

  test('Non-existent PO returns 404', async () => {
    const res = await request(app).put('/api/purchase-orders/99999/status').send({ status: 'Ordered' });
    expect(res.status).toBe(404);
  });

  // --- PO Receiving ---

  test('Receive full quantity - PO becomes Closed', async () => {
    const po = (await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: partA.id, quantity_ordered: 10, unit_cost: 5.00 }],
    })).body;

    await request(app).put(`/api/purchase-orders/${po.id}/status`).send({ status: 'Ordered' });

    const res = await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
      location_id: location.id,
      items: [{ line_item_id: po.line_items[0].id, quantity_received: 10 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.po_status).toBe('Closed');

    // Verify FIFO layer
    const layers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2',
      [partA.id, location.id]
    );
    expect(layers.length).toBe(1);
    expect(layers[0].source_type).toBe('PO_RECEIPT');
    expect(layers[0].source_ref).toBe(po.po_number);
    expect(layers[0].original_qty).toBe(10);
    expect(layers[0].remaining_qty).toBe(10);
    expect(layers[0].unit_cost).toBe(5.00);

    // Verify inventory
    const inv = await dbQuery(
      'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
      [partA.id, location.id]
    );
    expect(inv[0].quantity_on_hand).toBe(10);

    // Verify audit trail
    const txns = await dbQuery(
      'SELECT * FROM inventory_transactions WHERE part_id = $1 AND transaction_type = $2',
      [partA.id, 'RECEIVE']
    );
    expect(txns.length).toBe(1);
  });

  test('Receive partial quantity - PO becomes Partially Received', async () => {
    const po = (await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: partA.id, quantity_ordered: 10, unit_cost: 5.00 }],
    })).body;

    await request(app).put(`/api/purchase-orders/${po.id}/status`).send({ status: 'Ordered' });

    const res = await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
      location_id: location.id,
      items: [{ line_item_id: po.line_items[0].id, quantity_received: 4 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.po_status).toBe('Partially Received');
  });

  test('Receive remainder after partial - PO becomes Closed', async () => {
    const po = (await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: partA.id, quantity_ordered: 10, unit_cost: 5.00 }],
    })).body;

    await request(app).put(`/api/purchase-orders/${po.id}/status`).send({ status: 'Ordered' });

    // Partial receive
    await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
      location_id: location.id,
      items: [{ line_item_id: po.line_items[0].id, quantity_received: 4 }],
    });

    // Receive remainder
    const res = await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
      location_id: location.id,
      items: [{ line_item_id: po.line_items[0].id, quantity_received: 6 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.po_status).toBe('Closed');
  });

  // --- Receiving Validation ---

  test('Receive against Draft PO returns 400', async () => {
    const po = (await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: partA.id, quantity_ordered: 10, unit_cost: 5.00 }],
    })).body;

    const res = await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
      location_id: location.id,
      items: [{ line_item_id: po.line_items[0].id, quantity_received: 5 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Ordered/i);
  });

  test('Receive against Closed PO returns 400', async () => {
    const po = (await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: partA.id, quantity_ordered: 10, unit_cost: 5.00 }],
    })).body;

    await request(app).put(`/api/purchase-orders/${po.id}/status`).send({ status: 'Ordered' });
    await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
      location_id: location.id,
      items: [{ line_item_id: po.line_items[0].id, quantity_received: 10 }],
    });

    const res = await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
      location_id: location.id,
      items: [{ line_item_id: po.line_items[0].id, quantity_received: 1 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/closed/i);
  });

  test('Receive more than remaining returns 400', async () => {
    const po = (await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: partA.id, quantity_ordered: 10, unit_cost: 5.00 }],
    })).body;

    await request(app).put(`/api/purchase-orders/${po.id}/status`).send({ status: 'Ordered' });
    await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
      location_id: location.id,
      items: [{ line_item_id: po.line_items[0].id, quantity_received: 10 }],
    });

    // PO is now Closed, so this should fail
    const res = await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
      location_id: location.id,
      items: [{ line_item_id: po.line_items[0].id, quantity_received: 1 }],
    });
    expect(res.status).toBe(400);
  });

  test('Non-existent location returns 400', async () => {
    const po = (await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: partA.id, quantity_ordered: 10, unit_cost: 5.00 }],
    })).body;
    await request(app).put(`/api/purchase-orders/${po.id}/status`).send({ status: 'Ordered' });

    const res = await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
      location_id: 99999,
      items: [{ line_item_id: po.line_items[0].id, quantity_received: 5 }],
    });
    expect(res.status).toBe(400);
  });

  test('Empty items array returns 400', async () => {
    const po = (await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: partA.id, quantity_ordered: 10, unit_cost: 5.00 }],
    })).body;
    await request(app).put(`/api/purchase-orders/${po.id}/status`).send({ status: 'Ordered' });

    const res = await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
      location_id: location.id,
      items: [],
    });
    expect(res.status).toBe(400);
  });

  test('Missing location_id returns 400', async () => {
    const po = (await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [{ part_id: partA.id, quantity_ordered: 10, unit_cost: 5.00 }],
    })).body;
    await request(app).put(`/api/purchase-orders/${po.id}/status`).send({ status: 'Ordered' });

    const res = await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
      items: [{ line_item_id: po.line_items[0].id, quantity_received: 5 }],
    });
    expect(res.status).toBe(400);
  });

  // --- Multi-Line Receiving ---

  test('Multi-line receiving: partial and full', async () => {
    const partC = await createPart({ part_number: 'PO-PART-C' });
    const po = (await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [
        { part_id: partA.id, quantity_ordered: 10, unit_cost: 5.00 },
        { part_id: partB.id, quantity_ordered: 20, unit_cost: 8.00 },
        { part_id: partC.id, quantity_ordered: 5, unit_cost: 15.00 },
      ],
    })).body;

    await request(app).put(`/api/purchase-orders/${po.id}/status`).send({ status: 'Ordered' });

    // Receive all of line 1 and part of line 2
    const res1 = await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
      location_id: location.id,
      items: [
        { line_item_id: po.line_items[0].id, quantity_received: 10 },
        { line_item_id: po.line_items[1].id, quantity_received: 12 },
      ],
    });
    expect(res1.status).toBe(200);
    expect(res1.body.po_status).toBe('Partially Received');

    // Receive rest of line 2 and all of line 3
    const res2 = await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
      location_id: location.id,
      items: [
        { line_item_id: po.line_items[1].id, quantity_received: 8 },
        { line_item_id: po.line_items[2].id, quantity_received: 5 },
      ],
    });
    expect(res2.status).toBe(200);
    expect(res2.body.po_status).toBe('Closed');

    // Each receipt creates a separate FIFO layer (4 total: 2 receipts for partB, 1 each for A and C)
    const allLayers = await dbQuery('SELECT * FROM fifo_layers ORDER BY id');
    expect(allLayers.length).toBe(4);
  });
});
