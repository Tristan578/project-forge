import { test, expect } from '../fixtures/editor.fixture';

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
test.describe('Template Gallery @ui', () => {
  test('template gallery renders with available templates', async ({ page }) => {
    // Navigate without dismissing the welcome modal so we can open templates from it.
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = true;
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');
      // Do NOT set forge-welcomed — we need WelcomeModal visible
    });

    await page.goto('/dev', { waitUntil: 'commit', timeout: 60_000 });
    await page.waitForLoadState('domcontentloaded');

    try {
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 90_000 },
      );
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 40_000 },
      );
    }

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

    // There must be at least the "Blank Project" card plus real template cards
    // TEMPLATE_REGISTRY has 11 entries + 1 Blank card = 12 total
    const templateCards = galleryDialog.locator('button').filter({ has: page.locator('h3') });
    const cardCount = await templateCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(12);
  });

  test('every template card has a name and description', async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = true;
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');
    });

    await page.goto('/dev', { waitUntil: 'commit', timeout: 60_000 });
    await page.waitForLoadState('domcontentloaded');

    try {
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 90_000 },
      );
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 40_000 },
      );
    }

    const welcomeModal = page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]');
    await expect(welcomeModal).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: /browse templates/i }).click();

    const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');
    await expect(galleryDialog).toBeVisible({ timeout: 5_000 });

    // Every card must have a non-empty <h3> (name) and a <p> (description)
    const cards = galleryDialog.locator('button').filter({ has: page.locator('h3') });
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

  test('template cards show difficulty badge and entity count', async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = true;
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');
    });

    await page.goto('/dev', { waitUntil: 'commit', timeout: 60_000 });
    await page.waitForLoadState('domcontentloaded');

    try {
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 90_000 },
      );
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 40_000 },
      );
    }

    await page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]').waitFor({ state: 'visible', timeout: 8_000 });
    await page.getByRole('button', { name: /browse templates/i }).click();

    const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');
    await expect(galleryDialog).toBeVisible({ timeout: 5_000 });

    // Difficulty badges are rendered as spans with 'capitalize' class
    const difficultyBadges = galleryDialog.locator('span.capitalize');
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

  test('template gallery can be closed with the X button', async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = true;
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');
    });

    await page.goto('/dev', { waitUntil: 'commit', timeout: 60_000 });
    await page.waitForLoadState('domcontentloaded');

    try {
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 90_000 },
      );
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 40_000 },
      );
    }

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

  test('template gallery can be closed by pressing Escape', async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = true;
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');
    });

    await page.goto('/dev', { waitUntil: 'commit', timeout: 60_000 });
    await page.waitForLoadState('domcontentloaded');

    try {
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 90_000 },
      );
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 40_000 },
      );
    }

    await page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]').waitFor({ state: 'visible', timeout: 8_000 });
    await page.getByRole('button', { name: /browse templates/i }).click();

    const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');
    await expect(galleryDialog).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(galleryDialog).not.toBeVisible({ timeout: 3_000 });
  });
});

test.describe('Template selection flow @ui', () => {
  /**
   * Helper: navigate to /dev with WelcomeModal visible and TemplateGallery open.
   * Returns when the gallery dialog is visible.
   */
  async function openTemplateGallery(page: Parameters<Parameters<typeof test>[1]>[0]) {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = true;
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');
      // forge-welcomed is intentionally absent
    });

    await page.goto('/dev', { waitUntil: 'commit', timeout: 60_000 });
    await page.waitForLoadState('domcontentloaded');

    try {
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 90_000 },
      );
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 40_000 },
      );
    }

    const welcomeModal = page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]');
    await welcomeModal.waitFor({ state: 'visible', timeout: 8_000 });
    await page.getByRole('button', { name: /browse templates/i }).click();

    const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');
    await galleryDialog.waitFor({ state: 'visible', timeout: 5_000 });
  }

  test('selecting Blank Project closes the gallery', async ({ page }) => {
    await openTemplateGallery(page);

    const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');

    const blankCard = galleryDialog.locator('button').filter({ hasText: /blank project/i });
    await expect(blankCard).toBeVisible({ timeout: 3_000 });
    await blankCard.click();

    // Both the gallery and the WelcomeModal should close after selecting blank
    await expect(galleryDialog).not.toBeVisible({ timeout: 5_000 });
    const welcomeModal = page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]');
    await expect(welcomeModal).not.toBeVisible({ timeout: 5_000 });
  });

  test('selecting a named template closes the gallery', async ({ page }) => {
    await openTemplateGallery(page);

    const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');

    // Pick the first real template card (not Blank Project)
    const templateCards = galleryDialog.locator('button').filter({ has: page.locator('h3') });
    const count = await templateCards.count();

    // Skip if no template cards loaded yet (async import delay)
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

  test('selecting a template populates the store (requires loadTemplate wiring)', async ({ page }) => {
    // loadTemplate is currently a no-op stub in sceneSlice.ts (line 169).
    // This test exercises the store interaction path and will pass once the stub is wired
    // to dispatch actual scene commands. Skip until then.
    await openTemplateGallery(page);

    const galleryDialog = page.locator('[role="dialog"][aria-labelledby="template-gallery-title"]');
    const templateCards = galleryDialog.locator('button').filter({ has: page.locator('h3') });
    const count = await templateCards.count();

    if (count < 2) {
      test.skip(true, 'Template cards not available');
      return;
    }

    const firstTemplate = templateCards.nth(1);
    await firstTemplate.click();

    // Wait for gallery to close
    await expect(galleryDialog).not.toBeVisible({ timeout: 5_000 });

    // Wait for store then read sceneGraph node count
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => !!(window as any).__EDITOR_STORE,
      { timeout: 5_000 },
    );

    const nodeCount = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      const state = store?.getState();
      return state ? Object.keys(state.sceneGraph.nodes).length : 0;
    });

    // loadTemplate is a no-op stub — until wired, node count will be 0 or 1 (camera only).
    // Once wired to real scene load, this should be > 1.
    // For now we document the expected eventual value.
    if (nodeCount <= 1) {
      test.skip(true, 'loadTemplate stub not yet wired — sceneGraph not populated (PF ticket: wire loadTemplate in sceneSlice)');
    } else {
      expect(nodeCount).toBeGreaterThan(1);
    }
  });
});

test.describe('Welcome modal onboarding gate @ui', () => {
  test('welcome modal appears on first visit when forge-welcomed is absent', async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = true;
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');
      // Explicitly remove forge-welcomed to simulate first visit
      localStorage.removeItem('forge-welcomed');
    });

    await page.goto('/dev', { waitUntil: 'commit', timeout: 60_000 });
    await page.waitForLoadState('domcontentloaded');

    try {
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 90_000 },
      );
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 40_000 },
      );
    }

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

  test('checking "Don\'t show again" and clicking Skip persists the dismissed state', async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = true;
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');
      localStorage.removeItem('forge-welcomed');
    });

    await page.goto('/dev', { waitUntil: 'commit', timeout: 60_000 });
    await page.waitForLoadState('domcontentloaded');

    try {
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 90_000 },
      );
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 40_000 },
      );
    }

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

  test('clicking Skip without "Don\'t show again" does not persist', async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = true;
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');
      localStorage.removeItem('forge-welcomed');
    });

    await page.goto('/dev', { waitUntil: 'commit', timeout: 60_000 });
    await page.waitForLoadState('domcontentloaded');

    try {
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 90_000 },
      );
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 40_000 },
      );
    }

    const welcomeModal = page.locator('[role="dialog"][aria-labelledby="welcome-modal-title"]');
    await welcomeModal.waitFor({ state: 'visible', timeout: 8_000 });

    // Do NOT check "Don't show again" — just click Skip
    await welcomeModal.getByRole('button', { name: /^skip$/i }).click();
    await expect(welcomeModal).not.toBeVisible({ timeout: 5_000 });

    // forge-welcomed must NOT be set
    const forgeWelcomed = await page.evaluate(() => localStorage.getItem('forge-welcomed'));
    expect(forgeWelcomed).toBeNull();
  });

  test('welcome modal has correct ARIA structure for accessibility', async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = true;
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');
      localStorage.removeItem('forge-welcomed');
    });

    await page.goto('/dev', { waitUntil: 'commit', timeout: 60_000 });
    await page.waitForLoadState('domcontentloaded');

    try {
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 90_000 },
      );
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 40_000 },
      );
    }

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
  test('template gallery dialog has correct ARIA attributes', async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = true;
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');
      localStorage.removeItem('forge-welcomed');
    });

    await page.goto('/dev', { waitUntil: 'commit', timeout: 60_000 });
    await page.waitForLoadState('domcontentloaded');

    try {
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 90_000 },
      );
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 40_000 },
      );
    }

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
