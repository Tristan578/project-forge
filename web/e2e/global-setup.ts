import { chromium, type FullConfig } from '@playwright/test';

/**
 * Global setup: warm up the Next.js dev server by loading /dev in a real browser.
 *
 * In dev mode, Next.js compiles client-side JS bundles on-demand when first requested.
 * Without this warmup, the first test to navigate to /dev triggers a slow compilation
 * (30-60s+ in CI), causing test timeouts. By loading the page here first, all bundles
 * are compiled and cached before any tests run.
 */
async function globalSetup(_config: FullConfig) {
  const browser = await chromium.launch({
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
  });
  const page = await browser.newPage();

  try {
    // Navigate and wait for the page to fully load (triggers bundle compilation)
    await page.goto('http://localhost:3000/dev', { timeout: 120_000 });
    await page.waitForLoadState('networkidle', { timeout: 120_000 });

    // Wait for React hydration — EditorLayout sets __REACT_HYDRATED after mounting
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__REACT_HYDRATED === true,
      { timeout: 120_000 }
    ).catch(() => {
      // Hydration may not complete (e.g., WASM fails) — that's OK for warmup.
      // The important part is that client bundles are compiled.
      console.log('Global setup: React hydration did not complete (WASM may be unavailable)');
    });
  } finally {
    await browser.close();
  }
}

export default globalSetup;
