import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestPart, createTestLocation, createTestSupplier, receiveInventoryViaAPI, selectPart } from '../helpers/api-setup.js';

test.describe('Move Inventory', () => {
  let part, locationA, locationB, supplier;

  test.beforeAll(async () => {
    await truncateAllTables();
    part = await createTestPart({ part_number: 'MOV-PART-001', description: 'Move Test Part', cost: 8.00 });
    locationA = await createTestLocation({ name: 'Move Source' });
    locationB = await createTestLocation({ name: 'Move Destination' });
    supplier = await createTestSupplier({ name: 'Move Supplier' });
    await receiveInventoryViaAPI({ partId: part.id, locationId: locationA.id, supplierId: supplier.id, qty: 15, unitCost: 8.00 });
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('cascading dropdowns: part → from → to', async ({ page }) => {
    await page.goto('/move');

    // Only Part input should be visible initially
    await expect(page.locator('.card .form-group').filter({ hasText: 'Part' }).locator('.part-search input[type="text"]')).toBeVisible();
    await expect(page.locator('.form-group').filter({ hasText: 'From Location' })).not.toBeVisible();

    // Select part
    await selectPart(page, part.part_number);

    // From Location should appear
    await expect(page.locator('.form-group').filter({ hasText: 'From Location' }).locator('select')).toBeVisible();

    // Select from location
    await page.locator('.form-group').filter({ hasText: 'From Location' }).locator('select').selectOption(String(locationA.id));

    // To Location should appear
    await expect(page.locator('.form-group').filter({ hasText: 'To Location' }).locator('select')).toBeVisible();
  });

  test('move inventory between locations', async ({ page }) => {
    await page.goto('/move');

    await selectPart(page, part.part_number);
    await page.locator('.form-group').filter({ hasText: 'From Location' }).locator('select').selectOption(String(locationA.id));
    await page.locator('.form-group').filter({ hasText: 'To Location' }).locator('select').selectOption(String(locationB.id));
    await page.locator('.form-group').filter({ hasText: /Quantity.*available/ }).locator('input').fill('5');

    await page.getByRole('button', { name: 'Move Inventory' }).click();

    await expect(page.locator('.alert-success')).toBeVisible();
    await expect(page.locator('.alert-success')).toContainText('Moved 5');
    await expect(page.locator('.alert-success')).toContainText('MOV-PART-001');
    await expect(page.locator('.alert-success')).toContainText('Move Source');
    await expect(page.locator('.alert-success')).toContainText('Move Destination');

    // FIFO layers transferred table
    const fifoCard = page.locator('.card').filter({ hasText: 'FIFO Layers Transferred' });
    await expect(fifoCard).toBeVisible();
  });

  test('inventory shows both locations after move', async ({ page }) => {
    await page.goto('/');
    // 10 at source + 5 at destination = 15 total
    await expect(page.locator('.stat-card').filter({ hasText: 'Total Items' }).locator('.value')).toHaveText('15');
    // Should see 2 rows in the Inventory Detail table (one per location)
    // Use Classification column header to distinguish from the Low-Stock Alerts table
    const inventoryTable = page.locator('table').filter({ has: page.locator('th', { hasText: 'Classification' }) });
    await expect(inventoryTable.locator('tbody tr')).toHaveCount(2);
  });
});
