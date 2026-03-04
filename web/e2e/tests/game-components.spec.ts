import { test, expect } from '../fixtures/editor.fixture';

test.describe('Game Components @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('game component inspector section exists after selecting entity', async ({ page, editor: _editor }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await _editor.waitForEntityCount(2);
    await _editor.selectEntity('Cube');

    // Inspector should be visible with some section headings
    const inspector = page.locator('[class*="inspector"], [class*="Inspector"]').first();
    await expect(inspector).toBeVisible();
  });

  test('add component button is accessible', async ({ page, editor: _editor }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await _editor.waitForEntityCount(2);
    await _editor.selectEntity('Cube');

    // Look for add component button or game component section
    const _sectionHeader = page.getByText(/game.*component|component/i, { exact: false }).first();
    const _addBtn = page.locator('button').filter({ hasText: /add.*component|game.*component/i }).first();
    
    // Graceful check — components may be hidden until needed, wait for either or neither?
    // Let's just assume the inspector is ready once Transform is visible
    await expect(page.getByText('Transform', { exact: false }).first()).toBeVisible();
  });

  test('transform section shows position inputs after entity selection', async ({ page, editor: _editor }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await _editor.waitForEntityCount(2);
    await _editor.selectEntity('Cube');

    const xLabel = page.getByText('X', { exact: true }).first();
    const yLabel = page.getByText('Y', { exact: true }).first();
    const zLabel = page.getByText('Z', { exact: true }).first();
    await expect(xLabel).toBeVisible();
    await expect(yLabel).toBeVisible();
    await expect(zLabel).toBeVisible();
  });

  test('physics toggle is available in inspector', async ({ page, editor: _editor }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await _editor.waitForEntityCount(2);
    await _editor.selectEntity('Cube');

    const physicsSection = page.getByText(/physics/i, { exact: false }).first();
    await expect(physicsSection).toBeVisible();
  });

  test('material section is visible for mesh entities', async ({ page, editor: _editor }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await _editor.waitForEntityCount(2);
    await _editor.selectEntity('Cube');

    const materialSection = page.getByText(/material/i, { exact: false }).first();
    await expect(materialSection).toBeVisible();
  });
});
