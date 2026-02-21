import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createPart, createLocation, createSupplier, receiveInventory, dbQuery } from './helpers/testHelpers.js';

describe('Transaction Atomicity', () => {
  let part, location, supplier;

  beforeEach(async () => {
    await truncateAllTables();
    part = await createPart({ part_number: 'ATOM-PART' });
    location = await createLocation({ name: 'Atom Warehouse', type: 'Warehouse' });
    supplier = await createSupplier({ name: 'Atom Supplier' });
  });

  test('Issue that would create negative inventory fails atomically', async () => {
    await receiveInventory({ part, location, supplier, quantity: 5, unitCost: 10.00 });

    // Try to issue more than available
    const res = await request(app).post('/api/inventory/issue').send({
      part_id: part.id,
      location_id: location.id,
      quantity: 100,
    });
    expect(res.status).toBe(400);

    // Inventory should be unchanged
    const inv = await dbQuery(
      'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
      [part.id, location.id]
    );
    expect(inv[0].quantity_on_hand).toBe(5);

    // FIFO layers should be unchanged
    const layers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2',
      [part.id, location.id]
    );
    expect(layers[0].remaining_qty).toBe(5);

    // No ISSUE audit record
    const txns = await dbQuery(
      'SELECT * FROM inventory_transactions WHERE part_id = $1 AND transaction_type = $2',
      [part.id, 'ISSUE']
    );
    expect(txns.length).toBe(0);
  });

  test('Move with insufficient inventory fails atomically', async () => {
    const locB = await createLocation({ name: 'Atom Loc B', type: 'Regional Site' });
    await receiveInventory({ part, location, supplier, quantity: 5, unitCost: 10.00 });

    const res = await request(app).post('/api/inventory/move').send({
      part_id: part.id,
      from_location_id: location.id,
      to_location_id: locB.id,
      quantity: 100,
    });
    expect(res.status).toBe(400);

    // Source unchanged
    const inv = await dbQuery(
      'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
      [part.id, location.id]
    );
    expect(inv[0].quantity_on_hand).toBe(5);

    // No layers at destination
    const destLayers = await dbQuery(
      'SELECT * FROM fifo_layers WHERE part_id = $1 AND location_id = $2',
      [part.id, locB.id]
    );
    expect(destLayers.length).toBe(0);

    // No destination inventory
    const destInv = await dbQuery(
      'SELECT * FROM inventory WHERE part_id = $1 AND location_id = $2',
      [part.id, locB.id]
    );
    expect(destInv.length).toBe(0);
  });

  test('Receive with invalid line_item_id rolls back entire batch', async () => {
    const partB = await createPart({ part_number: 'ATOM-PART-B' });

    const poRes = await request(app).post('/api/purchase-orders').send({
      supplier_id: supplier.id,
      line_items: [
        { part_id: part.id, quantity_ordered: 10, unit_cost: 5.00 },
        { part_id: partB.id, quantity_ordered: 5, unit_cost: 8.00 },
      ],
    });
    const po = poRes.body;
    await request(app).put(`/api/purchase-orders/${po.id}/status`).send({ status: 'Ordered' });

    // Try to receive with one valid and one invalid line_item_id
    const res = await request(app).post(`/api/purchase-orders/${po.id}/receive`).send({
      location_id: location.id,
      items: [
        { line_item_id: po.line_items[0].id, quantity_received: 5 },
        { line_item_id: 99999, quantity_received: 3 }, // Invalid
      ],
    });
    expect(res.status).toBe(400);

    // No FIFO layers should exist (rolled back)
    const layers = await dbQuery('SELECT * FROM fifo_layers');
    expect(layers.length).toBe(0);

    // No inventory records
    const inv = await dbQuery('SELECT * FROM inventory');
    expect(inv.length).toBe(0);

    // No audit records for RECEIVE
    const txns = await dbQuery("SELECT * FROM inventory_transactions WHERE transaction_type = 'RECEIVE'");
    expect(txns.length).toBe(0);
  });
});
