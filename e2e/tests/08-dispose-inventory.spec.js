import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestPart, createTestLocation, createTestSupplier, receiveInventoryViaAPI } from '../helpers/api-setup.js';

test.describe('Dispose Inventory', () => {
  let part, location, supplier;

  test.beforeAll(async () => {
    await truncateAllTables();
    part = await createTestPart({ part_number: 'DSP-PART-001', description: 'Dispose Test Part', cost: 5.00 });
    location = await createTestLocation({ name: 'Dispose Warehouse' });
    supplier = await createTestSupplier({ name: 'Dispose Supplier' });
    await receiveInventoryViaAPI({ partId: part.id, locationId: location.id, supplierId: supplier.id, qty: 10, unitCost: 5.00 });
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('cascading dropdowns for dispose', async ({ page }) => {
    await page.goto('/dispose');

    await expect(page.locator('.card .form-group').filter({ hasText: 'Part' }).locator('select')).toBeVisible();
    await expect(page.locator('.form-group').filter({ hasText: 'Location' })).not.toBeVisible();

    // Select part
    await page.locator('.card .form-group').filter({ hasText: 'Part' }).locator('select').selectOption(String(part.id));
    await expect(page.locator('.form-group').filter({ hasText: 'Location' }).locator('select')).toBeVisible();
  });

  test('dispose button is disabled without reason', async ({ page }) => {
    await page.goto('/dispose');

    await page.locator('.card .form-group').filter({ hasText: 'Part' }).locator('select').selectOption(String(part.id));
    await page.locator('.form-group').filter({ hasText: 'Location' }).locator('select').selectOption(String(location.id));
    await page.locator('.form-group').filter({ hasText: /Quantity.*available/ }).locator('input').fill('1');

    // Button should be disabled without reason
    await expect(page.getByRole('button', { name: 'Dispose Inventory' })).toBeDisabled();

    // Select reason - button should become enabled
    await page.locator('.form-group').filter({ hasText: 'Disposal Reason' }).locator('select').selectOption('Damaged');
    await expect(page.getByRole('button', { name: 'Dispose Inventory' })).toBeEnabled();
  });

  test('dispose inventory successfully', async ({ page }) => {
    await page.goto('/dispose');

    await page.locator('.card .form-group').filter({ hasText: 'Part' }).locator('select').selectOption(String(part.id));
    await page.locator('.form-group').filter({ hasText: 'Location' }).locator('select').selectOption(String(location.id));
    await page.locator('.form-group').filter({ hasText: /Quantity.*available/ }).locator('input').fill('3');
    await page.locator('.form-group').filter({ hasText: 'Disposal Reason' }).locator('select').selectOption('Damaged');

    await page.getByRole('button', { name: 'Dispose Inventory' }).click();

    await expect(page.locator('.alert-success')).toBeVisible();
    await expect(page.locator('.alert-success')).toContainText('Disposed 3');
    await expect(page.locator('.alert-success')).toContainText('DSP-PART-001');
    await expect(page.locator('.alert-success')).toContainText('Damaged');

    // FIFO layers consumed table
    const fifoCard = page.locator('.card').filter({ hasText: 'FIFO Layers Consumed' });
    await expect(fifoCard).toBeVisible();
  });

  test('inventory qty updates after dispose', async ({ page }) => {
    // Started with 10, disposed 3, should have 7
    await page.goto('/');
    await expect(page.locator('.stat-card').filter({ hasText: 'Total Items' }).locator('.value')).toHaveText('7');
  });
});
