import { test, expect } from '../fixtures/editor.fixture';

test.describe('Editor Scene @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('scene hierarchy shows entities', async ({ page }) => {

    // Check that the scene hierarchy panel exists
    const hierarchyPanel = page.locator('text=Scene Hierarchy');
    await expect(hierarchyPanel).toBeVisible({ timeout: 10000 });

    // Check that entities appear in the hierarchy — none of the empty-state messages
    const noEntitiesMessage = page.locator('text=No entities in scene');
    const waitingMessage = page.locator('text=Waiting for engine');

    const hasNoEntities = await noEntitiesMessage.isVisible().catch(() => false);
    const hasWaiting = await waitingMessage.isVisible().catch(() => false);

    expect(hasNoEntities).toBe(false);
    expect(hasWaiting).toBe(false);

    // The initial scene should have at least one of: Ground, Player
    const groundNode = page.locator('text=Ground');
    const playerNode = page.locator('text=Player');

    const hasGround = await groundNode.isVisible().catch(() => false);
    const hasPlayer = await playerNode.isVisible().catch(() => false);

    expect(hasGround || hasPlayer).toBe(true);
  });

  test('clicking entity in hierarchy shows transform in inspector', async ({ page }) => {
    const playerNode = page.locator('text=Player').first();
    if (await playerNode.isVisible({ timeout: 15000 }).catch(() => false)) {
      await playerNode.click();

      // Wait for transform data to arrive (Position label appears)
      await expect(page.locator('text=Position')).toBeVisible({ timeout: 10000 });

      // Check that the Inspector panel shows transform data, not "Loading transform..."
      const loadingMessage = page.locator('text=Loading transform...');
      const isLoading = await loadingMessage.isVisible().catch(() => false);
      expect(isLoading).toBe(false);

      // Position label should be visible
      await expect(page.locator('text=Position').first()).toBeVisible();
    } else {
      throw new Error('Player node not found in hierarchy');
    }
  });

  test('camera preset buttons work without infinite loop', async ({ page }) => {
    const topButton = page.locator('button[title*="Top View"]');
    if (await topButton.isVisible({ timeout: 15000 }).catch(() => false)) {
      await topButton.click();

      // Wait for the camera animation to complete (button becomes active)
      await expect(topButton).toHaveClass(/bg-blue-600/, { timeout: 5000 }).catch(() => {});

      // The button should have the active class (bg-blue-600)
      const buttonClasses = await topButton.getAttribute('class');
      expect(buttonClasses).toContain('bg-blue-600');
    }
  });

});

// Standalone test: registers console listener BEFORE load to capture all load-time errors
test('Editor Scene console has no critical errors @engine', async ({ page, editor }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  await editor.load();

  // Filter out known non-critical errors
  const criticalErrors = errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('DevTools') &&
      !e.includes('wasm streaming'),
  );

  expect(criticalErrors).toHaveLength(0);
});
