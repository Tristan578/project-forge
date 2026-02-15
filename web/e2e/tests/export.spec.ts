import { test, expect } from '../fixtures/editor.fixture';

test.describe('Export', () => {
  test('export dialog can be opened', async ({ page, editor }) => {
    await editor.load();

    // Look for export button (Download icon or "Export" text)
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();
    await page.waitForTimeout(300);

    // Export dialog should be visible
    const exportDialog = page.locator('[class*="fixed"]').filter({ hasText: /export.*game|export/i }).first();
    await expect(exportDialog).toBeVisible();
  });

  test('export dialog shows format options', async ({ page, editor }) => {
    await editor.load();

    // Open export dialog
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();
    await page.waitForTimeout(300);

    // Look for format selection (single-html, zip, etc.)
    const formatOption = page.locator('input[type="radio"], select').first();
    const formatCount = await formatOption.count();
    expect(formatCount).toBeGreaterThan(0);
  });

  test('export dialog has game title input', async ({ page, editor }) => {
    await editor.load();

    // Open export dialog
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();
    await page.waitForTimeout(300);

    // Look for title input
    const titleInput = page.locator('input[type="text"]').filter({ hasText: '' }).first();
    await expect(titleInput).toBeVisible();
  });

  test('export dialog has download button', async ({ page, editor }) => {
    await editor.load();

    // Open export dialog
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();
    await page.waitForTimeout(300);

    // Look for download/export button in dialog
    const downloadBtn = page.locator('button').filter({ hasText: /export|download/i }).last();
    await expect(downloadBtn).toBeVisible();
  });

  test('export dialog shows resolution options', async ({ page, editor }) => {
    await editor.load();

    // Open export dialog
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();
    await page.waitForTimeout(300);

    // Look for resolution dropdown/radio buttons
    const resolutionControl = page.locator('text=/resolution|1920x1080|1280x720|responsive/i').first();
    const exists = await resolutionControl.count();
    expect(exists).toBeGreaterThan(0);
  });

  test('export dialog can be closed', async ({ page, editor }) => {
    await editor.load();

    // Open export dialog
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();
    await page.waitForTimeout(300);

    // Click close button
    const closeBtn = page.locator('button').filter({ hasText: /×|close/i }).first();
    await closeBtn.click();
    await page.waitForTimeout(300);

    // Dialog should be gone
    const exportDialog = page.locator('[class*="fixed"]').filter({ hasText: /export.*game|export/i }).first();
    const visible = await exportDialog.isVisible().catch(() => false);
    expect(visible).toBe(false);
  });

  test('export dialog shows background color picker', async ({ page, editor }) => {
    await editor.load();

    // Open export dialog
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();
    await page.waitForTimeout(300);

    // Look for color input or background color control
    const colorInput = page.locator('input[type="color"], input[type="text"][value*="#"]').first();
    const colorLabel = page.locator('text=/background.*color|bg.*color/i').first();

    const inputCount = await colorInput.count();
    const labelCount = await colorLabel.count();
    expect(inputCount + labelCount).toBeGreaterThan(0);
  });

  test('export dialog has debug mode toggle', async ({ page, editor }) => {
    await editor.load();

    // Open export dialog
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();
    await page.waitForTimeout(300);

    // Look for debug checkbox or toggle
    const debugControl = page.locator('input[type="checkbox"]').filter({ hasText: '' }).first();
    const debugLabel = page.locator('text=/debug|include.*debug/i').first();

    const inputCount = await debugControl.count();
    const labelCount = await debugLabel.count();
    expect(inputCount + labelCount).toBeGreaterThan(0);
  });
});
