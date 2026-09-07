import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';
import { createTestAssetType } from '../helpers/api-setup.js';
import { writeBarcodePhotoFixture } from '../helpers/photoFixture.js';

// Phase 11 — photograph and resolve later (G4.3). Decoding a still image reuses Phase
// 8's actual self-hosted decoder (client/src/core/scanning/zxingDecoder.ts) — this is
// the one e2e suite that can drive it for real, since live camera capture can't be
// driven headlessly (see 18-gear-scan-anywhere.spec.js's comment). The encoded value
// is a real label URL (`<LABEL_HOST>/a/<serial>`, matching labelService.js's own
// buildLabelUrl()), generated with the same bwip-js library that produces real printed
// labels — so this fixture is representative, not a stand-in.
const LABEL_HOST = 'http://localhost:5173';

async function addAsset(page, serial, typeLabel = 'Robot') {
  await page.goto('/gear/assets');
  await page.getByRole('button', { name: 'Add Asset' }).click();
  const modal = page.locator('.modal');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('.form-group').filter({ hasText: 'Serial Number' }).locator('input').fill(serial);
  await modal.locator('.form-group').filter({ hasText: 'Asset Type' }).locator('select').selectOption({ label: typeLabel });
  await modal.getByRole('button', { name: 'Save' }).click();
  await modal.waitFor({ state: 'hidden' });
}

async function openHistory(page, serial) {
  await page.goto('/gear/assets');
  const row = page.locator('tbody tr').filter({ hasText: serial });
  await row.getByRole('button', { name: 'History' }).click();
  const historyModal = page.locator('.modal');
  await historyModal.waitFor({ state: 'visible' });
  return historyModal;
}

test.describe('Gear — Photograph and resolve later', () => {
  test.beforeAll(async () => {
    await truncateAllTables();
    await createTestAssetType({ name: 'Robot' });
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('uploading a photo of a QR label resolves it to the right asset and records a photo_scan event', async ({ page }) => {
    await addAsset(page, 'PHOTO-E2E-001');
    const fixturePath = await writeBarcodePhotoFixture(`${LABEL_HOST}/a/PHOTO-E2E-001`, { bcid: 'qrcode' });

    await page.goto('/gear/photo-resolve');
    await page.setInputFiles('#photo-file-input', fixturePath);

    await expect(page.getByText('PHOTO-E2E-001')).toBeVisible();
    // The fixture PNG carries no EXIF data, so the page must ask for a date rather
    // than silently falling back — the "let the user state it" branch of §7.1.
    await page.getByLabel(/When was this photo taken/).fill('2026-08-01T09:30');
    await page.getByRole('button', { name: 'Resolve' }).click();

    await expect(page.getByText('Recorded.')).toBeVisible();

    const historyModal = await openHistory(page, 'PHOTO-E2E-001');
    const rows = historyModal.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    // The event stream sorts by occurred_at, not created_at — the entered date (August)
    // sorts BEFORE the registered event's occurred_at (today, via NOW()), so the photo_scan
    // row is last, not first. That ordering is itself proof occurred_at (not upload time)
    // drives the stream, exactly what this phase adds (§ "occurred_at finally earns its keep").
    const photoRow = historyModal.locator('tbody tr', { hasText: 'photo_scan' });
    await expect(photoRow).toHaveCount(1);
    await expect(photoRow).toContainText('8/1/2026');
  });

  test('uploading a photo of a DataMatrix label also resolves it (2D-only, same decoder)', async ({ page }) => {
    await addAsset(page, 'PHOTO-E2E-002');
    const fixturePath = await writeBarcodePhotoFixture(`${LABEL_HOST}/a/PHOTO-E2E-002`, { bcid: 'datamatrix' });

    await page.goto('/gear/photo-resolve');
    await page.setInputFiles('#photo-file-input', fixturePath);

    await expect(page.getByText('PHOTO-E2E-002')).toBeVisible();
    await page.getByLabel(/When was this photo taken/).fill('2026-08-01T09:30');
    await page.getByRole('button', { name: 'Resolve' }).click();

    await expect(page.getByText('Recorded.')).toBeVisible();
  });

  test('uploading the exact same photo a second time — a new page visit, not a retry click — is a no-op', async ({ page }) => {
    await addAsset(page, 'PHOTO-E2E-003');
    const fixturePath = await writeBarcodePhotoFixture(`${LABEL_HOST}/a/PHOTO-E2E-003`, { bcid: 'qrcode' });

    await page.goto('/gear/photo-resolve');
    await page.setInputFiles('#photo-file-input', fixturePath);
    await expect(page.getByText('PHOTO-E2E-003')).toBeVisible();
    await page.getByLabel(/When was this photo taken/).fill('2026-08-01T09:30');
    await page.getByRole('button', { name: 'Resolve' }).click();
    await expect(page.getByText('Recorded.')).toBeVisible();

    // A fresh navigation — a new page, the same photo file. The client-side idempotency
    // key is derived from the file's own bytes (see photoResolve.ts), not from any
    // in-memory component state, so this must still be recognized as a duplicate.
    await page.goto('/gear/photo-resolve');
    await page.setInputFiles('#photo-file-input', fixturePath);
    await expect(page.getByText('PHOTO-E2E-003')).toBeVisible();
    await page.getByLabel(/When was this photo taken/).fill('2026-08-02T11:00');
    await page.getByRole('button', { name: 'Resolve' }).click();
    await expect(page.getByText(/Already recorded/)).toBeVisible();

    const historyModal = await openHistory(page, 'PHOTO-E2E-003');
    const photoRows = historyModal.locator('tbody tr', { hasText: 'photo_scan' });
    await expect(photoRows).toHaveCount(1);
  });
});
