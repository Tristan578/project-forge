import { test as base, expect, type Page } from '@playwright/test';

/**
 * Page Object Model for the Project Forge editor.
 * Wraps common navigation, WASM wait, and interaction patterns.
 */
export class EditorPage {
  constructor(public page: Page) {}

  /** Navigate to /dev and wait for WASM engine to initialize */
  async load() {
    await this.page.goto('/dev');
    // Wait for the WASM engine to report ready
    await this.page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__FORGE_ENGINE_READY === true,
      { timeout: 30_000 }
    );
    // Give dockview a moment to finish layout
    await this.page.waitForTimeout(500);
  }

  /** Navigate to /dev without waiting for WASM (for CSS-only tests) */
  async loadPage() {
    await this.page.goto('/dev');
    // Wait for React to render (no WASM dependency)
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(1000);
  }

  /** Wait for a minimum entity count in the scene graph */
  async waitForEntityCount(count: number) {
    await this.page.waitForFunction(
      (expected: number) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        return store && Object.keys(store.getState().sceneGraph.nodes).length >= expected;
      },
      count,
      { timeout: 10_000 }
    );
  }

  /** Get the canvas element */
  get canvas() {
    return this.page.locator('canvas').first();
  }

  /** Spawn an entity via the sidebar add menu */
  async spawnEntity(type: string) {
    const spawnBtn = this.page.getByRole('button', { name: new RegExp(type, 'i') });
    if (await spawnBtn.isVisible()) {
      await spawnBtn.click();
    }
  }

  /** Select an entity by clicking its name in the hierarchy panel */
  async selectEntity(name: string) {
    await this.page.getByText(name, { exact: false }).first().click();
  }

  /** Check that a dockview panel is visible */
  async expectPanelVisible(panelTitle: string) {
    await expect(
      this.page.locator(`.dv-tab, [data-testid="panel-${panelTitle}"]`).filter({ hasText: new RegExp(panelTitle, 'i') }).first()
    ).toBeVisible({ timeout: 5000 });
  }

  /** Check that no visible text elements are invisible (zero opacity or transparent color) */
  async assertNoInvisibleElements() {
    const invisibleCount = await this.page.evaluate(() => {
      const elements = document.querySelectorAll('*');
      let count = 0;
      for (const el of elements) {
        const style = window.getComputedStyle(el);
        const hasText = el.textContent?.trim();
        if (hasText && style.color === 'rgba(0, 0, 0, 0)') count++;
        if (hasText && style.opacity === '0' && !el.closest('[aria-hidden]')) count++;
      }
      return count;
    });
    expect(invisibleCount).toBe(0);
  }

  /** Click a position in the 3D viewport */
  async clickViewport(x: number, y: number) {
    const box = await this.canvas.boundingBox();
    if (!box) throw new Error('Canvas not visible');
    await this.page.mouse.click(box.x + x, box.y + y);
  }

  /** Open settings modal */
  async openSettings() {
    await this.page.getByRole('button', { name: /settings/i }).click();
    await this.page.waitForTimeout(300);
  }

  /** Press keyboard shortcut */
  async pressShortcut(keys: string) {
    await this.page.keyboard.press(keys);
  }

  /** Get the editor store state */
  async getStoreState<T>(selector: string): Promise<T> {
    return this.page.evaluate((sel: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) throw new Error('Store not available');
      const state = store.getState();
      return sel.split('.').reduce((obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key], state) as T;
    }, selector);
  }
}

export const test = base.extend<{ editor: EditorPage }>({
  editor: async ({ page }, use) => {
    const editor = new EditorPage(page);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(editor);
  },
});

export { expect };
