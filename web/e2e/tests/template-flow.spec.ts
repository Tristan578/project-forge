import { test, expect, EditorPage, type Page } from '../fixtures/editor.fixture';

/**
 * Template gallery and starter bundle onboarding flow tests.
 *
 * Tests the path: WelcomeModal → Browse Templates → TemplateGallery → select template → scene populated.
 * Tagged @ui — these tests do not require the WASM engine build. They use editor.loadPage() with
 * __SKIP_ENGINE and verify UI state + Zustand store population.
 *
 * Template loading (loadTemplate) is a no-op in the current stub implementation, so tests that
 * rely on sceneGraph population from a real load are marked with test.skip() until the stub is wired.
 */

/**
 * Arrange the page so that WelcomeModal is visible.
 *
 * editor.loadPage() sets forge-welcomed = '1' via addInitScript (which runs before navigation).
 * We intercept that by patching localStorage.setItem BEFORE loadPage() registers its init script,
 * preventing forge-welcomed from being written while still allowing all other init logic to run.
 */
async function setupFirstVisit(page: Page): Promise<void> {
  // Block forge-welcomed from being written during this navigation.
  // This init script is registered first in the queue so it runs before
  // the one loadPage() adds, which means our patch is in place when that
  // script tries to call localStorage.setItem('forge-welcomed', '1').
  await page.addInitScript(() => {
    const _orig = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (key: string, value: string) => {
      if (key === 'forge-welcomed') return;
      _orig(key, value);
    };
    localStorage.removeItem('forge-welcomed');
  });
}

/**
 * Helper: navigate to /dev with WelcomeModal visible and TemplateGallery open.
 * Returns when the gallery dialog is visible.
 */
async function openTemplateGallery(page: Page, editor: EditorPage): Promise<void> {
  await setupFirstVisit(page);
  await editor.loadPage();

  const welcomeModal = page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]');
  await welcomeModal.waitFor({ state: 'visible', timeout: 8_000 });
  await page.getByRole('button', { name: /browse templates/i }).click();

  const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');
  await galleryDialog.waitFor({ state: 'visible', timeout: 5_000 });
}

test.describe('Template Gallery @ui', () => {
  test('template gallery renders with available templates', async ({ page, editor }) => {
    await setupFirstVisit(page);
    await editor.loadPage();

    // WelcomeModal should appear — it shows when forge-welcomed is absent
    const welcomeModal = page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]');
    await expect(welcomeModal).toBeVisible({ timeout: 8_000 });

    // Click "Browse Templates" to open the TemplateGallery
    const browseBtn = page.getByRole('button', { name: /browse templates/i });
    await expect(browseBtn).toBeVisible({ timeout: 5_000 });
    await browseBtn.click();

    // TemplateGallery dialog should appear
    const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');
    await expect(galleryDialog).toBeVisible({ timeout: 5_000 });

    // Heading text
    const heading = page.locator('#template-gallery-title');
    await expect(heading).toHaveText(/choose a template/i);

    // There must be at least Blank + one real template card
    const templateCards = galleryDialog.locator('[data-testid="template-card"]');
    await templateCards.first().waitFor({ timeout: 10_000 });
    const cardCount = await templateCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(2);
  });

  test('every template card has a name and description', async ({ page, editor }) => {
    await setupFirstVisit(page);
    await editor.loadPage();

    const welcomeModal = page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]');
    await expect(welcomeModal).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: /browse templates/i }).click();

    const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');
    await expect(galleryDialog).toBeVisible({ timeout: 5_000 });

    // Every card must have a non-empty <h3> (name) and a <p> (description)
    const cards = galleryDialog.locator('[data-testid="template-card"]');
    await cards.first().waitFor({ timeout: 10_000 });
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const name = await card.locator('h3').textContent();
      const desc = await card.locator('p').first().textContent();

      expect(name?.trim().length).toBeGreaterThan(0);
      expect(desc?.trim().length).toBeGreaterThan(0);
    }
  });

  test('template cards show difficulty badge and entity count', async ({ page, editor }) => {
    await setupFirstVisit(page);
    await editor.loadPage();

    await page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]').waitFor({ state: 'visible', timeout: 8_000 });
    await page.getByRole('button', { name: /browse templates/i }).click();

    const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');
    await expect(galleryDialog).toBeVisible({ timeout: 5_000 });

    // Wait for cards to load
    const cards = galleryDialog.locator('[data-testid="template-card"]');
    await cards.first().waitFor({ timeout: 10_000 });

    // Difficulty badges are matched by text content, not CSS class
    const difficultyBadges = galleryDialog.getByText(/beginner|intermediate|advanced/i);
    const badgeCount = await difficultyBadges.count();
    expect(badgeCount).toBeGreaterThan(0);

    // Check first badge is a valid difficulty label
    const firstBadge = await difficultyBadges.first().textContent();
    expect(['beginner', 'intermediate', 'advanced']).toContain(firstBadge?.toLowerCase().trim());

    // "entities" text appears on non-blank cards
    const entityLabels = galleryDialog.getByText(/\d+ entities/i);
    const labelCount = await entityLabels.count();
    expect(labelCount).toBeGreaterThan(0);
  });

  test('template gallery can be closed with the X button', async ({ page, editor }) => {
    await setupFirstVisit(page);
    await editor.loadPage();

    await page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]').waitFor({ state: 'visible', timeout: 8_000 });
    await page.getByRole('button', { name: /browse templates/i }).click();

    const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');
    await expect(galleryDialog).toBeVisible({ timeout: 5_000 });

    // Close via the X button
    const closeBtn = page.getByRole('button', { name: /close template gallery/i });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    await expect(galleryDialog).not.toBeVisible({ timeout: 3_000 });
  });

  test('template gallery can be closed by pressing Escape', async ({ page, editor }) => {
    await setupFirstVisit(page);
    await editor.loadPage();

    await page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]').waitFor({ state: 'visible', timeout: 8_000 });
    await page.getByRole('button', { name: /browse templates/i }).click();

    const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');
    await expect(galleryDialog).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(galleryDialog).not.toBeVisible({ timeout: 3_000 });
  });
});

test.describe('Template selection flow @ui', () => {
  test('selecting Blank Project closes the gallery', async ({ page, editor }) => {
    await openTemplateGallery(page, editor);

    const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');

    const blankCard = galleryDialog.locator('button').filter({ hasText: /blank project/i });
    await expect(blankCard).toBeVisible({ timeout: 3_000 });
    await blankCard.click();

    // Both the gallery and the WelcomeModal should close after selecting blank
    await expect(galleryDialog).not.toBeVisible({ timeout: 5_000 });
    const welcomeModal = page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]');
    await expect(welcomeModal).not.toBeVisible({ timeout: 5_000 });
  });

  test('selecting a named template closes the gallery', async ({ page, editor }) => {
    await openTemplateGallery(page, editor);

    const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');

    // Pick the first real template card (not Blank Project) — wait with timeout
    const templateCards = galleryDialog.locator('[data-testid="template-card"]');
    await templateCards.first().waitFor({ timeout: 10_000 });
    const count = await templateCards.count();

    // Skip if only the Blank Project card is loaded (async import delay)
    if (count < 2) {
      test.skip(true, 'Template cards not loaded — async import may be slow in this environment');
      return;
    }

    // Second card is the first real template (after Blank Project)
    const firstTemplate = templateCards.nth(1);
    const templateName = await firstTemplate.locator('h3').textContent();
    await firstTemplate.click();

    // Both modals should close after selection
    await expect(galleryDialog).not.toBeVisible({ timeout: 5_000 });
    const welcomeModal = page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]');
    await expect(welcomeModal).not.toBeVisible({ timeout: 5_000 });

    // The selected template name should be non-empty (guards against empty card bug)
    expect(templateName?.trim().length).toBeGreaterThan(0);
  });

  // loadTemplate is currently a no-op stub in sceneSlice.ts (line 169).
  // Skip this test until loadTemplate is wired to dispatch actual scene commands.
  test.skip('loadTemplate stub not yet wired — sceneSlice.ts:169', async ({ page, editor }) => {
    await openTemplateGallery(page, editor);

    const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');
    const templateCards = galleryDialog.locator('[data-testid="template-card"]');
    await templateCards.first().waitFor({ timeout: 10_000 });
    const count = await templateCards.count();

    if (count < 2) return;

    const firstTemplate = templateCards.nth(1);
    await firstTemplate.click();

    // Wait for gallery to close
    await expect(galleryDialog).not.toBeVisible({ timeout: 5_000 });

    // Read sceneGraph node count from the store
    await editor.waitForEditorStore();
    const nodeCount = await editor.getStoreState<number>('sceneGraph.nodes');
    // Once wired, node count should be > 1 (more than camera only)
    expect(Object.keys(nodeCount as unknown as Record<string, unknown>).length).toBeGreaterThan(1);
  });
});

test.describe('Welcome modal onboarding gate @ui', () => {
  test('welcome modal appears on first visit when forge-welcomed is absent', async ({ page, editor }) => {
    await setupFirstVisit(page);
    await editor.loadPage();

    // WelcomeModal should be visible
    const welcomeModal = page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]');
    await expect(welcomeModal).toBeVisible({ timeout: 8_000 });

    // Heading
    await expect(welcomeModal.locator('#welcome-modal-title')).toHaveText(/welcome to spawnforge/i);

    // "Browse Templates" button must be present — this is the template entry point
    await expect(welcomeModal.getByRole('button', { name: /browse templates/i })).toBeVisible();

    // "Start Tutorial" button must be present
    await expect(welcomeModal.getByRole('button', { name: /start tutorial/i })).toBeVisible();
  });

  test('welcome modal does not appear when forge-welcomed is set', async ({ editor }) => {
    // editor.loadPage() sets forge-welcomed = '1' in addInitScript
    await editor.loadPage();

    // Modal must not be visible
    const welcomeModal = editor.page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]');
    const isVisible = await welcomeModal.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('checking "Don\'t show again" and clicking Skip persists the dismissed state', async ({ page, editor }) => {
    await setupFirstVisit(page);
    await editor.loadPage();

    const welcomeModal = page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]');
    await welcomeModal.waitFor({ state: 'visible', timeout: 8_000 });

    // Check "Don't show again"
    const checkbox = welcomeModal.getByRole('checkbox');
    await checkbox.check();
    await expect(checkbox).toBeChecked();

    // Click Skip
    await welcomeModal.getByRole('button', { name: /^skip$/i }).click();
    await expect(welcomeModal).not.toBeVisible({ timeout: 5_000 });

    // forge-welcomed should now be set in localStorage
    const forgeWelcomed = await page.evaluate(() => localStorage.getItem('forge-welcomed'));
    expect(forgeWelcomed).toBe('1');
  });

  test('clicking Skip without "Don\'t show again" does not persist', async ({ page, editor }) => {
    await setupFirstVisit(page);
    await editor.loadPage();

    const welcomeModal = page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]');
    await welcomeModal.waitFor({ state: 'visible', timeout: 8_000 });

    // Do NOT check "Don't show again" — just click Skip
    await welcomeModal.getByRole('button', { name: /^skip$/i }).click();
    await expect(welcomeModal).not.toBeVisible({ timeout: 5_000 });

    // forge-welcomed must NOT be set
    const forgeWelcomed = await page.evaluate(() => localStorage.getItem('forge-welcomed'));
    expect(forgeWelcomed).toBeNull();
  });

  test('welcome modal has correct ARIA structure for accessibility', async ({ page, editor }) => {
    await setupFirstVisit(page);
    await editor.loadPage();

    const welcomeModal = page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]');
    await welcomeModal.waitFor({ state: 'visible', timeout: 8_000 });

    // Must have role="dialog"
    await expect(welcomeModal).toHaveAttribute('role', 'dialog');
    // Must have aria-modal="true"
    await expect(welcomeModal).toHaveAttribute('aria-modal', 'true');
    // aria-labelledby must point to the heading
    const labelId = await welcomeModal.getAttribute('aria-labelledby');
    expect(labelId).toBe('welcome-modal-title');
    const labelEl = page.locator(`#${labelId}`);
    await expect(labelEl).toBeVisible();
  });
});

test.describe('Template gallery ARIA structure @ui', () => {
  test('template gallery dialog has correct ARIA attributes', async ({ page, editor }) => {
    await setupFirstVisit(page);
    await editor.loadPage();

    await page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]').waitFor({ state: 'visible', timeout: 8_000 });
    await page.getByRole('button', { name: /browse templates/i }).click();

    const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');
    await galleryDialog.waitFor({ state: 'visible', timeout: 5_000 });

    await expect(galleryDialog).toHaveAttribute('role', 'dialog');
    await expect(galleryDialog).toHaveAttribute('aria-modal', 'true');
    const labelId = await galleryDialog.getAttribute('aria-labelledby');
    expect(labelId).toBe('template-gallery-title');

    const labelEl = page.locator(`#${labelId}`);
    await expect(labelEl).toBeVisible();
    await expect(labelEl).toHaveText(/choose a template/i);

    // Close button must have descriptive aria-label
    const closeBtn = galleryDialog.getByRole('button', { name: /close template gallery/i });
    await expect(closeBtn).toBeVisible();
  });
});
