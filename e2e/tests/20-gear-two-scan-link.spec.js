import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestAssetType } from '../helpers/api-setup.js';

// Phase 9 — two-scan linking (G5.2): scan a child asset, then scan its parent, to open
// a dated link (G5.1). Distinct type names from other Gear specs ('Robot'/'Battery' are
// already used elsewhere without supports_linking, and asset_types is never truncated
// between e2e runs — see api-setup.js) so this suite is guaranteed types that actually
// have the L2 capability flag set.
test.describe('Gear — Two-scan link', () => {
  test.beforeAll(async () => {
    await truncateAllTables();
    await createTestAssetType({ name: 'Link Robot', supports_linking: true });
    await createTestAssetType({ name: 'Link Battery', supports_linking: true });
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

  test('scanning a child then a parent opens a link', async ({ page }) => {
    await addAsset(page, 'BATT-901', 'Link Battery');
    await addAsset(page, 'ROBOT-901', 'Link Robot');

    await page.goto('/gear/link');
    await expect(page.locator('.page-header h1')).toHaveText('Link');

    await page.getByPlaceholder('Child serial (e.g. the battery)').fill('BATT-901');
    await page.getByPlaceholder('Child serial (e.g. the battery)').press('Enter');
    await expect(page.locator('body')).toContainText('BATT-901');

    await page.getByPlaceholder('Parent serial (e.g. the robot)').fill('ROBOT-901');
    await page.getByPlaceholder('Parent serial (e.g. the robot)').press('Enter');

    await expect(page.locator('.alert-success')).toContainText('Linked');
    await expect(page.locator('.alert-success')).toContainText('BATT-901');
    await expect(page.locator('.alert-success')).toContainText('ROBOT-901');
  });

  test('linking a child that already has an open link 409s, with a way to close and retry', async ({ page }) => {
    await addAsset(page, 'BATT-902', 'Link Battery');
    await addAsset(page, 'ROBOT-902', 'Link Robot');
    await addAsset(page, 'ROBOT-903', 'Link Robot');

    await page.goto('/gear/link');
    await page.getByPlaceholder('Child serial (e.g. the battery)').fill('BATT-902');
    await page.getByPlaceholder('Child serial (e.g. the battery)').press('Enter');
    await page.getByPlaceholder('Parent serial (e.g. the robot)').fill('ROBOT-902');
    await page.getByPlaceholder('Parent serial (e.g. the robot)').press('Enter');
    await expect(page.locator('.alert-success')).toContainText('Linked');

    // Same child, a different parent — the still-open first link must be rejected.
    await page.goto('/gear/link');
    await page.getByPlaceholder('Child serial (e.g. the battery)').fill('BATT-902');
    await page.getByPlaceholder('Child serial (e.g. the battery)').press('Enter');
    await page.getByPlaceholder('Parent serial (e.g. the robot)').fill('ROBOT-903');
    await page.getByPlaceholder('Parent serial (e.g. the robot)').press('Enter');

    await expect(page.locator('.alert-error')).toContainText('already has an open link');
    const retryButton = page.getByRole('button', { name: /close existing link and relink/i });
    await expect(retryButton).toBeVisible();

    await retryButton.click();
    await expect(page.locator('.alert-success')).toContainText('Linked');
    await expect(page.locator('.alert-success')).toContainText('ROBOT-903');
  });
});
