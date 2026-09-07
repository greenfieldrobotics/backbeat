import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestAssetType, createTestLocation } from '../helpers/api-setup.js';

// Phase 9 — scan-to-locate (G3.3): scan an asset, then scan a location, and the asset
// moves. Locations have no printed labels yet (Phase 7 is blocked), so this drives the
// flow the way it's actually usable today: typing what would otherwise be scanned into
// the same fields a hardware scanner feeds (see LocatePage.tsx).
test.describe('Gear — Scan to locate', () => {
  let location;

  test.beforeAll(async () => {
    await truncateAllTables();
    await createTestAssetType({ name: 'Robot' });
    location = await createTestLocation({ name: `Locate Test Site ${Date.now()}` });
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('entering an asset serial then a location moves the asset', async ({ page }) => {
    await page.goto('/gear/assets');
    await page.getByRole('button', { name: 'Add Asset' }).click();
    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await modal.locator('.form-group').filter({ hasText: 'Serial Number' }).locator('input').fill('LOCATE-901');
    await modal.locator('.form-group').filter({ hasText: 'Asset Type' }).locator('select').selectOption({ label: 'Robot' });
    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'hidden' });

    await page.goto('/gear/locate');
    await expect(page.locator('.page-header h1')).toHaveText('Locate');

    await page.getByPlaceholder('Asset serial').fill('LOCATE-901');
    await page.getByPlaceholder('Asset serial').press('Enter');
    await expect(page.locator('body')).toContainText('LOCATE-901');

    await page.getByPlaceholder('Location name').fill(location.name);
    await page.getByPlaceholder('Location name').press('Enter');

    await expect(page.locator('.alert-success')).toContainText('Moved');
    await expect(page.locator('.alert-success')).toContainText(location.name);

    await page.goto('/gear/assets');
    const row = page.locator('tbody tr').filter({ hasText: 'LOCATE-901' });
    await expect(row).toContainText(location.name);
  });

  test('an unknown asset serial shows an error and does not advance', async ({ page }) => {
    await page.goto('/gear/locate');
    await page.getByPlaceholder('Asset serial').fill('NO-SUCH-SERIAL');
    await page.getByPlaceholder('Asset serial').press('Enter');

    await expect(page.locator('.alert-error')).toContainText('No asset found');
    await expect(page.getByPlaceholder('Location name')).toHaveCount(0);
  });
});
