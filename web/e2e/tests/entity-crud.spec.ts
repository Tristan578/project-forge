import { test, expect } from '../fixtures/editor.fixture';

test.describe('Entity CRUD Operations', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('spawn cube from sidebar - entity appears in hierarchy', async ({ page, editor }) => {
    // Open add entity menu
    await page.getByRole('button', { name: 'Add Entity' }).click();

    // Click Cube menu item
    await page.getByText('Cube', { exact: true }).click();

    // Wait for entity to appear in scene graph
    await editor.waitForEntityCount(2); // Camera + Cube

    // Check hierarchy shows the new cube
    const cubeElement = page.getByText(/Cube/, { exact: false });
    await expect(cubeElement.first()).toBeVisible();
  });

  test('select entity by hierarchy click - inspector shows properties', async ({ page, editor }) => {
    // Spawn a cube
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);

    // Click cube in hierarchy
    await editor.selectEntity('Cube');

    // Wait for selection state update
    await page.waitForTimeout(300);

    // Check that inspector panel is showing
    await editor.expectPanelVisible('Inspector');

    // Check that Transform section is visible
    const transformSection = page.getByText('Transform', { exact: false });
    await expect(transformSection.first()).toBeVisible();
  });

  test('delete entity with Delete key - entity removed from hierarchy', async ({ page, editor }) => {
    // Spawn a cube
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);

    // Select the cube
    await editor.selectEntity('Cube');
    await page.waitForTimeout(200);

    // Press Delete key
    await page.keyboard.press('Delete');

    // Wait for deletion to process
    await page.waitForTimeout(500);

    // Check that cube is no longer in hierarchy (only Camera remains)
    const sceneNodes = await editor.getStoreState<Record<string, unknown>>('sceneGraph.nodes');
    expect(Object.keys(sceneNodes).length).toBe(1);
  });

  test('undo with Ctrl+Z - entity restored after deletion', async ({ page, editor }) => {
    // Spawn a cube
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);

    // Select and delete
    await editor.selectEntity('Cube');
    await page.waitForTimeout(200);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);

    // Undo
    await editor.pressShortcut('Control+z');
    await page.waitForTimeout(500);

    // Check that cube is restored
    await editor.waitForEntityCount(2);
    const cubeElement = page.getByText(/Cube/, { exact: false });
    await expect(cubeElement.first()).toBeVisible();
  });

  test('duplicate entity with Ctrl+D - new entity in hierarchy', async ({ page, editor }) => {
    // Spawn a cube
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);

    // Select cube
    await editor.selectEntity('Cube');
    await page.waitForTimeout(200);

    // Duplicate with Ctrl+D
    await editor.pressShortcut('Control+d');
    await page.waitForTimeout(500);

    // Check that we now have 3 entities (Camera + Cube + Cube Copy)
    await editor.waitForEntityCount(3);
    const sceneNodes = await editor.getStoreState<Record<string, unknown>>('sceneGraph.nodes');
    expect(Object.keys(sceneNodes).length).toBe(3);
  });

  test('spawn multiple entity types - all appear in hierarchy', async ({ page, editor }) => {
    const entityTypes = ['Cube', 'Sphere', 'Plane'];

    for (const type of entityTypes) {
      // Open menu and spawn entity
      await page.getByRole('button', { name: 'Add Entity' }).click();
      await page.getByText(type, { exact: true }).click();
      await page.waitForTimeout(300);
    }

    // Wait for all entities to spawn (Camera + 3 entities = 4)
    await editor.waitForEntityCount(4);

    // Check that each entity type is in hierarchy
    for (const type of entityTypes) {
      const element = page.getByText(type, { exact: false });
      await expect(element.first()).toBeVisible();
    }
  });

  test('spawn light entity - appears in hierarchy', async ({ page, editor }) => {
    // Open add entity menu
    await page.getByRole('button', { name: 'Add Entity' }).click();

    // Scroll or find Light section, click Point Light
    await page.getByText('Point Light', { exact: true }).click();

    // Wait for entity to appear
    await editor.waitForEntityCount(2);

    // Check hierarchy shows the light
    const lightElement = page.getByText(/Point Light|Light/, { exact: false });
    await expect(lightElement.first()).toBeVisible();
  });
});
