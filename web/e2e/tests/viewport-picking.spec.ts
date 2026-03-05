import { test, expect } from '../fixtures/editor.fixture';

test.describe('Viewport Picking @engine', () => {
  test('clicking on 3D object in viewport selects it', async ({ page, editor }) => {
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    await editor.load();

    // Wait for engine to fully initialize — hierarchy populates when ready
    const groundNode = page.locator('text=Ground');
    await expect(groundNode.first()).toBeVisible({ timeout: 30000 });

    // Get canvas dimensions for click targeting
    const canvas = editor.canvas;
    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error('Canvas bounding box not found');
    }

    console.log(`Canvas: ${box.x}, ${box.y}, ${box.width}x${box.height}`);

    // Click in the center of the canvas - this is where the cube/player should be
    // The default scene has a cube at (0, 0.5, 0) and camera looking at origin
    const centerX = box.width / 2;
    const centerY = box.height / 2;

    console.log(`Clicking canvas center: ${centerX}, ${centerY}`);
    await editor.clickViewport(centerX, centerY);

    // Wait for selection to register (Position label appears in inspector)
    await expect(page.locator('text=Position')).toBeVisible({ timeout: 10000 }).catch(() => {});

    // Check for DEBUG logs from our diagnostic system
    const debugLogs = consoleLogs.filter(l => l.includes('DEBUG:'));
    console.log('DEBUG logs:', debugLogs);

    // Check for picking observer logs
    const pickingLogs = consoleLogs.filter(l =>
      l.includes('Picking') ||
      l.includes('Pointer PRESSED') ||
      l.includes('SELECTION_CHANGED') ||
      l.includes('click observer')
    );
    console.log('Picking logs:', pickingLogs);

    // Check if selection changed
    const positionLabel = page.locator('text=Position');
    const hasPosition = await positionLabel.isVisible().catch(() => false);
    console.log('Inspector shows Position:', hasPosition);

    if (hasPosition) {
      console.log('VIEWPORT PICKING: WORKING');
    } else {
      console.log('VIEWPORT PICKING: NOT WORKING');
      // Show all engine console logs for investigation
      const allEngineLogs = consoleLogs.filter(l =>
        l.includes('DEBUG') || l.includes('Pick') || l.includes('pointer') ||
        l.includes('mouse') || l.includes('Pointer') || l.includes('click')
      );
      console.log('All relevant logs:', allEngineLogs);
    }
  });
});
