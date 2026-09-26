/**
 * TypeScript declarations for SpawnForge window globals.
 *
 * Store, dispatch, replay and observation hooks are injected by EditorLayout.tsx
 * ONLY when E2E hooks are enabled (see
 * `e2eHooksEnabled` in `@/lib/e2e/testHooks`): always in dev/test, and in a
 * production build ONLY when `NEXT_PUBLIC_E2E_HOOKS=true` is set at build time
 * (the strict interactive-journey CI gate). A normal production deploy never sets
 * that flag, so these hooks are never attached to window in shipped builds.
 *
 * `__REACT_HYDRATED`, `__FORGE_ENGINE_READY`, and `__SKIP_ENGINE` are NOT gated by
 * `e2eHooksEnabled()` — they carry no sensitive surface and are set unconditionally
 * (see the per-field notes below).
 *
 * Optional declarations describe hook availability. Runtime installation and
 * access checks enforce the boundary; TypeScript declarations do not gate access.
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
     * Installs a caller-supplied command dispatcher via the production
     * `setCommandDispatcher`. Available only when E2E hooks are enabled
     * (`e2eHooksEnabled()`).
     *
     * Exists for the strict journey gate, which builds no WASM and runs Chromium
     * with `--disable-gpu` (which hangs `init_engine`). Without a dispatcher,
     * `runPipelineFromPlan` fails with `ENGINE_NOT_READY_MESSAGE` before any step runs,
     * so the generated-game pipeline could not be exercised there at all. The
     * supplied function goes through the same `tracked` wrapper as the real
     * engine dispatcher and is wired into every slice.
     *
     * @param dispatch - Stand-in dispatcher. Returning `{ success: false }`
     *                   reports an engine rejection exactly as the real one does.
     */
    __FORGE_SET_DISPATCH?: (
      dispatch: (cmd: string, payload: unknown) => { success: boolean; error?: string } | void,
    ) => void;

    /**
     * Replays a bounded input trace through the REAL runtime runner and returns
     * the observed-state outcome (#9902). Available only when E2E hooks are
     * enabled (`e2eHooksEnabled()`). Used by `e2e/engine/inputReplay.spec.ts` to
     * prove the record/replay path against the live WASM engine.
     */
    __FORGE_REPLAY?: (
      trace: unknown,
      config: { playerEntityId: string; collectibleEntityIds: string[] },
    ) => Promise<{
      command: string;
      verdict: 'passed' | 'failed';
      ticksReplayed: number;
      assertions: Array<{ operationId: string; description: string; passed: boolean }>;
      movedDistance: number | null;
      collectiblesCollected: number;
    }>;

    /**
     * When set to `true` before page load (via `addInitScript`), skips WASM
     * engine loading. Used by @ui E2E tests that don't need the engine.
     */
    __SKIP_ENGINE?: boolean;

    /**
     * Feeds a `get_entity_details` answer into the confirmed spawn/transform
     * observation cache (#9899, `lib/game-creation/engineObservation.ts`).
     * Available only when E2E hooks are enabled (`e2eHooksEnabled()`).
     *
     * Real engine builds populate that cache asynchronously, off the
     * `QUERY_ENTITY_DETAILS` event `useEngineEvents` receives from
     * `wasmModule.set_event_callback` — a callback the strict journey gate
     * never registers, since it builds no WASM and installs a recording
     * stand-in through `__FORGE_SET_DISPATCH` instead. Without this, every
     * `entity_setup` step's confirmed-observation poll (`observeEngineEffect`)
     * runs out its 5s deadline against an always-empty cache and the step
     * reports `EFFECT_TIMED_OUT` — a real gate failure caused by the stand-in
     * being unable to answer a query, not by the pipeline. This lets a
     * stand-in dispatcher answer `get_entity_details` the same way a real
     * engine's event eventually would.
     *
     * @param payload - Same shape as the engine's `QUERY_ENTITY_DETAILS`
     *                  payload: `{ entityId, position?, rotation?, scale? }`.
     */
    __FORGE_RECORD_ENTITY_OBSERVATION?: (payload: {
      entityId: string;
      position?: [number, number, number];
      rotation?: [number, number, number];
      scale?: [number, number, number];
    }) => void;

    /**
     * Reads the confirmed spawn/transform observation cache back (#9899,
     * `lib/game-creation/engineObservation.ts`) — the mirror of
     * `__FORGE_RECORD_ENTITY_OBSERVATION`. Available only when E2E hooks are
     * enabled (`e2eHooksEnabled()`).
     *
     * Returns the same typed `ObservedEntity` the orchestrator's `observeEntity`
     * reads, or `undefined` while no answer is cached for `entityId` (which
     * does not establish whether the entity exists). Lets an `@engine` spec assert on
     * the confirmation the slice actually adds — the cached observation fed by
     * the real `QUERY_ENTITY_DETAILS` event — rather than an adjacent store
     * field such as `primaryTransform`.
     *
     * @param entityId - The id to read the latest observation for.
     */
    __FORGE_READ_ENTITY_OBSERVATION?: (entityId: string) => {
      entityId: string;
      transform?: {
        position: [number, number, number];
        rotation: [number, number, number];
        scale: [number, number, number];
      };
    } | undefined;
  }
}

export {};
