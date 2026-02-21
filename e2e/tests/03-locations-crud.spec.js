import { test, expect } from '@playwright/test';
import { truncateAllTables, closePool } from '../helpers/db.js';

test.describe('Locations CRUD', () => {
  test.beforeAll(async () => {
    await truncateAllTables();
  });

  test.afterAll(async () => {
    await closePool();
  });

  test('create a location via modal', async ({ page }) => {
    await page.goto('/locations');
    await page.getByRole('button', { name: 'Add Location' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await expect(modal.locator('h2')).toHaveText('New Location');

    await modal.locator('.form-group').filter({ hasText: 'Name' }).locator('input').fill('Main Warehouse');
    // Type defaults to Warehouse, leave it
    await expect(modal.locator('.form-group').filter({ hasText: 'Type' }).locator('select')).toHaveValue('Warehouse');

    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'hidden' });

    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText('Main Warehouse');
    await expect(page.locator('tbody tr').first()).toContainText('Warehouse');
  });

  test('create location with different type', async ({ page }) => {
    await page.goto('/locations');
    await page.getByRole('button', { name: 'Add Location' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });

    await modal.locator('.form-group').filter({ hasText: 'Name' }).locator('input').fill('Field Site Alpha');
    await modal.locator('.form-group').filter({ hasText: 'Type' }).locator('select').selectOption('Regional Site');

    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'hidden' });

    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(page.locator('tbody tr').filter({ hasText: 'Field Site Alpha' })).toContainText('Regional Site');
  });

  test('edit a location', async ({ page }) => {
    await page.goto('/locations');
    const row = page.locator('tbody tr').filter({ hasText: 'Field Site Alpha' });
    await row.getByRole('button', { name: 'Edit' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });
    await expect(modal.locator('h2')).toHaveText('Edit Location');

    await modal.locator('.form-group').filter({ hasText: 'Name' }).locator('input').fill('Field Site Beta');
    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'hidden' });

    await expect(page.locator('tbody tr').filter({ hasText: 'Field Site Beta' })).toBeVisible();
    await expect(page.locator('tbody')).not.toContainText('Field Site Alpha');
  });

  test('duplicate location name shows error', async ({ page }) => {
    await page.goto('/locations');
    await page.getByRole('button', { name: 'Add Location' }).click();

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible' });

    await modal.locator('.form-group').filter({ hasText: 'Name' }).locator('input').fill('Main Warehouse');
    await modal.getByRole('button', { name: 'Save' }).click();

    await expect(modal.locator('.alert-error')).toBeVisible();
  });

  test('delete a location', async ({ page }) => {
    await page.goto('/locations');
    await expect(page.locator('tbody tr')).toHaveCount(2);

    page.on('dialog', dialog => dialog.accept());

    const row = page.locator('tbody tr').filter({ hasText: 'Field Site Beta' });
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody')).not.toContainText('Field Site Beta');
  });
});
