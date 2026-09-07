import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestAssetType } from '../helpers/api-setup.js';

// Phase 7 — label generation (G2.4), local prototype scope only (requirements §10,
// §6.4 — see handoff/phase-7-prompt.md). Distinct type name from other Gear specs,
// same reason 20/21 use their own — asset_types isn't truncated between e2e runs.
test.describe('Gear — Labels', () => {
  test.beforeAll(async () => {
    await truncateAllTables();
    await createTestAssetType({ name: 'Label Robot' });
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

  test('previews a label with the code and the human-readable serial alongside it', async ({ page }) => {
    await addAsset(page, 'LABEL-E2E-001', 'Label Robot');

    await page.goto('/gear/labels');
    const row = page.locator('tr', { hasText: 'LABEL-E2E-001' });
    await row.getByRole('button', { name: 'Preview' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await expect(modal.locator('.label-card svg')).toBeVisible();
    await expect(modal.locator('.label-serial')).toHaveText('LABEL-E2E-001');
  });

  test('generates codes locally with no third-party runtime request (§6.3)', async ({ page }) => {
    await addAsset(page, 'LABEL-E2E-002', 'Label Robot');
    await page.goto('/gear/labels');

    // Attach the listener only once the page itself has finished loading (its own
    // static assets, including the app's Google Fonts stylesheet, are a pre-existing,
    // unrelated choice — not what §6.3 is about). What matters here is whether
    // *generating and displaying a label* reaches any third-party origin, so only
    // requests made by the Preview action itself count.
    const externalRequests = [];
    page.on('request', req => {
      const url = new URL(req.url());
      if (url.hostname !== 'localhost') externalRequests.push(req.url());
    });

    const row = page.locator('tr', { hasText: 'LABEL-E2E-002' });
    await row.getByRole('button', { name: 'Preview' }).click();
    await page.locator('.modal .label-card svg').waitFor({ state: 'visible' });

    expect(externalRequests).toEqual([]);
  });

  test('a print sheet renders every selected label, each with its own serial', async ({ page }) => {
    await addAsset(page, 'LABEL-E2E-003', 'Label Robot');
    await addAsset(page, 'LABEL-E2E-004', 'Label Robot');

    await page.goto('/gear/labels');
    await page.getByLabel('Select LABEL-E2E-003').check();
    await page.getByLabel('Select LABEL-E2E-004').check();
    await page.getByRole('button', { name: /Print Sheet/ }).click();

    await expect(page).toHaveURL(/\/gear\/labels\/print\?ids=/);
    await expect(page.locator('.label-sheet .label-card')).toHaveCount(2);
    await expect(page.getByText('LABEL-E2E-003')).toBeVisible();
    await expect(page.getByText('LABEL-E2E-004')).toBeVisible();
  });
});
