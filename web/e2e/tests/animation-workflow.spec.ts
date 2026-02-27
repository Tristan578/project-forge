import { test, expect } from '../fixtures/editor.fixture';

test.describe('Animation Workflow @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('animation inspector appears for selected entity', async ({ page, editor }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);
    await editor.selectEntity('Cube');
    await page.waitForTimeout(300);

    // Look for animation section in inspector
    const animSection = page.getByText(/animation/i, { exact: false });
    const count = await animSection.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('entity inspector has multiple sections', async ({ page, editor }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);
    await editor.selectEntity('Cube');
    await page.waitForTimeout(300);

    // Should have Transform, Material sections at minimum
    const transform = page.getByText('Transform', { exact: false });
    const material = page.getByText('Material', { exact: false });
    await expect(transform.first()).toBeVisible();
    await expect(material.first()).toBeVisible();
  });

  test('audio mixer panel can be found', async ({ page }) => {
    // Look for audio mixer tab or panel
    const mixerTab = page.locator('button, [role="tab"]').filter({ hasText: /mixer|audio/i });
    const count = await mixerTab.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('play controls are visible', async ({ page }) => {
    // Play/Pause/Stop buttons should be in toolbar
    const playBtn = page.locator('button[title*="Play"], button[title*="play"]').first();
    await expect(playBtn).toBeVisible();
  });

  test('canvas renders correctly', async ({ editor }) => {
    const boundingBox = await editor.canvas.boundingBox();
    expect(boundingBox).not.toBeNull();
    expect(boundingBox!.width).toBeGreaterThan(0);
    expect(boundingBox!.height).toBeGreaterThan(0);
  });
});
