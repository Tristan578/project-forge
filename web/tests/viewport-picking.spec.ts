import { test, expect } from '@playwright/test';

test.describe('Viewport Picking', () => {
  test('clicking on 3D object in viewport selects it', async ({ page }) => {
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 10000 });

    // Wait for engine to fully initialize and entities to appear in hierarchy
    await page.waitForTimeout(6000);

    // Verify hierarchy has entities (engine is ready)
    const groundNode = page.locator('text=Ground');
    await expect(groundNode.first()).toBeVisible({ timeout: 10000 });

    // Get canvas dimensions for click targeting
    const canvas = page.locator('#game-canvas');
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
    await canvas.click({ position: { x: centerX, y: centerY } });
    await page.waitForTimeout(2000);

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
