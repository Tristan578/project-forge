import { test, expect } from '../fixtures/editor.fixture';

test.describe('Play Mode', () => {
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
