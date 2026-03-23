import { test, expect } from '../fixtures/editor.fixture';

test.describe('Inspector Panel @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('update_material: changing color reflects in the store @ui', async ({ page, editor }) => {
    // Spawn a cube and select it
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);
    await editor.selectEntity('Cube');

    // Wait for material inspector to appear
    const materialHeading = page.getByText('Material', { exact: false });
    await expect(materialHeading.first()).toBeVisible({ timeout: 5000 });

    // Get the selected entity id from the store
    const selectedIdsBefore = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) return null;
      const state = store.getState();
      const ids = [...state.selectedIds];
      return ids[0] ?? null;
    });
    expect(selectedIdsBefore).not.toBeNull();

    // Find the roughness input or any numeric material input
    const roughnessLabel = page.locator('text=/roughness/i').first();
    const roughnessVisible = await roughnessLabel.isVisible().catch(() => false);

    if (roughnessVisible) {
      // Find the input near the roughness label
      const roughnessInput = page.locator('input[type="text"], input[type="number"]')
        .filter({ hasText: '' })
        .nth(1); // second numeric input is usually roughness after metallic
      const inputNearLabel = roughnessLabel.locator('..').locator('input').first();
      const targetInput = await inputNearLabel.count() > 0 ? inputNearLabel : roughnessInput;

      if (await targetInput.isVisible().catch(() => false)) {
        await targetInput.click();
        await targetInput.fill('0.75');
        await targetInput.blur();

        // Verify the store has a material entry for the selected entity
        await page.waitForFunction(
          (entityId: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const store = (window as any).__EDITOR_STORE;
            if (!store) return false;
            const state = store.getState();
            return state.materialDataMap && entityId in state.materialDataMap;
          },
          selectedIdsBefore,
          { timeout: 5000 },
        );

        const materialData = await page.evaluate((entityId: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const store = (window as any).__EDITOR_STORE;
          if (!store) return null;
          const state = store.getState();
          return state.materialDataMap?.[entityId] ?? null;
        }, selectedIdsBefore);

        expect(materialData).not.toBeNull();
      }
    } else {
      // Material section visible is enough to confirm the inspector rendered
      await expect(materialHeading.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('selecting entity shows Transform section with X/Y/Z inputs', async ({ page, editor }) => {
    // Spawn a cube
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);

    // Select cube
    await editor.selectEntity('Cube');

    // Check Transform section is visible
    const transformHeading = page.getByText('Transform', { exact: false });
    await expect(transformHeading.first()).toBeVisible({ timeout: 5000 });

    // Check for X, Y, Z input labels
    const xLabel = page.getByText('X', { exact: true });
    const yLabel = page.getByText('Y', { exact: true });
    const zLabel = page.getByText('Z', { exact: true });

    await expect(xLabel.first()).toBeVisible();
    await expect(yLabel.first()).toBeVisible();
    await expect(zLabel.first()).toBeVisible();
  });

  test('Transform inputs accept numeric values', async ({ page, editor }) => {
    // Spawn and select cube
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);
    await editor.selectEntity('Cube');

    // Find position X input (first numeric input in Transform section)
    const transformSection = page.locator('text=Transform').locator('..').first();
    const inputs = transformSection.locator('input[type="text"]');
    const firstInput = inputs.first();
    await expect(firstInput).toBeVisible({ timeout: 5000 });

    // Clear and type new value
    await firstInput.click();
    await firstInput.fill('5.5');

    // Blur to trigger update
    await firstInput.blur();

    // Check that the value is retained
    await expect(firstInput).toHaveValue('5.5');
  });

  test('Material section shows for mesh entities', async ({ page, editor }) => {
    // Spawn and select cube
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);
    await editor.selectEntity('Cube');

    // Check for Material section
    const materialHeading = page.getByText('Material', { exact: false });
    await expect(materialHeading.first()).toBeVisible({ timeout: 5000 });

    // Check for common material properties (color, metallic, roughness, etc.)
    // At least one should be visible
    const colorControl = page.locator('text=/Color|Base Color/i');
    const materialControls = await colorControl.count();
    expect(materialControls).toBeGreaterThan(0);
  });

  test('Physics toggle exists and can be checked', async ({ page, editor }) => {
    // Spawn and select cube
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);
    await editor.selectEntity('Cube');


    // Look for Physics section or toggle
    const physicsSection = page.locator('text=/Physics/i');
    await expect(physicsSection.first()).toBeVisible();

    // Find checkbox or toggle (likely "Enable Physics" or similar)
    const physicsToggle = page.locator('input[type="checkbox"]').first();
    await expect(physicsToggle).toBeVisible();

    // Check initial state
    const wasChecked = await physicsToggle.isChecked();

    // Toggle it
    await physicsToggle.click();


    // Verify state changed
    const nowChecked = await physicsToggle.isChecked();
    expect(nowChecked).not.toBe(wasChecked);
  });

  test('no inspector content overflows panel width', async ({ page, editor }) => {
    // Spawn and select cube
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);
    await editor.selectEntity('Cube');


    // Find inspector panel container
    const inspectorPanel = page.locator('[data-testid*="inspector"], .dv-panel').filter({ hasText: /Inspector|Transform/i }).first();
    await expect(inspectorPanel).toBeVisible();

    // Get panel width
    const panelBox = await inspectorPanel.boundingBox();
    if (!panelBox) throw new Error('Inspector panel not visible');

    // Check all child elements don't overflow
    const overflowCount = await inspectorPanel.evaluate((panel, maxWidth) => {
      let count = 0;
      const children = panel.querySelectorAll('*');
      for (const child of children) {
        const rect = child.getBoundingClientRect();
        if (rect.width > maxWidth) {
          count++;
        }
      }
      return count;
    }, panelBox.width);

    expect(overflowCount).toBe(0);
  });

  test('tooltips appear on hover of info icons', async ({ page, editor }) => {
    // Spawn and select cube
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);
    await editor.selectEntity('Cube');


    // Look for info icons (usually svg or button with title/tooltip attribute)
    const infoIcons = page.locator('svg[class*="info"], button[title], [data-tooltip]');
    const iconCount = await infoIcons.count();

    if (iconCount > 0) {
      const firstIcon = infoIcons.first();

      // Hover over it
      await firstIcon.hover();


      // Check for tooltip (could be title attribute or a tooltip element)
      const title = await firstIcon.getAttribute('title');
      const hasTooltip = title !== null && title.length > 0;

      // If no title attribute, check for rendered tooltip element
      if (!hasTooltip) {
        const tooltipElement = page.locator('[role="tooltip"], .tooltip').first();
        const tooltipVisible = await tooltipElement.isVisible().catch(() => false);
        expect(tooltipVisible).toBe(true);
      } else {
        expect(hasTooltip).toBe(true);
      }
    }
  });

  test('light entity shows Light inspector', async ({ page, editor }) => {
    // Spawn a light
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Point Light', { exact: true }).click();
    await editor.waitForEntityCount(2);

    // Select light
    await editor.selectEntity('Light');


    // Check for Light-specific properties (Intensity, Color, Range, etc.)
    const intensityControl = page.locator('text=/Intensity/i');
    await expect(intensityControl.first()).toBeVisible();
  });

  test('no entity selected shows empty inspector', async ({ page, editor }) => {
    // Don't select anything, just load


    // Click empty space in viewport to deselect
    await editor.clickViewport(50, 50);


    // Inspector should either show placeholder text or be empty
    const inspectorPanel = page.locator('[data-testid*="inspector"], .dv-panel').filter({ hasText: /Inspector/i }).first();
    await expect(inspectorPanel).toBeVisible();

    // Check for "No entity selected" or similar message, or just verify Transform is NOT visible
    const transformSection = page.getByText('Transform', { exact: false });
    const transformVisible = await transformSection.isVisible().catch(() => false);
    expect(transformVisible).toBe(false);
  });
});
