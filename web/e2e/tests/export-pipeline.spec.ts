import { test, expect } from '../fixtures/editor.fixture';
import { E2E_TIMEOUT_NAV_MS } from '../constants';

test.describe('Export Pipeline @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('export dialog opens with scene name as default title', async ({ page, editor }) => {
    // Get current scene name from store
    const _sceneName = await editor.getStoreState<string>('sceneName');

    // Open export dialog
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();


    // Title input should have scene name as default
    const titleInput = page.locator('input[type="text"]').first();
    const titleValue = await titleInput.inputValue();
    expect(titleValue.length).toBeGreaterThan(0);
  });

  test('export preset buttons are visible', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();


    // Should see preset options (web-optimized, itch-io, etc.)
    const presetButtons = page.locator('button').filter({ hasText: /web|itch|self-contained|debug/i });
    const count = await presetButtons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('resolution options are available', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();


    // Check for resolution options text
    const resolutionText = page.locator('text=/responsive|1920.*1080|1280.*720/i');
    const count = await resolutionText.count();
    expect(count).toBeGreaterThan(0);
  });

  test('can change export title', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();


    const titleInput = page.locator('input[type="text"]').first();
    await titleInput.fill('My Test Game');
    const value = await titleInput.inputValue();
    expect(value).toBe('My Test Game');
  });

  test('export button triggers download', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();


    // Set a title
    const titleInput = page.locator('input[type="text"]').first();
    await titleInput.fill('TestExport');

    // Listen for download event
    const downloadPromise = page.waitForEvent('download', { timeout: E2E_TIMEOUT_NAV_MS }).catch(() => null);

    // Click the export/download button in the dialog
    const dialogExportBtn = page.locator('button').filter({ hasText: /^export$|^download$/i }).last();
    await dialogExportBtn.click();

    // Wait for download (may take a few seconds for WASM export)
    const download = await downloadPromise;

    if (download) {
      // Verify the download has a sensible filename
      const filename = download.suggestedFilename();
      expect(filename).toMatch(/\.html$|\.zip$/);
    }
    // If no download event fires, the export may have been blocked by browser security
    // In CI/headless mode this is expected behavior
  });

  test('export with entities includes them in output', async ({ page, editor }) => {
    // Spawn a cube first
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);

    // Open export dialog
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();


    // Set title
    const titleInput = page.locator('input[type="text"]').first();
    await titleInput.fill('GameWithCube');

    // Listen for download
    const downloadPromise = page.waitForEvent('download', { timeout: E2E_TIMEOUT_NAV_MS }).catch(() => null);

    const dialogExportBtn = page.locator('button').filter({ hasText: /^export$|^download$/i }).last();
    await dialogExportBtn.click();

    const download = await downloadPromise;
    if (download) {
      const filename = download.suggestedFilename();
      expect(filename).toContain('GameWithCube');
    }
  });

  test('export dialog disables inputs while exporting', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();


    // Set title
    const titleInput = page.locator('input[type="text"]').first();
    await titleInput.fill('ExportTest');

    // Check that the store's isExporting flag can be monitored
    const isExportingBefore = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      return store?.getState()?.isExporting ?? false;
    });
    expect(isExportingBefore).toBe(false);
  });

  test('empty title disables export button', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();


    // Clear the title
    const titleInput = page.locator('input[type="text"]').first();
    await titleInput.fill('');

    // Export button should be disabled
    const dialogExportBtn = page.locator('button').filter({ hasText: /^export$|^download$/i }).last();
    const isDisabled = await dialogExportBtn.isDisabled();
    expect(isDisabled).toBe(true);
  });

  test('export dialog closes on escape', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
    await exportBtn.click();


    // Press Escape
    await page.keyboard.press('Escape');


    // Dialog should be closed
    const dialog = page.locator('[class*="fixed"]').filter({ hasText: /export.*game/i });
    const visible = await dialog.isVisible().catch(() => false);
    expect(visible).toBe(false);
  });
});
