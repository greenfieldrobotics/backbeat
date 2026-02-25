import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import {
  createTestPart,
  createTestLocation,
  createTestSupplier,
  receiveInventoryViaAPI,
} from '../helpers/api-setup.js';

test.describe('Dashboard / Inventory Overview', () => {
  test.beforeAll(async () => {
    await truncateAllTables();
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('empty state shows zero stat cards and no inventory rows', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.page-header h1')).toHaveText('Inventory Overview');

    // Stat cards should show zeros
    await expect(page.locator('.stat-card').filter({ hasText: 'Total Items' }).locator('.value')).toHaveText('0');
    await expect(page.locator('.stat-card').filter({ hasText: 'Total Value' }).locator('.value')).toHaveText('$0.00');
    await expect(page.locator('.stat-card').filter({ hasText: 'Parts in Stock' }).locator('.value')).toHaveText('0');
    await expect(page.locator('.stat-card').filter({ hasText: 'Active Locations' }).locator('.value')).toHaveText('0');

    // No inventory-by-type section
    await expect(page.locator('h2:has-text("Inventory by Location Type")')).not.toBeVisible();

    // No low-stock alerts
    await expect(page.locator('h2:has-text("Low-Stock Alerts")')).not.toBeVisible();

    // No open POs
    await expect(page.locator('h2:has-text("Open Purchase Orders")')).not.toBeVisible();

    // Empty state message
    await expect(page.locator('.empty-state')).toHaveText('No inventory records yet');
  });

  test('after receiving inventory, stat cards and sections populate', async ({ page }) => {
    // Seed data via API
    const part = await createTestPart({ cost: 15.00 });
    const location = await createTestLocation({ type: 'Warehouse' });
    const supplier = await createTestSupplier();

    await receiveInventoryViaAPI({
      partId: part.id,
      locationId: location.id,
      supplierId: supplier.id,
      qty: 10,
      unitCost: 15.00,
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Stat cards reflect the received inventory
    await expect(page.locator('.stat-card').filter({ hasText: 'Total Items' }).locator('.value')).toHaveText('10');
    await expect(page.locator('.stat-card').filter({ hasText: 'Total Value' }).locator('.value')).toHaveText('$150.00');
    await expect(page.locator('.stat-card').filter({ hasText: 'Parts in Stock' }).locator('.value')).toHaveText('1');
    await expect(page.locator('.stat-card').filter({ hasText: 'Active Locations' }).locator('.value')).toHaveText('1');

    // Inventory by Location Type section appears
    await expect(page.locator('h2:has-text("Inventory by Location Type")')).toBeVisible();
    const warehouseCard = page.locator('.stat-card').filter({ hasText: 'Warehouse' });
    await expect(warehouseCard).toContainText('10 items');
    await expect(warehouseCard).toContainText('$150.00');

    // Inventory detail table has the row
    const detailTable = page.locator('h2:has-text("Inventory Detail") + table');
    await expect(detailTable.locator('tbody tr')).toHaveCount(1);
    await expect(detailTable.locator('tbody tr').first()).toContainText(part.part_number);
    await expect(detailTable.locator('tbody tr').first()).toContainText(location.name);
  });

  test('low-stock alerts display for items at or below threshold', async ({ page }) => {
    // The previous test left 10 items which is above threshold (5).
    // Create a new part with only 2 items — should trigger low-stock.
    const part2 = await createTestPart({ cost: 5.00 });
    const locations = await fetch('http://localhost:3001/api/locations').then(r => r.json());
    const loc = locations[0]; // reuse existing warehouse
    const suppliers = await fetch('http://localhost:3001/api/suppliers').then(r => r.json());
    const sup = suppliers[0];

    await receiveInventoryViaAPI({
      partId: part2.id,
      locationId: loc.id,
      supplierId: sup.id,
      qty: 2,
      unitCost: 5.00,
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Low-stock section should now be visible
    await expect(page.locator('h2:has-text("Low-Stock Alerts")')).toBeVisible();
    // The part with qty=2 should be listed
    const alertTable = page.locator('h2:has-text("Low-Stock Alerts") + table');
    await expect(alertTable.locator('tbody tr').filter({ hasText: part2.part_number })).toBeVisible();
  });

  test('open purchase orders section displays ordered POs', async ({ page }) => {
    // Create a PO and leave it in Ordered status (don't receive)
    const part3 = await createTestPart({ cost: 20.00 });
    const locations = await fetch('http://localhost:3001/api/locations').then(r => r.json());
    const suppliers = await fetch('http://localhost:3001/api/suppliers').then(r => r.json());

    const poRes = await fetch('http://localhost:3001/api/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplier_id: suppliers[0].id,
        expected_delivery_date: '2026-12-31',
        line_items: [{ part_id: part3.id, quantity_ordered: 25, unit_cost: 20.00 }],
      }),
    });
    const po = await poRes.json();

    // Mark as Ordered
    await fetch(`http://localhost:3001/api/purchase-orders/${po.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Ordered' }),
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open POs section should be visible
    await expect(page.locator('h2:has-text("Open Purchase Orders")')).toBeVisible();
    const poTable = page.locator('h2:has-text("Open Purchase Orders") + table');
    await expect(poTable.locator('tbody tr').filter({ hasText: po.po_number })).toBeVisible();
    // Check it shows the supplier, status, and value
    const poRow = poTable.locator('tbody tr').filter({ hasText: po.po_number });
    await expect(poRow).toContainText(suppliers[0].name);
    await expect(poRow).toContainText('Ordered');
    await expect(poRow).toContainText('$500.00');
  });
});
