import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';

test.describe('Navigation & page structure', () => {
  test.beforeAll(async () => {
    await truncateAllTables();
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('sidebar shows all navigation links', async ({ page }) => {
    await page.goto('/');
    const sidebar = page.locator('nav.sidebar');
    await expect(sidebar).toBeVisible();

    await expect(sidebar.getByRole('link', { name: 'Inventory', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Parts Catalog' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Locations' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Purchase Orders' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Issue Parts' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Move Inventory' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Dispose' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'FIFO Valuation' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Audit Trail' })).toBeVisible();
  });

  test('sidebar shows Backbeat logo and Stash badge', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.logo h2')).toHaveText('Backbeat');
    await expect(page.locator('.module-badge')).toHaveText('Stash');
  });

  test('Inventory page loads with correct heading and empty state', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.page-header h1')).toHaveText('Inventory Overview');
    await expect(page.locator('.empty-state')).toHaveText('No inventory records yet');
    // Stat cards should show zeros
    await expect(page.locator('.stat-card').filter({ hasText: 'Total Items' }).locator('.value')).toHaveText('0');
  });

  test('Parts Catalog page loads with empty state', async ({ page }) => {
    await page.goto('/parts');
    await expect(page.locator('.page-header h1')).toContainText('Parts Catalog');
    await expect(page.locator('.empty-state')).toHaveText('No parts found');
    await expect(page.getByRole('button', { name: 'Add Part' })).toBeVisible();
  });

  test('Locations page loads with correct heading', async ({ page }) => {
    await page.goto('/locations');
    await expect(page.locator('.page-header h1')).toHaveText('Locations');
    await expect(page.getByRole('button', { name: 'Add Location' })).toBeVisible();
  });

  test('Purchase Orders page loads with empty state', async ({ page }) => {
    await page.goto('/purchase-orders');
    await expect(page.locator('.page-header h1')).toHaveText('Purchase Orders');
    await expect(page.locator('.empty-state')).toHaveText('No purchase orders yet');
    await expect(page.getByRole('button', { name: 'New PO' })).toBeVisible();
  });

  test('Issue Parts page loads', async ({ page }) => {
    await page.goto('/issue');
    await expect(page.locator('.page-header h1')).toHaveText('Issue Parts');
  });

  test('Move Inventory page loads', async ({ page }) => {
    await page.goto('/move');
    await expect(page.locator('.page-header h1')).toHaveText('Move Inventory');
  });

  test('Dispose page loads', async ({ page }) => {
    await page.goto('/dispose');
    await expect(page.locator('.page-header h1')).toHaveText('Dispose Inventory');
  });

  test('Audit Trail page loads with empty state', async ({ page }) => {
    await page.goto('/transactions');
    await expect(page.locator('.page-header h1')).toHaveText('Audit Trail');
    await expect(page.locator('.empty-state')).toHaveText('No transactions yet');
  });
});
