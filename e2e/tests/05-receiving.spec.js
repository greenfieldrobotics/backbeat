import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestPart, createTestLocation, createTestSupplier } from '../helpers/api-setup.js';

test.describe('Receiving workflow', () => {
  let part, location, supplier;

  test.beforeAll(async () => {
    await truncateAllTables();
    part = await createTestPart({ part_number: 'RCV-PART-001', description: 'Receive Test Part', cost: 10.00 });
    location = await createTestLocation({ name: 'Receive Warehouse' });
    supplier = await createTestSupplier({ name: 'Receive Supplier' });
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('create PO and mark as Ordered', async ({ page }) => {
    // Create a PO via UI
    await page.goto('/purchase-orders');
    await page.getByRole('button', { name: 'New PO' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });

    await modal.locator('.form-group').filter({ hasText: 'Supplier' }).locator('select').selectOption(String(supplier.id));

    const lineContainer = modal.locator('div[style*="display: flex"]').first();
    await lineContainer.locator('select').selectOption(String(part.id));
    await lineContainer.locator('input[type="number"]').first().fill('10');
    await lineContainer.locator('input[type="number"]').nth(1).fill('10.00');

    await modal.getByRole('button', { name: 'Create PO' }).click();
    await modal.waitFor({ state: 'hidden' });

    // Navigate to PO detail
    await page.locator('a.table-link').first().click();

    // Mark as Ordered
    await page.getByRole('button', { name: 'Mark as Ordered' }).click();

    // Status should change to Ordered
    await expect(page.locator('.badge-ordered')).toBeVisible();
    // "Receive Items" button should appear
    await expect(page.getByRole('button', { name: 'Receive Items' })).toBeVisible();
  });

  test('partial receive', async ({ page }) => {
    await page.goto('/purchase-orders');
    await page.locator('a.table-link').first().click();

    await page.getByRole('button', { name: 'Receive Items' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await expect(modal.locator('h2')).toContainText('Receive Items');

    // Select location
    await modal.locator('.form-group').filter({ hasText: 'Receiving Location' }).locator('select').selectOption(String(location.id));

    // Enter partial quantity (5 out of 10)
    await modal.locator('td input[type="number"]').fill('5');

    await modal.getByRole('button', { name: 'Confirm Receipt' }).click();
    await modal.waitFor({ state: 'hidden' });

    // Success message
    await expect(page.locator('.alert-success')).toContainText('Received successfully');
    await expect(page.locator('.alert-success')).toContainText('Partially Received');

    // Status badge should change
    await expect(page.locator('.badge-partial')).toBeVisible();

    // Line items table should show 5 received
    const lineRow = page.locator('tbody tr').first();
    // Qty Received column (4th column, 0-indexed 3)
    await expect(lineRow.locator('td').nth(3)).toHaveText('5');
  });

  test('full receive closes the PO', async ({ page }) => {
    await page.goto('/purchase-orders');
    await page.locator('a.table-link').first().click();

    await page.getByRole('button', { name: 'Receive Items' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });

    await modal.locator('.form-group').filter({ hasText: 'Receiving Location' }).locator('select').selectOption(String(location.id));

    // Remaining should be 5
    await expect(modal.locator('tbody td').nth(1)).toHaveText('5');
    await modal.locator('td input[type="number"]').fill('5');

    await modal.getByRole('button', { name: 'Confirm Receipt' }).click();
    await modal.waitFor({ state: 'hidden' });

    await expect(page.locator('.alert-success')).toContainText('Closed');
    await expect(page.locator('.badge-closed')).toBeVisible();

    // Receive Items button should be gone
    await expect(page.getByRole('button', { name: 'Receive Items' })).not.toBeVisible();
  });

  test('inventory page shows received items', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.stat-card').filter({ hasText: 'Total Items' }).locator('.value')).toHaveText('10');
    await expect(page.locator('tbody tr').first()).toContainText('RCV-PART-001');
    await expect(page.locator('tbody tr').first()).toContainText('Receive Warehouse');
    await expect(page.locator('tbody tr').first()).toContainText('10');
  });
});
