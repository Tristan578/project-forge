/**
 * TypeScript declarations for SpawnForge window globals.
 *
 * The store-surface globals (`__EDITOR_STORE`, `__CHAT_STORE`, `__FORGE_DISPATCH`)
 * are injected by EditorLayout.tsx ONLY when E2E hooks are enabled (see
 * `e2eHooksEnabled` in `@/lib/e2e/testHooks`): always in dev/test, and in a
 * production build ONLY when `NEXT_PUBLIC_E2E_HOOKS=true` is set at build time
 * (the strict interactive-journey CI gate). A normal production deploy never sets
 * that flag, so those three are never attached to window in shipped builds.
 *
 * `__REACT_HYDRATED`, `__FORGE_ENGINE_READY`, and `__SKIP_ENGINE` are NOT gated by
 * `e2eHooksEnabled()` — they carry no sensitive surface and are set unconditionally
 * (see the per-field notes below).
 *
 * Security: A2 — explicit declare global prevents accidental usage in
 * production code paths; TypeScript strict mode will catch missing guards.
 */

declare global {
  interface Window {
    /**
     * Set to `true` by EditorLayout after React hydrates and all event
     * handlers are attached. Set UNCONDITIONALLY (not gated by
     * `e2eHooksEnabled()`) so `loadPage()` can detect interactivity in any
     * build. Used by E2E tests to know when the editor is interactive.
     */
    __REACT_HYDRATED?: boolean;

    /**
     * Set to `true` by useEngine when the WASM engine has fully initialized.
     * Available in all environments (used by the loading UI).
     */
    __FORGE_ENGINE_READY?: boolean;

    /**
     * Reference to the Zustand editor store. Available only when E2E hooks are
     * enabled (`e2eHooksEnabled()`). Used by E2E tests to read/manipulate state.
     */
    __EDITOR_STORE?: unknown;

    /**
     * Reference to the Zustand chat store. Available only when E2E hooks are
     * enabled (`e2eHooksEnabled()`). Used by the interactive-journey gate to
     * assert on chat-surfaced messages (e.g. the pre-play winnability loopback).
     */
    __CHAT_STORE?: unknown;

    /**
     * Command dispatcher for agent viewport integration. Available only when
     * E2E hooks are enabled (`e2eHooksEnabled()`). Wraps `getCommandDispatcher()`
     * for direct engine command dispatch from Playwright `page.evaluate()` calls.
     *
     * @param cmd - Command name (e.g. 'spawn_entity', 'set_engine_mode')
     * @param payload - Command payload object (camelCase keys)
     * @returns `true` if the dispatcher was available and the command was sent,
     *          `false` if the engine is not yet initialized.
     */
    __FORGE_DISPATCH?: (cmd: string, payload: Record<string, unknown>) => boolean;

    /**
     * When set to `true` before page load (via `addInitScript`), skips WASM
     * engine loading. Used by @ui E2E tests that don't need the engine.
     */
    __SKIP_ENGINE?: boolean;
  }
}

export {};
