import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestPart, createTestLocation, createTestSupplier, receiveInventoryViaAPI } from '../helpers/api-setup.js';

test.describe('Valuation & Transactions', () => {
  let part, location, supplier;

  test.beforeAll(async () => {
    await truncateAllTables();
    part = await createTestPart({ part_number: 'VAL-PART-001', description: 'Valuation Test Part', cost: 20.00 });
    location = await createTestLocation({ name: 'Valuation Warehouse' });
    supplier = await createTestSupplier({ name: 'Valuation Supplier' });
    // Receive 10 at $20 each = $200 total
    await receiveInventoryViaAPI({ partId: part.id, locationId: location.id, supplierId: supplier.id, qty: 10, unitCost: 20.00 });
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('valuation page shows stats and summary', async ({ page }) => {
    await page.goto('/valuation');

    // Stat cards
    await expect(page.locator('.stat-card').filter({ hasText: 'Grand Total Value' }).locator('.value')).toContainText('200');
    await expect(page.locator('.stat-card').filter({ hasText: 'Active Layers' }).locator('.value')).toHaveText('1');
    await expect(page.locator('.stat-card').filter({ hasText: 'Parts Valued' }).locator('.value')).toHaveText('1');

    // Summary table
    const summaryCard = page.locator('.card').filter({ hasText: 'Summary by Part & Location' });
    await expect(summaryCard.locator('tbody tr').first()).toContainText('VAL-PART-001');
    await expect(summaryCard.locator('tbody tr').first()).toContainText('Valuation Warehouse');
    await expect(summaryCard.locator('tbody tr').first()).toContainText('10');

    // FIFO layer detail table
    const layerCard = page.locator('.card').filter({ hasText: 'FIFO Layer Detail' });
    await expect(layerCard.locator('tbody tr').first()).toContainText('VAL-PART-001');
    await expect(layerCard.locator('tbody tr').first()).toContainText('$20.00');
  });

  test('Export CSV button is present', async ({ page }) => {
    await page.goto('/valuation');
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  });

  test('transactions page shows RECEIVE transaction', async ({ page }) => {
    await page.goto('/transactions');

    await expect(page.locator('tbody tr')).toHaveCount(1);
    const row = page.locator('tbody tr').first();
    await expect(row).toContainText('VAL-PART-001');
    await expect(row).toContainText('Valuation Warehouse');
    // RECEIVE badge
    await expect(row.locator('.badge')).toContainText('RECEIVE');
    // Positive quantity
    await expect(row).toContainText('+10');
  });

  test('transactions page shows multiple transaction types after operations', async ({ page }) => {
    // Issue some inventory to create an ISSUE transaction
    const issueRes = await fetch('http://localhost:3001/api/inventory/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_id: part.id, location_id: location.id, quantity: 2, reason: 'Repair' }),
    });
    expect(issueRes.ok).toBeTruthy();

    await page.goto('/transactions');

    // Should have 2 transactions now: RECEIVE + ISSUE
    await expect(page.locator('tbody tr')).toHaveCount(2);

    // Most recent transaction (ISSUE) should be first (DESC order by date)
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow.locator('.badge')).toContainText('ISSUE');
  });
});
