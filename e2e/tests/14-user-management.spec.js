import { test, expect } from '@playwright/test';
import { truncateAllTables, getPool, closePool } from '../helpers/db.js';

test.describe('User Management', () => {
  test.beforeAll(async () => {
    await truncateAllTables();
  });

  test.afterAll(async () => {
    // Clean up test users
    const pool = getPool();
    await pool.query("DELETE FROM users WHERE email LIKE '%@e2e-test.example.com'");
    await closePool();
  });

  test('users page loads with empty state', async ({ page }) => {
    await page.goto('/users');
    await expect(page.locator('.page-header h1')).toHaveText('User Management');
    await expect(page.getByRole('button', { name: 'Add User' })).toBeVisible();
    await expect(page.locator('.empty-state')).toHaveText('No users');
  });

  test('add a new user via the form', async ({ page }) => {
    await page.goto('/users');
    await page.getByRole('button', { name: 'Add User' }).click();

    // Fill in the add-user form
    const form = page.locator('form');
    await form.locator('input[type="email"]').fill('alice@e2e-test.example.com');
    await form.locator('input[type="text"]').fill('Alice Test');
    await form.locator('select').selectOption('warehouse');
    await form.getByRole('button', { name: 'Add' }).click();

    // Form should close and user should appear in the table
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText('Alice Test');
    await expect(page.locator('tbody tr').first()).toContainText('alice@e2e-test.example.com');
    await expect(page.locator('tbody tr').first()).toContainText('warehouse');
  });

  test('add a second user', async ({ page }) => {
    await page.goto('/users');
    await page.getByRole('button', { name: 'Add User' }).click();

    const form = page.locator('form');
    await form.locator('input[type="email"]').fill('bob@e2e-test.example.com');
    await form.locator('input[type="text"]').fill('Bob Test');
    await form.locator('select').selectOption('viewer');
    await form.getByRole('button', { name: 'Add' }).click();

    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(page.locator('tbody')).toContainText('bob@e2e-test.example.com');
  });

  test('edit user role inline', async ({ page }) => {
    await page.goto('/users');
    const row = page.locator('tbody tr').filter({ hasText: 'alice@e2e-test.example.com' });
    await row.getByRole('button', { name: 'Edit' }).click();

    // Should show inline edit controls
    await expect(row.locator('select')).toBeVisible();
    await row.locator('select').selectOption('admin');
    await row.getByRole('button', { name: 'Save' }).click();

    // After save, should show updated role as text
    await expect(row).toContainText('admin');
  });

  test('edit user name inline', async ({ page }) => {
    await page.goto('/users');
    const row = page.locator('tbody tr').filter({ hasText: 'bob@e2e-test.example.com' });
    await row.getByRole('button', { name: 'Edit' }).click();

    // Should show inline name input
    const nameInput = row.locator('input[type="text"]');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('Bob Updated');
    await row.getByRole('button', { name: 'Save' }).click();

    await expect(row).toContainText('Bob Updated');
  });

  test('cancel edit reverts changes', async ({ page }) => {
    await page.goto('/users');
    const row = page.locator('tbody tr').filter({ hasText: 'bob@e2e-test.example.com' });
    await row.getByRole('button', { name: 'Edit' }).click();

    const nameInput = row.locator('input[type="text"]');
    await nameInput.fill('Should Not Persist');
    await row.getByRole('button', { name: 'Cancel' }).click();

    // Should revert to original name
    await expect(row).toContainText('Bob Updated');
    await expect(row).not.toContainText('Should Not Persist');
  });

  test('delete a user', async ({ page }) => {
    await page.goto('/users');
    await expect(page.locator('tbody tr')).toHaveCount(2);

    // Accept the confirmation dialog
    page.on('dialog', dialog => dialog.accept());

    const row = page.locator('tbody tr').filter({ hasText: 'bob@e2e-test.example.com' });
    await row.getByRole('button', { name: 'Remove' }).click();

    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody')).not.toContainText('bob@e2e-test.example.com');
  });

  test('users page shows last login as Never for new user', async ({ page }) => {
    await page.goto('/users');
    const row = page.locator('tbody tr').filter({ hasText: 'alice@e2e-test.example.com' });
    await expect(row).toContainText('Never');
  });
});
