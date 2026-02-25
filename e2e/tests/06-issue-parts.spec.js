import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestPart, createTestLocation, createTestSupplier, receiveInventoryViaAPI, selectPart } from '../helpers/api-setup.js';

test.describe('Issue Parts', () => {
  let part, location, supplier;

  test.beforeAll(async () => {
    await truncateAllTables();
    part = await createTestPart({ part_number: 'ISS-PART-001', description: 'Issue Test Part', cost: 12.00 });
    location = await createTestLocation({ name: 'Issue Warehouse' });
    supplier = await createTestSupplier({ name: 'Issue Supplier' });
    // Receive 20 items
    await receiveInventoryViaAPI({ partId: part.id, locationId: location.id, supplierId: supplier.id, qty: 20, unitCost: 12.00 });
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('cascading dropdowns: select part then location', async ({ page }) => {
    await page.goto('/issue');

    // Location dropdown should not be visible initially
    const locationGroup = page.locator('.form-group').filter({ hasText: 'Location' });
    await expect(locationGroup).not.toBeVisible();

    // Select the part
    await selectPart(page, part.part_number);

    // Location dropdown should now appear
    await expect(locationGroup.locator('select')).toBeVisible();

    // Select location
    await locationGroup.locator('select').selectOption(String(location.id));

    // Quantity input should appear
    await expect(page.locator('.form-group').filter({ hasText: /Quantity.*available/ })).toBeVisible();
  });

  test('issue parts successfully', async ({ page }) => {
    await page.goto('/issue');

    // Select part
    await selectPart(page, part.part_number);

    // Select location
    await page.locator('.form-group').filter({ hasText: 'Location' }).locator('select').selectOption(String(location.id));

    // Fill quantity
    await page.locator('.form-group').filter({ hasText: /Quantity.*available/ }).locator('input').fill('3');

    // Fill Issue To
    await page.locator('.form-group').filter({ hasText: 'Issue To' }).locator('input').fill('Bot #42');

    // Select reason
    await page.locator('.form-group').filter({ hasText: 'Reason' }).locator('select').selectOption('Repair');

    // Issue
    await page.getByRole('button', { name: 'Issue Parts' }).click();

    // Should show success alert
    await expect(page.locator('.alert-success')).toBeVisible();
    await expect(page.locator('.alert-success')).toContainText('Issued 3');
    await expect(page.locator('.alert-success')).toContainText('ISS-PART-001');
    await expect(page.locator('.alert-success')).toContainText('Bot #42');
  });

  test('FIFO layers consumed table appears after issue', async ({ page }) => {
    await page.goto('/issue');

    // Issue another set to see the FIFO table
    await selectPart(page, part.part_number);
    await page.locator('.form-group').filter({ hasText: 'Location' }).locator('select').selectOption(String(location.id));
    await page.locator('.form-group').filter({ hasText: /Quantity.*available/ }).locator('input').fill('2');
    await page.locator('.form-group').filter({ hasText: 'Reason' }).locator('select').selectOption('R&D');
    await page.getByRole('button', { name: 'Issue Parts' }).click();

    await expect(page.locator('.alert-success')).toBeVisible();

    // FIFO table should appear
    const fifoCard = page.locator('.card').filter({ hasText: 'FIFO Layers Consumed' });
    await expect(fifoCard).toBeVisible();
    await expect(fifoCard.locator('tbody tr').first()).toBeVisible();
  });

  test('inventory qty updates after issue', async ({ page }) => {
    // Started with 20, issued 3 + 2 = 5, so should have 15
    await page.goto('/');
    await expect(page.locator('.stat-card').filter({ hasText: 'Total Items' }).locator('.value')).toHaveText('15');
  });
});
