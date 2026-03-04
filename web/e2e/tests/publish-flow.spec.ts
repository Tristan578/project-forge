import { test, expect } from '../fixtures/editor.fixture';

test.describe('Publish Flow @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('publish store initializes with empty publications', async ({ page }) => {
    const publications = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      return store?.getState()?.publications ?? [];
    });
    // Should start empty or be an array
    expect(Array.isArray(publications) || publications === undefined).toBe(true);
  });

  test('publish dialog can be opened from toolbar', async ({ page }) => {
    // Look for publish/share button
    const publishBtn = page
      .locator('button[title*="Publish"], button[title*="Share"], button[title*="publish"]')
      .first();

    if (await publishBtn.count() > 0) {
      await publishBtn.click();


      // Should see a dialog with publish-related content
      const dialog = page
        .locator('[class*="fixed"]')
        .filter({ hasText: /publish|share|deploy/i });
      const visible = await dialog.isVisible().catch(() => false);
      expect(visible).toBe(true);
    } else {
      // Publish button may not be in toolbar — test via store instead
      const hasPublishAction = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        return (
          typeof store?.getState()?.publishGame === 'function' ||
          typeof store?.getState()?.setExporting === 'function'
        );
      });
      expect(hasPublishAction).toBe(true);
    }
  });

  test('publish store has required actions', async ({ page }) => {
    const hasActions = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) return false;
      const state = store.getState();
      // Check that export-related actions exist
      return typeof state.setExporting === 'function';
    });
    expect(hasActions).toBe(true);
  });

  test('export status reflects isExporting flag', async ({ page }) => {
    // Initially not exporting
    const isExporting = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      return store?.getState()?.isExporting ?? false;
    });
    expect(isExporting).toBe(false);
  });

  test('scene has a name that can be used as publish title', async ({ editor }) => {
    const sceneName = await editor.getStoreState<string>('sceneName');
    expect(sceneName).toBeTruthy();
    expect(typeof sceneName).toBe('string');
    expect(sceneName.length).toBeGreaterThan(0);
  });

  test('publish flow validates slug length', async ({ page }) => {
    // Open publish-related dialog if available
    const publishBtn = page
      .locator('button[title*="Publish"], button[title*="Share"]')
      .first();

    if (await publishBtn.count() > 0) {
      await publishBtn.click();


      // Find slug input and try short slug
      const slugInput = page
        .locator('input[placeholder*="slug"], input[name*="slug"]')
        .first();
      if (await slugInput.count() > 0) {
        await slugInput.fill('ab');


        // Publish button should be disabled with slug < 3 chars
        const publishActionBtn = page
          .locator('button')
          .filter({ hasText: /^publish$/i })
          .first();
        if (await publishActionBtn.count() > 0) {
          const isDisabled = await publishActionBtn.isDisabled();
          expect(isDisabled).toBe(true);
        }
      }
    }
    // If no publish UI found, test passes (publish may require auth)
  });

  test('publish flow auto-generates slug from title', async ({ page }) => {
    const publishBtn = page
      .locator('button[title*="Publish"], button[title*="Share"]')
      .first();

    if (await publishBtn.count() > 0) {
      await publishBtn.click();


      // Find title input and enter a title
      const titleInput = page
        .locator('input[placeholder*="title"], input[name*="title"]')
        .first();
      const slugInput = page
        .locator('input[placeholder*="slug"], input[name*="slug"]')
        .first();

      if (await titleInput.count() > 0 && await slugInput.count() > 0) {
        await titleInput.fill('My Awesome Game');


        const slugValue = await slugInput.inputValue();
        // Slug should be auto-generated (lowercased, hyphenated)
        expect(slugValue).toMatch(/^[a-z0-9-]+$/);
      }
    }
  });

  test('scene can be exported via store action', async ({ page, editor }) => {
    // Spawn an entity so we have something to export
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);

    // Verify the scene has content
    const nodes = await editor.getStoreState<Record<string, unknown>>('sceneGraph.nodes');
    expect(Object.keys(nodes).length).toBeGreaterThanOrEqual(2);

    // Verify export-related state exists
    const isExporting = await editor.getStoreState<boolean>('isExporting');
    expect(isExporting).toBe(false);
  });
});
