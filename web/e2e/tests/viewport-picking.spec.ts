import { test, expect } from '../fixtures/editor.fixture';

test.describe('Viewport Picking @engine', () => {
  test('clicking on 3D object in viewport selects it', async ({ page, editor }) => {
    await editor.load();

    // Get canvas dimensions for click targeting
    const box = await editor.canvas.boundingBox();
    if (!box) {
      throw new Error('Canvas bounding box not found');
    }

    // Click in the center of the canvas — this is where the cube/player should be
    // The default scene has a cube at (0, 0.5, 0) with camera looking at origin
    await editor.clickViewport(box.width / 2, box.height / 2);

    // Wait for selection to register (Position label appears in inspector)
    await expect(page.locator('text=Position')).toBeVisible({ timeout: 10000 }).catch(() => {});

    // Inspector should show Position after a successful pick
    const hasPosition = await page.locator('text=Position').isVisible().catch(() => false);
    expect(hasPosition).toBe(true);
  });
});
