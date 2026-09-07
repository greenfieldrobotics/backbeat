import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestAssetType } from '../helpers/api-setup.js';

// Phase 5 (part 1) — the in-app label route `/a/:serial` (G2.2). The redirect host
// (part 2) is out of scope; this only covers the client route landing on the right
// asset. The E2E suite runs with auth bypassed (see server/src/core/auth/authMiddleware.js),
// so the unauthenticated case (§5.5) is covered at the API level instead, in
// server/tests/24-gear-label-route.test.js.
test.describe('Gear — Label route', () => {
  test.beforeAll(async () => {
    await truncateAllTables();
    await createTestAssetType({ name: 'Robot' });
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('scanning a known serial lands on that asset', async ({ page }) => {
    await page.goto('/gear/assets');
    await page.getByRole('button', { name: 'Add Asset' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await modal.locator('.form-group').filter({ hasText: 'Serial Number' }).locator('input').fill('LABEL-001');
    await modal.locator('.form-group').filter({ hasText: 'Asset Type' }).locator('select').selectOption({ label: 'Robot' });
    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'hidden' });

    await page.goto('/a/LABEL-001');
    await expect(page.locator('.page-header h1')).toHaveText('LABEL-001');
    await expect(page.locator('table')).toContainText('Robot');
    await expect(page.locator('table')).toContainText('Available');
  });

  test('resolves regardless of case and surrounding whitespace', async ({ page }) => {
    await page.goto('/a/label-001');
    await expect(page.locator('.page-header h1')).toHaveText('LABEL-001');

    await page.goto('/a/' + encodeURIComponent('  LABEL-001  '));
    await expect(page.locator('.page-header h1')).toHaveText('LABEL-001');
  });

  test('an unknown serial shows a clear not-found state, not a crash', async ({ page }) => {
    await page.goto('/a/NO-SUCH-SERIAL');
    await expect(page.locator('h1')).toHaveText('Asset not found');
    await expect(page.getByText('NO-SUCH-SERIAL')).toBeVisible();
  });
});
