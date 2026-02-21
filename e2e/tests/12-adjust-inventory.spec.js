import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestPart, createTestLocation, createTestSupplier, receiveInventoryViaAPI } from '../helpers/api-setup.js';

test.describe('Adjust Inventory', () => {
  let part, location, supplier;

  test.beforeAll(async () => {
    await truncateAllTables();
    part = await createTestPart({ part_number: 'ADJ-PART-001', description: 'Adjust Test Part', cost: 8.00 });
    location = await createTestLocation({ name: 'Adjust Warehouse' });
    supplier = await createTestSupplier({ name: 'Adjust Supplier' });
    await receiveInventoryViaAPI({ partId: part.id, locationId: location.id, supplierId: supplier.id, qty: 10, unitCost: 8.00 });
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('adjust page loads with part and location dropdowns', async ({ page }) => {
    await page.goto('/adjust');

    await expect(page.locator('h1')).toHaveText('Adjust Inventory');
    await expect(page.locator('.card .form-group').filter({ hasText: 'Part' }).locator('select')).toBeVisible();
    await expect(page.locator('.form-group').filter({ hasText: 'Location' }).locator('select')).toBeVisible();
  });

  test('shows current quantity and delta after selecting part and location', async ({ page }) => {
    await page.goto('/adjust');

    await page.locator('.card .form-group').filter({ hasText: 'Part' }).locator('select').selectOption(String(part.id));
    await page.locator('.form-group').filter({ hasText: 'Location' }).locator('select').selectOption(String(location.id));

    // Should show current system quantity
    await expect(page.locator('.form-group').filter({ hasText: 'Current System Quantity' })).toContainText('10');

    // Enter new quantity and see delta
    await page.locator('.form-group').filter({ hasText: 'New Quantity' }).locator('input').fill('7');
    await expect(page.locator('.form-group').filter({ hasText: 'Delta' })).toContainText('-3');
  });

  test('negative adjustment (shortage) succeeds', async ({ page }) => {
    await page.goto('/adjust');

    await page.locator('.card .form-group').filter({ hasText: 'Part' }).locator('select').selectOption(String(part.id));
    await page.locator('.form-group').filter({ hasText: 'Location' }).locator('select').selectOption(String(location.id));
    await page.locator('.form-group').filter({ hasText: 'New Quantity' }).locator('input').fill('7');
    await page.locator('.form-group').filter({ hasText: 'Reason' }).locator('select').selectOption('Physical count');

    // Button should be danger for negative adjustments
    await expect(page.locator('button.btn-danger')).toBeVisible();
    await page.locator('button.btn-danger').click();

    await expect(page.locator('.alert-success')).toBeVisible();
    await expect(page.locator('.alert-success')).toContainText('10');
    await expect(page.locator('.alert-success')).toContainText('7');
    await expect(page.locator('.alert-success')).toContainText('-3');

    // Should show FIFO layers consumed
    const fifoCard = page.locator('.card').filter({ hasText: 'FIFO Layers Consumed' });
    await expect(fifoCard).toBeVisible();
  });

  test('positive adjustment (overage) succeeds', async ({ page }) => {
    await page.goto('/adjust');

    await page.locator('.card .form-group').filter({ hasText: 'Part' }).locator('select').selectOption(String(part.id));
    await page.locator('.form-group').filter({ hasText: 'Location' }).locator('select').selectOption(String(location.id));

    // After previous negative adjustment, current should be 7
    await page.locator('.form-group').filter({ hasText: 'New Quantity' }).locator('input').fill('9');
    await expect(page.locator('.form-group').filter({ hasText: 'Delta' })).toContainText('+2');

    // Unit cost field should appear for positive delta
    await expect(page.locator('.form-group').filter({ hasText: 'Unit Cost' })).toBeVisible();

    await page.locator('.form-group').filter({ hasText: 'Reason' }).locator('select').selectOption('Cycle count correction');

    // Button should be primary for positive adjustments
    await expect(page.locator('button.btn-primary')).toBeVisible();
    await page.locator('button.btn-primary').click();

    await expect(page.locator('.alert-success')).toBeVisible();
    await expect(page.locator('.alert-success')).toContainText('9');
    await expect(page.locator('.alert-success')).toContainText('+2');
  });
});
