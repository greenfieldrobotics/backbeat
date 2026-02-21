import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';

/** Helper to fill the parts modal form. Labels like "Part Number" appear in
 *  multiple form-groups ("Mfg Part Number", "Reseller Part Number") so we
 *  match by finding the label element with exact text, then target the parent. */
function formGroup(modal, labelText) {
  return modal.locator(`.form-group:has(> label:text-is("${labelText}"))`).locator('input');
}

test.describe('Parts CRUD', () => {
  test.beforeAll(async () => {
    await truncateAllTables();
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('create a part via modal', async ({ page }) => {
    await page.goto('/parts');
    await page.getByRole('button', { name: 'Add Part' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await expect(modal.locator('h2')).toHaveText('New Part');

    await formGroup(modal, 'Part Number').fill('PN-001');
    await formGroup(modal, 'Description').fill('Test Widget');
    await formGroup(modal, 'Classification').fill('Electronics');
    await formGroup(modal, 'Cost').fill('25.50');
    await formGroup(modal, 'Manufacturer').fill('Acme Corp');

    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'hidden' });

    // Part should appear in table
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText('PN-001');
    await expect(page.locator('tbody tr').first()).toContainText('Test Widget');
    await expect(page.locator('tbody tr').first()).toContainText('Electronics');
    await expect(page.locator('tbody tr').first()).toContainText('Acme Corp');
  });

  test('create a second part', async ({ page }) => {
    await page.goto('/parts');
    await page.getByRole('button', { name: 'Add Part' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });

    await formGroup(modal, 'Part Number').fill('PN-002');
    await formGroup(modal, 'Description').fill('Test Gadget');
    await formGroup(modal, 'Classification').fill('Hardware');
    await formGroup(modal, 'Cost').fill('10.00');

    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'hidden' });

    await expect(page.locator('tbody tr')).toHaveCount(2);
  });

  test('search filters parts', async ({ page }) => {
    await page.goto('/parts');
    await expect(page.locator('tbody tr')).toHaveCount(2);

    await page.locator('input[placeholder="Search parts..."]').fill('Widget');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText('PN-001');

    // Clear search
    await page.locator('input[placeholder="Search parts..."]').fill('');
    await expect(page.locator('tbody tr')).toHaveCount(2);
  });

  test('classification filter works', async ({ page }) => {
    await page.goto('/parts');
    await expect(page.locator('tbody tr')).toHaveCount(2);

    // Filter by Electronics — the select is the only <select> on the page outside the modal
    await page.locator('select').selectOption('Electronics');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText('PN-001');

    // Reset filter
    await page.locator('select').selectOption('');
    await expect(page.locator('tbody tr')).toHaveCount(2);
  });

  test('edit a part', async ({ page }) => {
    await page.goto('/parts');
    const row = page.locator('tbody tr').filter({ hasText: 'PN-001' });
    await row.getByRole('button', { name: 'Edit' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await expect(modal.locator('h2')).toHaveText('Edit Part');

    await formGroup(modal, 'Description').fill('Updated Widget');

    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'hidden' });

    await expect(page.locator('tbody tr').filter({ hasText: 'PN-001' })).toContainText('Updated Widget');
  });

  test('duplicate part number shows error', async ({ page }) => {
    await page.goto('/parts');
    await page.getByRole('button', { name: 'Add Part' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });

    await formGroup(modal, 'Part Number').fill('PN-001');

    await modal.getByRole('button', { name: 'Save' }).click();

    await expect(modal.locator('.alert-error')).toBeVisible();
    await expect(modal.locator('.alert-error')).toContainText('already exists');
  });

  test('delete a part', async ({ page }) => {
    await page.goto('/parts');
    await expect(page.locator('tbody tr')).toHaveCount(2);

    page.on('dialog', dialog => dialog.accept());

    const row = page.locator('tbody tr').filter({ hasText: 'PN-002' });
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody')).not.toContainText('PN-002');
  });
});
