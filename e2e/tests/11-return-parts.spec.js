import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestPart, createTestLocation, createTestSupplier, receiveInventoryViaAPI } from '../helpers/api-setup.js';

test.describe('Return Parts', () => {
  let part, location, supplier;

  test.beforeAll(async () => {
    await truncateAllTables();
    part = await createTestPart({ part_number: 'RET-PART-001', description: 'Return Test Part', cost: 10.00 });
    location = await createTestLocation({ name: 'Return Warehouse' });
    supplier = await createTestSupplier({ name: 'Return Supplier' });
    // Receive some inventory first so we can verify dashboard updates
    await receiveInventoryViaAPI({ partId: part.id, locationId: location.id, supplierId: supplier.id, qty: 10, unitCost: 10.00 });
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('return page loads with part and location dropdowns', async ({ page }) => {
    await page.goto('/return');

    await expect(page.locator('h1')).toHaveText('Return Parts');
    await expect(page.locator('.card .form-group').filter({ hasText: 'Part' }).locator('select')).toBeVisible();
    await expect(page.locator('.form-group').filter({ hasText: 'Location' }).locator('select')).toBeVisible();
  });

  test('return parts form shows additional fields after selecting part and location', async ({ page }) => {
    await page.goto('/return');

    // Select part
    await page.locator('.card .form-group').filter({ hasText: 'Part' }).locator('select').selectOption(String(part.id));
    // Select location
    await page.locator('.form-group').filter({ hasText: 'Location' }).locator('select').selectOption(String(location.id));

    // Quantity and unit cost fields should now be visible
    await expect(page.locator('.form-group').filter({ hasText: 'Quantity' }).locator('input')).toBeVisible();
    await expect(page.locator('.form-group').filter({ hasText: 'Unit Cost' }).locator('input')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Return Parts' })).toBeVisible();
  });

  test('return parts successfully', async ({ page }) => {
    await page.goto('/return');

    await page.locator('.card .form-group').filter({ hasText: 'Part' }).locator('select').selectOption(String(part.id));
    await page.locator('.form-group').filter({ hasText: 'Location' }).locator('select').selectOption(String(location.id));
    await page.locator('.form-group').filter({ hasText: 'Quantity' }).locator('input').fill('3');
    await page.locator('.form-group').filter({ hasText: 'Unit Cost' }).locator('input').fill('10.00');

    await page.getByRole('button', { name: 'Return Parts' }).click();

    await expect(page.locator('.alert-success')).toBeVisible();
    await expect(page.locator('.alert-success')).toContainText('Returned 3');
    await expect(page.locator('.alert-success')).toContainText('RET-PART-001');
    await expect(page.locator('.alert-success')).toContainText('RETURN');
  });
});
