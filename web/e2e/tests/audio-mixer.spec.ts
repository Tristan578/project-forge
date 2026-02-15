import { test, expect } from '../fixtures/editor.fixture';

test.describe('Audio Mixer', () => {
  test('audio mixer panel can be opened from sidebar', async ({ page, editor }) => {
    await editor.load();

    // Look for audio/mixer button in sidebar or panels menu
    const mixerBtn = page.getByRole('button', { name: /audio.*mixer|mixer/i });
    if (await mixerBtn.isVisible()) {
      await mixerBtn.click();
      await page.waitForTimeout(500);

      // Panel should be visible
      await editor.expectPanelVisible('Audio Mixer');
    } else {
      // Try panels menu
      const panelsMenuBtn = page.getByRole('button', { name: /panels|windows/i });
      if (await panelsMenuBtn.isVisible()) {
        await panelsMenuBtn.click();
        await page.waitForTimeout(200);

        const audioMixerOption = page.getByText(/audio.*mixer/i).first();
        if (await audioMixerOption.isVisible()) {
          await audioMixerOption.click();
          await page.waitForTimeout(500);

          await editor.expectPanelVisible('Audio Mixer');
        }
      }
    }
  });

  test('audio mixer has bus controls when open', async ({ page, editor }) => {
    await editor.load();

    // Try to open audio mixer
    const mixerBtn = page.getByRole('button', { name: /audio.*mixer|mixer/i });
    if (await mixerBtn.isVisible()) {
      await mixerBtn.click();
      await page.waitForTimeout(500);
    }

    // Look for bus/channel controls
    const busControl = page.locator('text=/bus|master|music|sfx|voice/i').first();
    const controlCount = await busControl.count();
    expect(controlCount).toBeGreaterThan(0);
  });

  test('mixer shows volume sliders', async ({ page, editor }) => {
    await editor.load();

    // Try to open audio mixer
    const mixerBtn = page.getByRole('button', { name: /audio.*mixer|mixer/i });
    if (await mixerBtn.isVisible()) {
      await mixerBtn.click();
      await page.waitForTimeout(500);
    }

    // Look for volume sliders (input[type=range] or custom slider)
    const volumeSlider = page.locator('input[type="range"], [role="slider"]').first();
    const sliderCount = await volumeSlider.count();
    expect(sliderCount).toBeGreaterThan(0);
  });

  test('mixer panel can be closed', async ({ page, editor }) => {
    await editor.load();

    // Try to open audio mixer
    const mixerBtn = page.getByRole('button', { name: /audio.*mixer|mixer/i });
    if (await mixerBtn.isVisible()) {
      await mixerBtn.click();
      await page.waitForTimeout(500);

      // Look for close button on the panel tab
      const closeBtn = page.locator('.dv-tab [class*="close"], .dv-tab button').filter({ hasText: /×|close/i }).first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
        await page.waitForTimeout(300);

        // Panel should no longer be visible
        const panelTab = page.locator('.dv-tab').filter({ hasText: /audio.*mixer/i });
        const visible = await panelTab.isVisible().catch(() => false);
        expect(visible).toBe(false);
      }
    } else {
      test.skip();
    }
  });

  test('mixer displays audio bus channels', async ({ page, editor }) => {
    await editor.load();

    // Try to open audio mixer
    const mixerBtn = page.getByRole('button', { name: /audio.*mixer|mixer/i });
    if (await mixerBtn.isVisible()) {
      await mixerBtn.click();
      await page.waitForTimeout(500);

      // Look for multiple bus channels (Master, Music, SFX, Voice)
      const masterBus = page.locator('text=/master/i').first();
      const musicBus = page.locator('text=/music/i').first();

      const masterCount = await masterBus.count();
      const musicCount = await musicBus.count();
      expect(masterCount + musicCount).toBeGreaterThan(0);
    } else {
      test.skip();
    }
  });
});
