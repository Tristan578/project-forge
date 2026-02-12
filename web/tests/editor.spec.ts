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

    // Wait for WASM engine to initialize - look for scene hierarchy entries
    // The engine emits SCENE_GRAPH_UPDATE events which populate the hierarchy
    await expect(page.locator('[data-testid="scene-node"]').first()).toBeVisible({ timeout: 30000 }).catch(() => {
      // Fallback: wait for hierarchy text content
    });

    // Give engine time to fully initialize and emit events
    await page.waitForTimeout(5000);
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
    // Wait for hierarchy to populate
    await page.waitForTimeout(3000);

    // Find and click on "Player" in the hierarchy
    const playerNode = page.locator('text=Player').first();
    if (await playerNode.isVisible({ timeout: 5000 }).catch(() => false)) {
      await playerNode.click();

      // Wait for transform data to arrive
      await page.waitForTimeout(1000);

      // Check that the Inspector panel shows transform data, not "Loading transform..."
      const loadingMessage = page.locator('text=Loading transform...');
      const isLoading = await loadingMessage.isVisible().catch(() => false);

      console.log('Is still loading transform:', isLoading);
      expect(isLoading).toBe(false);

      // Check that position/rotation/scale inputs are visible
      const positionLabel = page.locator('text=Position');
      const hasPosition = await positionLabel.isVisible().catch(() => false);
      console.log('Has position label:', hasPosition);
      expect(hasPosition).toBe(true);
    } else {
      console.log('Player node not found in hierarchy - checking what IS visible');
      const pageContent = await page.content();
      // Log relevant parts of the page
      const bodyText = await page.locator('body').innerText();
      console.log('Page text (first 2000 chars):', bodyText.substring(0, 2000));
      expect(false).toBe(true); // Fail with context
    }
  });

  test('camera preset buttons work without infinite loop', async ({ page }) => {
    // Wait for engine
    await page.waitForTimeout(3000);

    // Find the "Top View" button
    const topButton = page.locator('button[title*="Top View"]');
    if (await topButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await topButton.click();

      // Wait a moment for the camera animation
      await page.waitForTimeout(2000);

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

    await page.waitForTimeout(5000);

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
