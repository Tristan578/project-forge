import { test, expect } from '../fixtures/editor.fixture';

test.describe('Scene Settings', () => {
  test('scene settings panel can be opened', async ({ page, editor }) => {
    await editor.load();

    // Open scene settings panel via workspace
    const settingsBtn = page.getByRole('button', { name: /scene.*settings/i });
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await page.waitForTimeout(300);
    }

    // Check for scene settings panel title in dockview
    await editor.expectPanelVisible('Scene Settings');
  });

  test('scene settings has environment section', async ({ page, editor }) => {
    await editor.load();

    // Try to find and open scene settings
    const settingsBtn = page.getByRole('button', { name: /scene.*settings/i });
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await page.waitForTimeout(300);
    }

    // Look for environment-related controls
    const environmentSection = page.locator('text=/environment|background|clear.*color/i').first();
    const sectionExists = await environmentSection.count();
    expect(sectionExists).toBeGreaterThan(0);
  });

  test('scene settings has fog controls section', async ({ page, editor }) => {
    await editor.load();

    // Try to open scene settings
    const settingsBtn = page.getByRole('button', { name: /scene.*settings/i });
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await page.waitForTimeout(500);
    }

    // Look for fog controls
    const fogControl = page.locator('text=/fog|distance.*fog/i').first();
    const exists = await fogControl.count();
    expect(exists).toBeGreaterThan(0);
  });

  test('quality preset dropdown exists', async ({ page, editor }) => {
    await editor.load();

    // Try to open scene settings
    const settingsBtn = page.getByRole('button', { name: /scene.*settings/i });
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await page.waitForTimeout(500);
    }

    // Look for quality preset selector
    const qualitySelect = page.locator('select, [role="combobox"]').filter({ hasText: /quality|preset/i }).first();
    const labelExists = page.locator('text=/quality.*preset|rendering.*quality/i').first();

    const selectCount = await qualitySelect.count();
    const labelCount = await labelExists.count();
    expect(selectCount + labelCount).toBeGreaterThan(0);
  });

  test('post-processing section is present', async ({ page, editor }) => {
    await editor.load();

    // Try to open scene settings
    const settingsBtn = page.getByRole('button', { name: /scene.*settings/i });
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await page.waitForTimeout(500);
    }

    // Look for post-processing controls (bloom, color grading, etc.)
    const postProcessing = page.locator('text=/post.*process|bloom|color.*grad/i').first();
    const exists = await postProcessing.count();
    expect(exists).toBeGreaterThan(0);
  });

  test('skybox controls section exists', async ({ page, editor }) => {
    await editor.load();

    // Try to open scene settings
    const settingsBtn = page.getByRole('button', { name: /scene.*settings/i });
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await page.waitForTimeout(500);
    }

    // Look for skybox controls
    const skyboxControl = page.locator('text=/skybox|environment.*map/i').first();
    const exists = await skyboxControl.count();
    expect(exists).toBeGreaterThan(0);
  });

  test('mobile controls section is present', async ({ page, editor }) => {
    await editor.load();

    // Try to open scene settings
    const settingsBtn = page.getByRole('button', { name: /scene.*settings/i });
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await page.waitForTimeout(500);
    }

    // Look for mobile control settings
    const mobileControl = page.locator('text=/mobile.*control|touch.*control/i').first();
    const exists = await mobileControl.count();
    expect(exists).toBeGreaterThan(0);
  });
});
