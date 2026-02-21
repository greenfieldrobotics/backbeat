import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestPart, createTestLocation, createTestSupplier } from '../helpers/api-setup.js';

test.describe('Purchase Orders', () => {
  let part, location, supplier;

  test.beforeAll(async () => {
    await truncateAllTables();
    part = await createTestPart({ part_number: 'PO-PART-001', description: 'PO Test Part', cost: 15.00 });
    location = await createTestLocation({ name: 'PO Test Warehouse' });
    supplier = await createTestSupplier({ name: 'PO Test Supplier' });
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('shows empty state when no POs exist', async ({ page }) => {
    await page.goto('/purchase-orders');
    await expect(page.locator('.empty-state')).toHaveText('No purchase orders yet');
  });

  test('create a purchase order', async ({ page }) => {
    await page.goto('/purchase-orders');
    await page.getByRole('button', { name: 'New PO' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await expect(modal.locator('h2')).toHaveText('New Purchase Order');

    // Select supplier
    await modal.locator('.form-group').filter({ hasText: 'Supplier' }).locator('select').selectOption(String(supplier.id));

    // Set delivery date
    await modal.locator('input[type="date"]').fill('2026-06-15');

    // Fill first line item - Part
    const lineSelects = modal.locator('.form-group select');
    // lineSelects: [0]=supplier, [1]=first line part
    // But line items have their own selects inside flex containers
    const lineContainer = modal.locator('div[style*="display: flex"]').first();
    await lineContainer.locator('select').selectOption(String(part.id));
    await lineContainer.locator('input[type="number"]').first().fill('10');
    await lineContainer.locator('input[type="number"]').nth(1).fill('15.00');

    await modal.getByRole('button', { name: 'Create PO' }).click();
    await modal.waitFor({ state: 'hidden' });

    // PO should appear in the table
    await expect(page.locator('.empty-state')).not.toBeVisible();
    const row = page.locator('tbody tr').first();
    await expect(row).toContainText('PO-');
    await expect(row).toContainText('PO Test Supplier');
    await expect(row.locator('.badge-draft')).toBeVisible();
  });

  test('PO number format is PO-YYYY-NNN', async ({ page }) => {
    await page.goto('/purchase-orders');
    const poLink = page.locator('a.table-link').first();
    const poText = await poLink.textContent();
    expect(poText).toMatch(/^PO-\d{4}-\d{3}$/);
  });

  test('navigate to PO detail page', async ({ page }) => {
    await page.goto('/purchase-orders');
    await page.locator('a.table-link').first().click();

    // Should be on detail page
    await expect(page.locator('.page-header h1')).toContainText('PO-');
    await expect(page.locator('.card')).toContainText('PO Test Supplier');
    await expect(page.locator('.badge-draft')).toBeVisible();

    // Line items table should show the part
    await expect(page.locator('tbody tr').first()).toContainText('PO-PART-001');
    await expect(page.locator('tbody tr').first()).toContainText('10');
    await expect(page.locator('tbody tr').first()).toContainText('$15.00');

    // Draft PO should show "Mark as Ordered" button
    await expect(page.getByRole('button', { name: 'Mark as Ordered' })).toBeVisible();
  });

  test('create PO with multiple line items', async ({ page }) => {
    // Create a second part first
    const part2 = await createTestPart({ part_number: 'PO-PART-002', description: 'Second PO Part', cost: 20.00 });

    await page.goto('/purchase-orders');
    await page.getByRole('button', { name: 'New PO' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });

    await modal.locator('.form-group').filter({ hasText: 'Supplier' }).locator('select').selectOption(String(supplier.id));

    // Fill first line item
    const firstLine = modal.locator('div[style*="display: flex"]').first();
    await firstLine.locator('select').selectOption(String(part.id));
    await firstLine.locator('input[type="number"]').first().fill('5');
    await firstLine.locator('input[type="number"]').nth(1).fill('15.00');

    // Add second line item
    await modal.getByRole('button', { name: '+ Add Line' }).click();
    const secondLine = modal.locator('div[style*="display: flex"]').nth(1);
    await secondLine.locator('select').selectOption(String(part2.id));
    await secondLine.locator('input[type="number"]').first().fill('3');
    await secondLine.locator('input[type="number"]').nth(1).fill('20.00');

    await modal.getByRole('button', { name: 'Create PO' }).click();
    await modal.waitFor({ state: 'hidden' });

    // Should now have 2 POs
    await expect(page.locator('tbody tr')).toHaveCount(2);
  });
});
