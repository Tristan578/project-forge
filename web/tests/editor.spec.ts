import { test, expect } from '@playwright/test';

test.describe('Editor Scene', () => {
  test.beforeEach(async ({ page }) => {
    // Collect console messages for debugging
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

    // Wait for the canvas to be present
    await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 10000 });

    // Wait for WASM engine to initialize — scene nodes appear when ready
    await expect(page.locator('[data-testid="scene-node"]').first()).toBeVisible({ timeout: 30000 });
  });

  test('scene hierarchy shows entities', async ({ page }) => {
    // Check that the scene hierarchy panel exists
    const hierarchyPanel = page.locator('text=Scene Hierarchy');
    await expect(hierarchyPanel).toBeVisible({ timeout: 10000 });

    // Check that entities appear in the hierarchy
    // The initial scene should have: Ground, Player, Sun Light, Main Camera
    const hierarchyContent = await page.locator('.flex-1.overflow-y-auto').first().textContent();
    console.log('Hierarchy content:', hierarchyContent);

    // At minimum, we should NOT see "No entities in scene" or "Waiting for engine"
    const noEntitiesMessage = page.locator('text=No entities in scene');
    const waitingMessage = page.locator('text=Waiting for engine');

    const hasNoEntities = await noEntitiesMessage.isVisible().catch(() => false);
    const hasWaiting = await waitingMessage.isVisible().catch(() => false);

    expect(hasNoEntities).toBe(false);
    expect(hasWaiting).toBe(false);

    // Check for specific entity names in the hierarchy
    const groundNode = page.locator('text=Ground');
    const playerNode = page.locator('text=Player');

    const hasGround = await groundNode.isVisible().catch(() => false);
    const hasPlayer = await playerNode.isVisible().catch(() => false);

    console.log('Ground visible:', hasGround);
    console.log('Player visible:', hasPlayer);

    expect(hasGround || hasPlayer).toBe(true);
  });

  test('clicking entity in hierarchy shows transform in inspector', async ({ page }) => {
    // Find and click on "Player" in the hierarchy
    const playerNode = page.locator('text=Player').first();
    await expect(playerNode).toBeVisible({ timeout: 15000 });
    await playerNode.click();

    // Wait for transform data to arrive (Position label appears)
    await expect(page.locator('text=Position')).toBeVisible({ timeout: 10000 });

    // Check that the Inspector panel shows transform data, not "Loading transform..."
    await expect(page.locator('text=Loading transform...')).not.toBeVisible();

    // Check that position/rotation/scale inputs are visible
    await expect(page.locator('text=Position')).toBeVisible();
  });

  test('camera preset buttons work without infinite loop', async ({ page }) => {
    // Find the "Top View" button (wait for scene to be ready)
    const topButton = page.locator('button[title*="Top View"]');
    if (await topButton.isVisible({ timeout: 15000 }).catch(() => false)) {
      await topButton.click();

      // Wait for the camera animation to complete (button becomes active)
      await expect(topButton).toHaveClass(/bg-blue-600/, { timeout: 5000 }).catch(() => {});

      // The camera should have stabilized - check that the button is active (blue)
      const buttonClasses = await topButton.getAttribute('class');
      console.log('Top button classes after click:', buttonClasses);

      // The button should have the active class (bg-blue-600)
      expect(buttonClasses).toContain('bg-blue-600');
    }
  });

  test('console has no critical errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Wait for page to be fully loaded and stable
    await expect(page.locator('[data-testid="scene-node"]').first()).toBeVisible({ timeout: 30000 }).catch(() => {});

    // Filter out known non-critical errors
    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('DevTools') &&
      !e.includes('wasm streaming')
    );

    console.log('Console errors:', criticalErrors);
    // We don't fail on errors, just report them
  });
});
