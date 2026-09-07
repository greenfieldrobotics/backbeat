import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestAssetType } from '../helpers/api-setup.js';

// Phase 4 — the asset-history section on the Gear assets page (G3.2).
test.describe('Gear — Asset history', () => {
  test.beforeAll(async () => {
    await truncateAllTables();
    await createTestAssetType({ name: 'Robot' });
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('registering an asset shows a Registered entry in its history', async ({ page }) => {
    await page.goto('/gear/assets');
    await page.getByRole('button', { name: 'Add Asset' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await modal.locator('.form-group').filter({ hasText: 'Serial Number' }).locator('input').fill('HIST-001');
    await modal.locator('.form-group').filter({ hasText: 'Asset Type' }).locator('select').selectOption({ label: 'Robot' });
    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'hidden' });

    const row = page.locator('tbody tr').filter({ hasText: 'HIST-001' });
    await row.getByRole('button', { name: 'History' }).click();

    const historyModal = page.locator('.modal');
    await historyModal.waitFor({ state: 'visible' });
    await expect(historyModal.locator('h2')).toContainText('HIST-001');
    await expect(historyModal.locator('tbody tr')).toHaveCount(1);
    await expect(historyModal.locator('tbody tr').first()).toContainText('registered');
  });

  test('a status change adds a state_changed entry, newest first', async ({ page }) => {
    await page.goto('/gear/assets');
    const row = page.locator('tbody tr').filter({ hasText: 'HIST-001' });
    await row.getByRole('button', { name: 'Edit' }).click();

    const editModal = page.locator('.modal');
    await editModal.waitFor({ state: 'visible' });
    await editModal.locator('.form-group').filter({ hasText: 'Status' }).locator('select').selectOption({ label: 'In Use' });
    await editModal.getByRole('button', { name: 'Save' }).click();
    await editModal.waitFor({ state: 'hidden' });

    await row.getByRole('button', { name: 'History' }).click();
    const historyModal = page.locator('.modal');
    await historyModal.waitFor({ state: 'visible' });

    const rows = historyModal.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('state_changed');
    await expect(rows.first()).toContainText('Available → In Use');
    await expect(rows.last()).toContainText('registered');
  });
});
