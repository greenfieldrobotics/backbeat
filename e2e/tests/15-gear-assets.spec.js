import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestAssetType } from '../helpers/api-setup.js';

// Phase 2 renamed the asset's identity field (asset_tag -> serial_number, now the
// only identity field — there is no more separate "Asset Tag") and replaced the
// free-text Asset Type field with a select backed by /api/gear/asset-types.
test.describe('Gear — Assets CRUD', () => {
  test.beforeAll(async () => {
    await truncateAllTables();
    // asset_types has no default seed data (unlike lifecycle_states), so the type
    // this suite selects in the UI has to exist first.
    await createTestAssetType({ name: 'Robot' });
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('create an asset via modal', async ({ page }) => {
    await page.goto('/gear/assets');
    await expect(page.locator('.page-header h1')).toHaveText('Assets');

    await page.getByRole('button', { name: 'Add Asset' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await expect(modal.locator('h2')).toHaveText('New Asset');

    await modal.locator('.form-group').filter({ hasText: 'Serial Number' }).locator('input').fill('ROBOT-001');
    await modal.locator('.form-group').filter({ hasText: 'Asset Type' }).locator('select').selectOption({ label: 'Robot' });

    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'hidden' });

    const row = page.locator('tbody tr').filter({ hasText: 'ROBOT-001' });
    await expect(row).toContainText('Robot');
    await expect(row).toContainText('Available'); // the create form defaults Status to Available
  });

  test('edit an asset status', async ({ page }) => {
    await page.goto('/gear/assets');
    const row = page.locator('tbody tr').filter({ hasText: 'ROBOT-001' });
    await row.getByRole('button', { name: 'Edit' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await expect(modal.locator('h2')).toHaveText('Edit Asset');

    await modal.locator('.form-group').filter({ hasText: 'Status' }).locator('select').selectOption({ label: 'In Use' });
    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'hidden' });

    await expect(page.locator('tbody tr').filter({ hasText: 'ROBOT-001' })).toContainText('In Use');
  });

  test('duplicate serial number shows error', async ({ page }) => {
    await page.goto('/gear/assets');
    await page.getByRole('button', { name: 'Add Asset' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await modal.locator('.form-group').filter({ hasText: 'Serial Number' }).locator('input').fill('ROBOT-001');
    await modal.locator('.form-group').filter({ hasText: 'Asset Type' }).locator('select').selectOption({ label: 'Robot' });
    await modal.getByRole('button', { name: 'Save' }).click();

    await expect(modal.locator('.alert-error')).toBeVisible();
  });

  test('delete an asset', async ({ page }) => {
    await page.goto('/gear/assets');
    page.on('dialog', dialog => dialog.accept());

    const row = page.locator('tbody tr').filter({ hasText: 'ROBOT-001' });
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(page.locator('tbody')).not.toContainText('ROBOT-001');
  });
});
