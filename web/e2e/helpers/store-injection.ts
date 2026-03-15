import type { Page } from '@playwright/test';

/**
 * Whether store injection failures should throw or skip gracefully.
 *
 * Only strict when explicitly opted in via E2E_STRICT_STORES=true.
 * CI E2E runs with __SKIP_ENGINE=true which means stores may not be
 * fully hydrated — strict mode would cause false failures.
 */
const STRICT_STORES = !!process.env.E2E_STRICT_STORES;

type StoreName = '__EDITOR_STORE' | '__CHAT_STORE';

/**
 * Inject a callback into the page's store. In strict mode (CI), throws
 * if the store is unavailable. In local mode, returns false so the caller
 * can skip assertions.
 *
 * @returns true if injection succeeded, false if skipped (local-only)
 */
export async function injectStore(
  page: Page,
  storeName: StoreName,
  callback: string,
): Promise<boolean> {
  const available = await page.evaluate(
    ([name]) => typeof (window as unknown as Record<string, unknown>)[name] !== 'undefined',
    [storeName],
  );

  if (!available) {
    if (STRICT_STORES) {
      throw new Error(
        `Store ${storeName} not found on window. ` +
        `E2E tests require the dev server to expose Zustand stores. ` +
        `Env: CI=${process.env.CI}, E2E_STRICT_STORES=${process.env.E2E_STRICT_STORES}`,
      );
    }
    return false;
  }

  await page.evaluate(callback);
  return true;
}

/**
 * Read a value from a store. In strict mode, throws if store is unavailable.
 * In local mode, returns null.
 */
export async function readStore<T>(
  page: Page,
  storeName: StoreName,
  selector: string,
): Promise<T | null> {
  const available = await page.evaluate(
    ([name]) => typeof (window as unknown as Record<string, unknown>)[name] !== 'undefined',
    [storeName],
  );

  if (!available) {
    if (STRICT_STORES) {
      throw new Error(
        `Store ${storeName} not found on window. ` +
        `E2E tests require the dev server to expose Zustand stores.`,
      );
    }
    return null;
  }

  return page.evaluate(selector) as Promise<T | null>;
}

/**
 * Whether we're in strict mode — tests should use this to decide
 * whether to assert on store-injected state.
 */
export const isStrictMode = STRICT_STORES;
