import { test, expect } from '../fixtures/editor.fixture';

test.describe('Play Mode @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('starts in edit mode', async ({ editor }) => {
    const mode = await editor.getStoreState<string>('engineMode');
    expect(mode).toBe('edit');
  });

  test('play button enters play mode', async ({ page, editor }) => {
    // Find and click play button
    const playBtn = page.locator('button[title*="Play"], button[title*="play"]').first();
    await expect(playBtn).toBeVisible();
    await playBtn.click();
    await page.waitForTimeout(500);

    // Verify store updated
    const mode = await editor.getStoreState<string>('engineMode');
    expect(mode).toBe('play');
  });

  test('stop button returns to edit mode', async ({ page, editor }) => {
    // Enter play mode first
    const playBtn = page.locator('button[title*="Play"], button[title*="play"]').first();
    await playBtn.click();
    await page.waitForTimeout(500);

    // Click stop
    const stopBtn = page.locator('button[title*="Stop"], button[title*="stop"]').first();
    await stopBtn.click();
    await page.waitForTimeout(500);

    const mode = await editor.getStoreState<string>('engineMode');
    expect(mode).toBe('edit');
  });

  test('pause button pauses play mode', async ({ page, editor }) => {
    // Enter play mode
    const playBtn = page.locator('button[title*="Play"], button[title*="play"]').first();
    await playBtn.click();
    await page.waitForTimeout(500);

    // Click pause
    const pauseBtn = page.locator('button[title*="Pause"], button[title*="pause"]').first();
    await pauseBtn.click();
    await page.waitForTimeout(500);

    const mode = await editor.getStoreState<string>('engineMode');
    expect(mode).toBe('paused');
  });

  test('resume from paused returns to play', async ({ page, editor }) => {
    // Play then pause
    const playBtn = page.locator('button[title*="Play"], button[title*="play"]').first();
    await playBtn.click();
    await page.waitForTimeout(500);

    const pauseBtn = page.locator('button[title*="Pause"], button[title*="pause"]').first();
    await pauseBtn.click();
    await page.waitForTimeout(500);

    // Resume (play button should now work as resume)
    // In paused mode, the play/resume button is re-enabled
    const resumeBtn = page
      .locator(
        'button[title*="Play"], button[title*="Resume"], button[title*="play"], button[title*="resume"]'
      )
      .first();
    await resumeBtn.click();
    await page.waitForTimeout(500);

    const mode = await editor.getStoreState<string>('engineMode');
    expect(mode).toBe('play');
  });

  test('stop from paused returns to edit', async ({ page, editor }) => {
    // Play then pause
    const playBtn = page.locator('button[title*="Play"], button[title*="play"]').first();
    await playBtn.click();
    await page.waitForTimeout(500);

    const pauseBtn = page.locator('button[title*="Pause"], button[title*="pause"]').first();
    await pauseBtn.click();
    await page.waitForTimeout(500);

    // Stop
    const stopBtn = page.locator('button[title*="Stop"], button[title*="stop"]').first();
    await stopBtn.click();
    await page.waitForTimeout(500);

    const mode = await editor.getStoreState<string>('engineMode');
    expect(mode).toBe('edit');
  });

  test('Ctrl+P toggles play mode', async ({ page, editor }) => {
    // Ctrl+P to play
    await page.keyboard.press('Control+p');
    await page.waitForTimeout(500);

    let mode = await editor.getStoreState<string>('engineMode');
    expect(mode).toBe('play');

    // Ctrl+P to stop
    await page.keyboard.press('Control+p');
    await page.waitForTimeout(500);

    mode = await editor.getStoreState<string>('engineMode');
    expect(mode).toBe('edit');
  });

  test('mode indicator shows Playing when in play mode', async ({ page }) => {
    const playBtn = page.locator('button[title*="Play"], button[title*="play"]').first();
    await playBtn.click();
    await page.waitForTimeout(500);

    const indicator = page.getByText('Playing', { exact: false });
    await expect(indicator.first()).toBeVisible();
  });

  test('mode indicator shows Paused when paused', async ({ page }) => {
    // Play then pause
    const playBtn = page.locator('button[title*="Play"], button[title*="play"]').first();
    await playBtn.click();
    await page.waitForTimeout(500);

    const pauseBtn = page.locator('button[title*="Pause"], button[title*="pause"]').first();
    await pauseBtn.click();
    await page.waitForTimeout(500);

    const indicator = page.getByText('Paused', { exact: false });
    await expect(indicator.first()).toBeVisible();
  });

  test('play mode preserves scene state after stop', async ({ page, editor }) => {
    // Spawn entity first
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);

    // Get initial entity count
    const beforeNodes = await editor.getStoreState<Record<string, unknown>>('sceneGraph.nodes');
    const beforeCount = Object.keys(beforeNodes).length;

    // Play and stop
    const playBtn = page.locator('button[title*="Play"], button[title*="play"]').first();
    await playBtn.click();
    await page.waitForTimeout(500);

    const stopBtn = page.locator('button[title*="Stop"], button[title*="stop"]').first();
    await stopBtn.click();
    await page.waitForTimeout(500);

    // Entity count should be preserved
    const afterNodes = await editor.getStoreState<Record<string, unknown>>('sceneGraph.nodes');
    const afterCount = Object.keys(afterNodes).length;
    expect(afterCount).toBe(beforeCount);
  });

  test('export button is disabled during play mode', async ({ page }) => {
    const playBtn = page.locator('button[title*="Play"], button[title*="play"]').first();
    await playBtn.click();
    await page.waitForTimeout(500);

    // Export button should be disabled or have reduced opacity
    const exportBtn = page.locator('button[title*="Export"], button[title*="export"]').first();
    if (await exportBtn.count() > 0) {
      const isDisabled = await exportBtn.isDisabled();
      const opacity = await exportBtn.evaluate((el) =>
        window.getComputedStyle(el).opacity
      );
      // Either disabled attribute or reduced opacity
      expect(isDisabled || parseFloat(opacity) < 0.5).toBe(true);
    }
  });
});

/**
 * UI-only play mode tests (no WASM engine).
 * These verify store-driven UI behavior by injecting state directly.
 */
test.describe('Play Mode UI @ui', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  test('play controls render in initial edit state', async ({ page }) => {
    const playBtn = page.locator('button[aria-label="Play"]');
    const pauseBtn = page.locator('button[aria-label="Pause"]');
    const stopBtn = page.locator('button[aria-label="Stop"]');

    await expect(playBtn).toBeVisible({ timeout: 5000 });
    await expect(playBtn).toBeEnabled();
    await expect(pauseBtn).toBeVisible();
    await expect(pauseBtn).toBeDisabled();
    await expect(stopBtn).toBeVisible();
    await expect(stopBtn).toBeDisabled();
  });

  test('store mode change to play disables play button and enables pause/stop', async ({ page }) => {
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'play' });
    });

    await expect(page.locator('button[aria-label="Play"]')).toBeDisabled();
    await expect(page.locator('button[aria-label="Pause"]')).toBeEnabled();
    await expect(page.locator('button[aria-label="Stop"]')).toBeEnabled();
  });

  test('store mode change to paused shows resume button', async ({ page }) => {
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'paused' });
    });

    const resumeBtn = page.locator('button[aria-label="Resume"]');
    await expect(resumeBtn).toBeVisible({ timeout: 3000 });
    await expect(resumeBtn).toBeEnabled();
  });

  test('rapid mode toggling does not leave UI in inconsistent state', async ({ page }) => {
    // Rapidly toggle between modes
    const modes = ['play', 'paused', 'edit', 'play', 'edit'] as const;
    for (const mode of modes) {
      await page.evaluate((m) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__EDITOR_STORE?.setState({ engineMode: m });
      }, mode);
      await page.waitForTimeout(50);
    }

    // Should end in edit mode with correct button states
    await page.waitForTimeout(200);
    const playBtn = page.locator('button[aria-label="Play"]');
    await expect(playBtn).toBeEnabled();
    await expect(page.locator('button[aria-label="Pause"]')).toBeDisabled();
    await expect(page.locator('button[aria-label="Stop"]')).toBeDisabled();
  });

  test('mode indicator text updates correctly for each state', async ({ page }) => {
    // Play mode
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'play' });
    });
    await page.waitForTimeout(200);
    await expect(page.getByText('Playing').first()).toBeVisible();

    // Paused mode
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'paused' });
    });
    await page.waitForTimeout(200);
    await expect(page.getByText('Paused').first()).toBeVisible();

    // Back to edit — indicator should not show Playing or Paused
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'edit' });
    });
    await page.waitForTimeout(200);
    // No mode indicator visible in edit mode
    const playingText = page.getByText('Playing', { exact: true });
    const pausedText = page.getByText('Paused', { exact: true });
    await expect(playingText).not.toBeVisible();
    await expect(pausedText).not.toBeVisible();
  });
});
