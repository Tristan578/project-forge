import { test as base, expect, type Page } from '@playwright/test';
import { E2E_HYDRATION_TIMEOUT_MS } from '../../src/lib/config/timeouts';

/**
 * Page Object Model for the Project Forge editor.
 * Wraps common navigation, WASM wait, and interaction patterns.
 */
export class EditorPage {
  constructor(public page: Page) {}

  /** Navigate to /dev and wait for WASM engine to initialize */
  async load() {
    // Suppress onboarding overlays and init overlay so they don't block interactions.
    // The InitOverlay stays visible until the Rust renderer fully initializes, which
    // requires GPU — in headless Chrome with --disable-gpu it never completes.
    await this.page.addInitScript(() => {
      localStorage.setItem('forge-welcomed', '1');
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');

      // Inject CSS to hide blocking overlays
      const style = document.createElement('style');
      style.setAttribute('data-e2e', 'suppress-overlays');
      style.textContent = [
        // Hide InitOverlay (absolute full-screen z-50 with bg-zinc-950/95)
        '[class*="absolute"][class*="inset-0"][class*="z-50"][class*="bg-zinc-950"] { display: none !important; }',
        // Hide Next.js dev overlay which intercepts pointer events in CI
        'nextjs-portal { display: none !important; pointer-events: none !important; }',
      ].join('\n');
      if (document.head) {
        document.head.appendChild(style);
      } else {
        document.addEventListener('DOMContentLoaded', () =>
          document.head.appendChild(style)
        );
      }
    });
    await this.page.goto('/dev');
    // Wait for the WASM engine to report ready (longer timeout for CI runners)
    await this.page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__FORGE_ENGINE_READY === true,
      { timeout: E2E_HYDRATION_TIMEOUT_MS }
    );
    // Wait for the editor layout container to be visible (canonical way to know hydration + layout is stable)
    await this.page.locator('.dv-dockview').first().waitFor({ state: 'visible', timeout: 5000 });
  }

  /** Navigate to /dev without waiting for WASM (for @ui tests in CI) */
  async loadPage() {
    // Suppress onboarding overlays, PerformanceProfiler, and engine loading
    await this.page.addInitScript(() => {
      localStorage.setItem('forge-welcomed', '1');
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');

      // Skip WASM engine loading — prevents browser tab crash when
      // engine assets don't exist (CI) or GPU is unavailable
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = true;

      // Inject CSS to hide PerformanceProfiler overlay and InitOverlay
      const style = document.createElement('style');
      style.setAttribute('data-e2e', 'suppress-overlays');
      style.textContent = [
        // Hide PerformanceProfiler (fixed bottom-left z-50)
        '.fixed.bottom-4.left-4.z-50 { display: none !important; }',
        // Hide InitOverlay (absolute full-screen z-50 with bg-zinc-950/95)
        // Using attribute selector since Tailwind's / in class names needs escaping
        '[class*="absolute"][class*="inset-0"][class*="z-50"][class*="bg-zinc-950"] { display: none !important; }',
        // Hide Next.js dev overlay (<nextjs-portal>) which intercepts pointer events in CI
        'nextjs-portal { display: none !important; pointer-events: none !important; }',
      ].join('\n');
      if (document.head) {
        document.head.appendChild(style);
      } else {
        document.addEventListener('DOMContentLoaded', () =>
          document.head.appendChild(style)
        );
      }
    });

    // Use 'commit' to avoid navigation timeout under parallel test load.
    // The actual readiness gate is __REACT_HYDRATED below.
    await this.page.goto('/dev', { waitUntil: 'commit', timeout: 60_000 });
    await this.page.waitForLoadState('domcontentloaded');
    // Wait for React hydration — ensures all event handlers (keyboard shortcuts,
    // button clicks) are attached. This fires after EditorLayout mounts.
    // On cold dev-server starts (CI), the first page load triggers webpack chunk
    // compilation for the dynamically-imported EditorLayout bundle. GitHub-hosted
    // runners typically take 60-90s for this cold compile. We give it 90s on first
    // attempt; if that times out, reload once (chunks are now compiled) and wait
    // a further 40s.
    try {
      await this.page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 90_000 }
      );
    } catch {
      // Reload — chunks should be compiled by now
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 40_000 }
      );
    }
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
    await expect(this.page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]')).toBeVisible({ timeout: 5000 });
  }

  /** Press keyboard shortcut */
  async pressShortcut(keys: string) {
    await this.page.keyboard.press(keys);
  }

  /** Wait until __EDITOR_STORE is available (guards against hydration race). */
  async waitForEditorStore(timeout = 10_000) {
    await this.page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => !!(window as any).__EDITOR_STORE,
      { timeout }
    );
  }

  async getStoreState<T>(selector: string): Promise<T> {
    // Ensure store is available before reading — prevents race after loadPage()
    await this.waitForEditorStore();
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
