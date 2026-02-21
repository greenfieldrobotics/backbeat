import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';

test.describe('Full lifecycle workflow', () => {
  test.beforeAll(async () => {
    await truncateAllTables();
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('complete lifecycle: part → location → supplier → PO → receive → issue → move → dispose → verify', async ({ page }) => {
    // --- Step 1: Create a part ---
    await page.goto('/parts');
    await page.getByRole('button', { name: 'Add Part' }).click();
    let modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await modal.locator('.form-group:has(> label:text-is("Part Number"))').locator('input').fill('LIFE-001');
    await modal.locator('.form-group:has(> label:text-is("Description"))').locator('input').fill('Lifecycle Widget');
    await modal.locator('.form-group:has(> label:text-is("Classification"))').locator('input').fill('Testing');
    await modal.locator('.form-group:has(> label:text-is("Cost"))').locator('input').fill('50.00');
    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'hidden' });
    await expect(page.locator('tbody tr').filter({ hasText: 'LIFE-001' })).toBeVisible();

    // --- Step 2: Create two locations ---
    await page.goto('/locations');
    await page.getByRole('button', { name: 'Add Location' }).click();
    modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await modal.locator('.form-group').filter({ hasText: 'Name' }).locator('input').fill('HQ Warehouse');
    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: 'Add Location' }).click();
    modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await modal.locator('.form-group').filter({ hasText: 'Name' }).locator('input').fill('Field Office');
    await modal.locator('.form-group').filter({ hasText: 'Type' }).locator('select').selectOption('Regional Site');
    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'hidden' });
    await expect(page.locator('tbody tr')).toHaveCount(2);

    // --- Step 3: Create a supplier via API (no UI for suppliers beyond PO modal) ---
    const supplierRes = await fetch('http://localhost:3001/api/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Lifecycle Supplier' }),
    });
    const supplier = await supplierRes.json();

    // Get part and location IDs from API
    const partsRes = await fetch('http://localhost:3001/api/parts');
    const parts = await partsRes.json();
    const part = parts.find(p => p.part_number === 'LIFE-001');

    const locsRes = await fetch('http://localhost:3001/api/locations');
    const locs = await locsRes.json();
    const hqLoc = locs.find(l => l.name === 'HQ Warehouse');
    const fieldLoc = locs.find(l => l.name === 'Field Office');

    // --- Step 4: Create a Purchase Order ---
    await page.goto('/purchase-orders');
    await page.getByRole('button', { name: 'New PO' }).click();
    modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });

    await modal.locator('.form-group').filter({ hasText: 'Supplier' }).locator('select').selectOption(String(supplier.id));
    await modal.locator('input[type="date"]').fill('2026-09-01');

    const lineContainer = modal.locator('div[style*="display: flex"]').first();
    await lineContainer.locator('select').selectOption(String(part.id));
    await lineContainer.locator('input[type="number"]').first().fill('20');
    await lineContainer.locator('input[type="number"]').nth(1).fill('50.00');

    await modal.getByRole('button', { name: 'Create PO' }).click();
    await modal.waitFor({ state: 'hidden' });

    // --- Step 5: Mark as Ordered and Receive ---
    await page.locator('a.table-link').first().click();
    await page.getByRole('button', { name: 'Mark as Ordered' }).click();
    await expect(page.locator('.badge-ordered')).toBeVisible();

    await page.getByRole('button', { name: 'Receive Items' }).click();
    modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await modal.locator('.form-group').filter({ hasText: 'Receiving Location' }).locator('select').selectOption(String(hqLoc.id));
    await modal.locator('td input[type="number"]').fill('20');
    await modal.getByRole('button', { name: 'Confirm Receipt' }).click();
    await modal.waitFor({ state: 'hidden' });
    await expect(page.locator('.alert-success')).toContainText('Closed');

    // --- Step 6: Issue some parts ---
    await page.goto('/issue');
    await page.locator('.card .form-group').filter({ hasText: 'Part' }).locator('select').selectOption(String(part.id));
    await page.locator('.form-group').filter({ hasText: 'Location' }).locator('select').selectOption(String(hqLoc.id));
    await page.locator('.form-group').filter({ hasText: /Quantity.*available/ }).locator('input').fill('5');
    await page.locator('.form-group').filter({ hasText: 'Issue To' }).locator('input').fill('Robot Alpha');
    await page.locator('.form-group').filter({ hasText: 'Reason' }).locator('select').selectOption('New Robot');
    await page.getByRole('button', { name: 'Issue Parts' }).click();
    await expect(page.locator('.alert-success')).toContainText('Issued 5');

    // --- Step 7: Move some inventory ---
    await page.goto('/move');
    await page.locator('.card .form-group').filter({ hasText: 'Part' }).locator('select').selectOption(String(part.id));
    await page.locator('.form-group').filter({ hasText: 'From Location' }).locator('select').selectOption(String(hqLoc.id));
    await page.locator('.form-group').filter({ hasText: 'To Location' }).locator('select').selectOption(String(fieldLoc.id));
    await page.locator('.form-group').filter({ hasText: /Quantity.*available/ }).locator('input').fill('3');
    await page.getByRole('button', { name: 'Move Inventory' }).click();
    await expect(page.locator('.alert-success')).toContainText('Moved 3');

    // --- Step 8: Dispose some inventory ---
    await page.goto('/dispose');
    await page.locator('.card .form-group').filter({ hasText: 'Part' }).locator('select').selectOption(String(part.id));
    await page.locator('.form-group').filter({ hasText: 'Location' }).locator('select').selectOption(String(hqLoc.id));
    await page.locator('.form-group').filter({ hasText: /Quantity.*available/ }).locator('input').fill('2');
    await page.locator('.form-group').filter({ hasText: 'Disposal Reason' }).locator('select').selectOption('Damaged');
    await page.getByRole('button', { name: 'Dispose Inventory' }).click();
    await expect(page.locator('.alert-success')).toContainText('Disposed 2');

    // --- Step 9: Verify inventory dashboard ---
    // Started 20, issued 5, moved 3 (still exists), disposed 2 → 10 at HQ, 3 at Field = 13 total
    await page.goto('/');
    await expect(page.locator('.stat-card').filter({ hasText: 'Total Items' }).locator('.value')).toHaveText('13');
    await expect(page.locator('.stat-card').filter({ hasText: 'Active Locations' }).locator('.value')).toHaveText('2');

    // --- Step 10: Verify valuation ---
    await page.goto('/valuation');
    await expect(page.locator('.stat-card').filter({ hasText: 'Grand Total Value' }).locator('.value')).toContainText('650');
    // 13 items × $50 = $650

    // --- Step 11: Verify audit trail ---
    await page.goto('/transactions');
    // Should have: RECEIVE + ISSUE + MOVE(×2) + DISPOSE = 5 transactions
    // Move creates 2 transactions (from and to)
    const txRows = page.locator('tbody tr');
    const count = await txRows.count();
    expect(count).toBeGreaterThanOrEqual(4);

    // Check for different transaction types
    await expect(page.locator('.badge').filter({ hasText: 'RECEIVE' }).first()).toBeVisible();
    await expect(page.locator('.badge').filter({ hasText: 'ISSUE' }).first()).toBeVisible();
    await expect(page.locator('.badge').filter({ hasText: 'DISPOSE' }).first()).toBeVisible();
  });
});
