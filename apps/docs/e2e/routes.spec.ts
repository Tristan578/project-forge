/** Verify the production-built Docs home, command index, and manifest category routes. */
import { expect, test } from '@playwright/test';

test('serves the docs home page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'SpawnForge Documentation' })).toBeVisible();
});

test('serves the MCP index with published commands', async ({ page }) => {
  await page.goto('/mcp');
  await expect(page.getByRole('heading', { name: 'MCP Commands' })).toBeVisible();
  await expect(page.getByText(/public commands across/i)).toBeVisible();
});

test('serves a manifest-backed MCP category', async ({ page }) => {
  await page.goto('/mcp/scene');
  await expect(page.getByRole('heading', { name: 'scene', level: 1, exact: true })).toBeVisible();
  await expect(page.locator('li h2').first()).toBeVisible();
});
