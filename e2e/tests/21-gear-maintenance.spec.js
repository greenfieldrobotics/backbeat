import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestAssetType, createTestAssetModel } from '../helpers/api-setup.js';

// Phase 10 — maintenance orders (G6.1) and component wear by model (G6.3), re-scoped
// after Stash went on hold (requirements §1, §7.8). Distinct type names from other Gear
// specs, same reason 20-gear-two-scan-link.spec.js uses its own — asset_types isn't
// truncated between e2e runs, so this suite needs types guaranteed to carry the L3
// capability flag (supports_maintenance) it depends on.
test.describe('Gear — Maintenance', () => {
  let bladeModel;

  test.beforeAll(async () => {
    await truncateAllTables();
    await createTestAssetType({ name: 'Maint Robot', supports_maintenance: true });
    await createTestAssetType({ name: 'Maint Beacon' }); // no supports_maintenance — L3 gate should reject it
    bladeModel = await createTestAssetModel({ manufacturer: 'Acme', model_name: 'E2E Carbide Blade' });
  });

  test.afterAll(async () => {
    await closePool();
  });

  async function addAsset(page, serial, typeLabel) {
    await page.goto('/gear/assets');
    await page.getByRole('button', { name: 'Add Asset' }).click();
    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await modal.locator('.form-group').filter({ hasText: 'Serial Number' }).locator('input').fill(serial);
    await modal.locator('.form-group').filter({ hasText: 'Asset Type' }).locator('select').selectOption({ label: typeLabel });
    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'hidden' });
  }

  test('opens and closes a work order, and the L3 gate rejects a non-maintainable asset', async ({ page }) => {
    await addAsset(page, 'MAINT-901', 'Maint Robot');
    await addAsset(page, 'BEACON-901', 'Maint Beacon');

    await page.goto('/gear/maintenance');
    await expect(page.locator('.page-header h1')).toHaveText('Maintenance');

    await page.getByPlaceholder('Asset serial').fill('MAINT-901');
    await page.getByPlaceholder('Asset serial').press('Enter');
    await expect(page.locator('body')).toContainText('MAINT-901');

    await page.getByPlaceholder('What needs doing').fill('Left drive motor grinding');
    await page.getByPlaceholder('What needs doing').press('Enter');
    await expect(page.locator('body')).toContainText('Left drive motor grinding');
    await expect(page.locator('body')).toContainText('open');

    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.locator('body')).toContainText('in_progress');

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('body')).toContainText('closed');

    await page.getByRole('button', { name: 'Change asset' }).click();
    await page.getByPlaceholder('Asset serial').fill('BEACON-901');
    await page.getByPlaceholder('Asset serial').press('Enter');
    await expect(page.locator('body')).toContainText('BEACON-901');

    await page.getByPlaceholder('What needs doing').fill('Should be rejected');
    await page.getByPlaceholder('What needs doing').press('Enter');
    await expect(page.locator('.alert-error')).toContainText('does not support maintenance');
  });

  test('installs and removes a component against a model, comparable across assets (G6.3)', async ({ page }) => {
    await addAsset(page, 'MAINT-902', 'Maint Robot');

    await page.goto('/gear/maintenance');
    await page.getByPlaceholder('Asset serial').fill('MAINT-902');
    await page.getByPlaceholder('Asset serial').press('Enter');
    await expect(page.locator('body')).toContainText('MAINT-902');

    await page.locator('select').selectOption({ label: 'Acme E2E Carbide Blade' });
    await page.getByPlaceholder('hour reading').fill('120');
    await page.getByPlaceholder('hour reading').press('Enter');
    await expect(page.locator('body')).toContainText('Acme');
    await expect(page.locator('body')).toContainText('E2E Carbide Blade');
    await expect(page.locator('body')).toContainText('120h');

    await page.getByPlaceholder('hours').fill('340');
    await page.getByPlaceholder('condition').fill('Chipped, replaced');
    await page.getByRole('button', { name: 'Remove' }).click();

    await expect(page.locator('body')).toContainText('340');
    await expect(page.locator('body')).toContainText('Chipped, replaced');
    // Once removed, no further remove controls remain for this row.
    await expect(page.getByPlaceholder('hours')).toHaveCount(0);
  });
});
