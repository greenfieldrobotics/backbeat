import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestAssetType } from '../helpers/api-setup.js';

// Phase 8 — scan from anywhere (G4.2). A dedicated scanner emits this literal prefix
// before every scan; must match client/src/core/scanning/sentinelParser.ts's
// SCAN_SENTINEL. Real camera scanning (G4.1) can't be driven headlessly, so this covers
// the part that's a real end-to-end path: a hardware scanner is just a fast, no-mouse
// keyboard, and Playwright can dispatch exactly that.
const SCAN_SENTINEL = '~SCAN~';

test.describe('Gear — Scan from anywhere', () => {
  test.beforeAll(async () => {
    await truncateAllTables();
    await createTestAssetType({ name: 'Robot' });
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('a sentinel-prefixed scan jumps to that asset from any screen', async ({ page }) => {
    await page.goto('/gear/assets');
    await page.getByRole('button', { name: 'Add Asset' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await modal.locator('.form-group').filter({ hasText: 'Serial Number' }).locator('input').fill('SCAN-ANY-001');
    await modal.locator('.form-group').filter({ hasText: 'Asset Type' }).locator('select').selectOption({ label: 'Robot' });
    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'hidden' });

    // A different screen entirely, nothing focused — the point of "scan anywhere".
    await page.goto('/locations');
    await expect(page).toHaveURL(/\/locations$/);

    await page.keyboard.type(`${SCAN_SENTINEL}SCAN-ANY-001`);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/a\/SCAN-ANY-001$/);
    await expect(page.locator('.page-header h1')).toHaveText('SCAN-ANY-001');
    await expect(page.locator('table')).toContainText('Robot');
  });

  test('does not fire on ordinary fast typing with no sentinel prefix', async ({ page }) => {
    await page.goto('/locations');
    await page.keyboard.type('just typing some ordinary words quickly');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/locations$/);
  });

  test('does not hijack a scan typed into a focused form field', async ({ page }) => {
    await page.goto('/gear/assets');
    await page.getByRole('button', { name: 'Add Asset' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    const serialInput = modal.locator('.form-group').filter({ hasText: 'Serial Number' }).locator('input');
    await serialInput.click();
    await serialInput.type(`${SCAN_SENTINEL}HIJACK-001`);
    await page.keyboard.press('Enter');

    // Enter on a focused text input submits nothing here (no form submit handler on
    // Enter), and above all it must not have navigated away mid-entry.
    await expect(page.locator('.modal')).toBeVisible();
    await expect(serialInput).toHaveValue(`${SCAN_SENTINEL}HIJACK-001`);
  });
});
