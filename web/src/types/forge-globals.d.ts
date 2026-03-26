/**
 * TypeScript declarations for SpawnForge window globals.
 *
 * These globals are injected by EditorLayout.tsx in development/test
 * environments only (NODE_ENV !== 'production'). They are never present
 * in production builds.
 *
 * Security: A2 — explicit declare global prevents accidental usage in
 * production code paths; TypeScript strict mode will catch missing guards.
 */

declare global {
  interface Window {
    /**
     * Set to `true` by EditorLayout after React hydrates and all event
     * handlers are attached. Used by E2E tests to know when the editor
     * is interactive.
     */
    __REACT_HYDRATED?: boolean;

    /**
     * Set to `true` by useEngine when the WASM engine has fully initialized.
     * Available in all environments (used by the loading UI).
     */
    __FORGE_ENGINE_READY?: boolean;

    /**
     * Reference to the Zustand editor store. Only available when
     * NODE_ENV !== 'production'. Used by E2E tests to read/manipulate state.
     */
    __EDITOR_STORE?: unknown;

    /**
     * Command dispatcher for agent viewport integration. Only available when
     * NODE_ENV !== 'production'. Wraps `getCommandDispatcher()` for direct
     * engine command dispatch from Playwright `page.evaluate()` calls.
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
