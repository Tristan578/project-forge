/** Verify mobile cookie consent touch targets and explicit keyboard choices. */
import { expect, test, type Page } from '@playwright/test';

/** Assert actual mobile consent geometry instead of depending on CSS class names. */
async function expectMobileConsentTargets(page: Page) {
  const banner = page.getByRole('region', { name: 'Cookie consent' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Optional analytics cookies');
  await expect(banner).toContainText('accept or decline');
  for (const name of ['Accept', 'Decline']) {
    const button = banner.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const bounds = await button.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  return banner;
}

test.use({ viewport: { width: 320, height: 740 } });

test('@ui mobile cookie consent declines optional analytics via keyboard', async ({ page }) => {
  await page.goto('/docs');
  const banner = await expectMobileConsentTargets(page);
  await banner.getByRole('button', { name: 'Decline', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(banner).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('forge-cookie-consent'))).toBe('false');
  expect(await page.context().cookies()).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'forge-cookie-consent', value: 'false', sameSite: 'Lax' }),
  ]));
});

test('@ui mobile cookie consent accepts optional analytics via keyboard', async ({ page }) => {
  await page.goto('/docs');
  const banner = await expectMobileConsentTargets(page);
  await banner.getByRole('button', { name: 'Accept', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(banner).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('forge-cookie-consent'))).toBe('true');
  expect(await page.context().cookies()).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'forge-cookie-consent', value: 'true', sameSite: 'Lax' }),
  ]));
});


test('@ui cookie consent remains dismissible when browser storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem'] as const) {
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value: () => { throw new DOMException('Storage blocked', 'SecurityError'); },
      });
    }
  });
  await page.goto('/docs');
  const banner = await expectMobileConsentTargets(page);
  await banner.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(banner).toBeHidden();
  expect(await page.context().cookies()).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'forge-cookie-consent', value: 'false' }),
  ]));
});
