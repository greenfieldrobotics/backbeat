import { truncateAllTables } from './setup/testSetup.js';
import { request, app, createPart, createLocation, createSupplier, receiveInventory, expectCost } from './helpers/testHelpers.js';

describe('Valuation Report', () => {
  let partX, partY, loc1, loc2, supplier;

  beforeEach(async () => {
    await truncateAllTables();
    partX = await createPart({ part_number: 'VAL-X' });
    partY = await createPart({ part_number: 'VAL-Y' });
    loc1 = await createLocation({ name: 'Valuation Loc 1', type: 'Warehouse' });
    loc2 = await createLocation({ name: 'Valuation Loc 2', type: 'Regional Site' });
    supplier = await createSupplier({ name: 'Valuation Supplier' });
  });

  test('Valuation report with multiple parts and locations', async () => {
    // Part X at Location 1: 10 @ $5, 5 @ $7.50
    await receiveInventory({ part: partX, location: loc1, supplier, quantity: 10, unitCost: 5.00 });
    await receiveInventory({ part: partX, location: loc1, supplier, quantity: 5, unitCost: 7.50 });
    // Part X at Location 2: 3 @ $6.00
    await receiveInventory({ part: partX, location: loc2, supplier, quantity: 3, unitCost: 6.00 });
    // Part Y at Location 1: 20 @ $2.25
    await receiveInventory({ part: partY, location: loc1, supplier, quantity: 20, unitCost: 2.25 });

    const res = await request(app).get('/api/inventory/valuation');
    expect(res.status).toBe(200);

    // Layers
    expect(res.body.layers.length).toBe(4);

    // Summary
    const xLoc1 = res.body.summary.find(s => s.part_number === 'VAL-X' && s.location_name === loc1.name);
    expect(Number(xLoc1.total_qty)).toBe(15);
    expectCost(xLoc1.total_value, 87.50); // (10*5) + (5*7.50)

    const xLoc2 = res.body.summary.find(s => s.part_number === 'VAL-X' && s.location_name === loc2.name);
    expect(Number(xLoc2.total_qty)).toBe(3);
    expectCost(xLoc2.total_value, 18.00);

    const yLoc1 = res.body.summary.find(s => s.part_number === 'VAL-Y' && s.location_name === loc1.name);
    expect(Number(yLoc1.total_qty)).toBe(20);
    expectCost(yLoc1.total_value, 45.00);

    // Grand total
    expectCost(res.body.grand_total, 150.50);
  });

  test('Depleted layers not included in valuation', async () => {
    await receiveInventory({ part: partX, location: loc1, supplier, quantity: 5, unitCost: 10.00 });

    // Issue all 5 units
    await request(app).post('/api/inventory/issue').send({
      part_id: partX.id,
      location_id: loc1.id,
      quantity: 5,
    });

    const res = await request(app).get('/api/inventory/valuation');
    expect(res.status).toBe(200);
    const partXLayers = res.body.layers.filter(l => l.part_number === 'VAL-X');
    expect(partXLayers.length).toBe(0);
  });

  test('CSV export has correct content-type', async () => {
    await receiveInventory({ part: partX, location: loc1, supplier, quantity: 10, unitCost: 5.00 });

    const res = await request(app).get('/api/inventory/valuation?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/filename/);
  });

  test('CSV export has correct header row and grand total', async () => {
    await receiveInventory({ part: partX, location: loc1, supplier, quantity: 10, unitCost: 5.00 });

    const res = await request(app).get('/api/inventory/valuation?format=csv');
    const lines = res.text.split('\n');
    expect(lines[0]).toMatch(/Part Number/);
    expect(lines[0]).toMatch(/Unit Cost/);

    // Grand total row
    const grandTotalLine = lines.find(l => l.includes('Grand Total'));
    expect(grandTotalLine).toBeDefined();
    expect(grandTotalLine).toMatch(/50\.00/);
  });

  test('CSV values match JSON response', async () => {
    await receiveInventory({ part: partX, location: loc1, supplier, quantity: 10, unitCost: 5.00 });

    const jsonRes = await request(app).get('/api/inventory/valuation');
    const csvRes = await request(app).get('/api/inventory/valuation?format=csv');

    expectCost(jsonRes.body.grand_total, 50.00);
    expect(csvRes.text).toMatch(/50\.00/);
  });

  test('Empty valuation report (no inventory)', async () => {
    const res = await request(app).get('/api/inventory/valuation');
    expect(res.status).toBe(200);
    expect(res.body.layers.length).toBe(0);
    expect(res.body.summary.length).toBe(0);
    expect(res.body.grand_total).toBe(0);
  });
});
