/**
 * AgentViewport — high-level viewport interaction class for AI agents.
 *
 * Extends `EditorPage` with scene observation, command dispatch, play-mode
 * control, and entity verification methods. Designed to give AI agents a
 * rich, structured view of what they've built in the SpawnForge editor.
 *
 * Usage:
 * ```ts
 * const av = new AgentViewport(page);
 * await av.boot();
 * const obs = await av.observe('initial state');
 * console.log(formatObservation(obs));
 * ```
 */

import type { Page } from '@playwright/test';
import { EditorPage } from '../fixtures/editor.fixture';
import { captureCanvasFrame } from './canvasReadback';
import type {
  CaptureOptions,
  CommandResult,
  SceneNodeSummary,
  SceneSnapshot,
  VerificationResult,
  ViewportObservation,
} from './types';

/** Default timeout for waitForMode (ms). */
const MODE_TIMEOUT = 10_000;

/** Default timeout for waitForEntity (ms). */
const ENTITY_TIMEOUT = 10_000;

/**
 * AgentViewport extends EditorPage with structured observation, command
 * dispatch, and verification capabilities for AI agents.
 */
export class AgentViewport extends EditorPage {
  /** Console error messages collected since `boot()`. */
  private _consoleErrors: string[] = [];

  /** Whether the console listener has been registered. */
  private _consoleListenerRegistered = false;

  constructor(page: Page) {
    super(page);
  }

  /**
   * Boot the editor and start collecting console errors.
   *
   * Calls `EditorPage.load()` which waits for `__FORGE_ENGINE_READY` and
   * the dockview container to be visible. Registers a console listener for
   * error collection.
   */
  async boot(): Promise<void> {
    this._registerConsoleListener();
    await this.load();
  }

  /**
   * Boot the editor without waiting for the WASM engine (faster, for UI tests).
   * Registers the console listener for error collection.
   */
  async bootPage(): Promise<void> {
    this._registerConsoleListener();
    await this.loadPage();
  }

  /**
   * Register a page console listener to collect error messages.
   * Safe to call multiple times — listener is only registered once.
   */
  private _registerConsoleListener(): void {
    if (this._consoleListenerRegistered) return;
    this._consoleListenerRegistered = true;

    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this._consoleErrors.push(msg.text());
      }
    });
  }

  /**
   * Read the current scene graph state from the Zustand store.
   *
   * @returns SceneSnapshot or null if the store is not available.
   */
  async getSceneSnapshot(): Promise<SceneSnapshot | null> {
    try {
      const snapshot = await this.page.evaluate(() => {
        const win = window as Window & typeof globalThis;
        const store = win.__EDITOR_STORE;
        if (!store || typeof store !== 'object') return null;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const state = (store as any).getState?.();
        if (!state) return null;

        const rawNodes: Record<string, unknown> = state.sceneGraph?.nodes ?? {};
        const selectedIds: string[] = state.selectedIds ?? [];
        const engineMode: string = state.engineMode ?? 'edit';
        const sceneName: string = state.sceneName ?? 'Untitled';

        const nodes: Record<string, {
          id: string;
          name: string;
          type: string;
          visible: boolean;
          children: string[];
          parentId: string | null;
          transform?: {
            position: [number, number, number];
            rotation: [number, number, number, number];
            scale: [number, number, number];
          };
        }> = {};

        const rootIds: string[] = [];

        for (const [id, raw] of Object.entries(rawNodes)) {
          const node = raw as Record<string, unknown>;
          const parentId = (node.parentId as string | null | undefined) ?? null;

          nodes[id] = {
            id,
            name: (node.name as string) ?? id,
            type: (node.type as string) ?? 'unknown',
            visible: (node.visible as boolean) !== false,
            children: (node.children as string[]) ?? [],
            parentId,
          };

          // Read transform if available
          const transform = node.transform as Record<string, unknown> | undefined;
          if (transform) {
            nodes[id].transform = {
              position: (transform.position as [number, number, number]) ?? [0, 0, 0],
              rotation: (transform.rotation as [number, number, number, number]) ?? [0, 0, 0, 1],
              scale: (transform.scale as [number, number, number]) ?? [1, 1, 1],
            };
          }

          if (parentId === null || parentId === undefined) {
            rootIds.push(id);
          }
        }

        return {
          entityCount: Object.keys(nodes).length,
          rootIds,
          nodes,
          selectedIds,
          engineMode,
          sceneName,
        };
      });

      return snapshot;
    } catch {
      return null;
    }
  }

  /**
   * Capture the current canvas frame.
   *
   * @param options - Canvas capture options.
   * @returns ViewportCapture with pixel data, dimensions, and blank detection.
   */
  async captureViewport(options?: CaptureOptions) {
    return captureCanvasFrame(this.page, options);
  }

  /**
   * Observe the current state of the editor: scene graph + canvas frame.
   *
   * @param label - Optional descriptive label for this observation.
   * @param captureOptions - Options for canvas capture.
   * @returns ViewportObservation combining scene and viewport state.
   */
  async observe(
    label?: string,
    captureOptions?: CaptureOptions,
  ): Promise<ViewportObservation> {
    const [scene, viewport] = await Promise.all([
      this.getSceneSnapshot(),
      this.captureViewport(captureOptions),
    ]);

    const emptyScene: SceneSnapshot = {
      entityCount: 0,
      rootIds: [],
      nodes: {},
      selectedIds: [],
      engineMode: 'edit',
      sceneName: 'Untitled',
    };

    return {
      label,
      scene: scene ?? emptyScene,
      viewport,
      consoleErrors: [...this._consoleErrors],
      capturedAt: Date.now(),
    };
  }

  /**
   * Dispatch an engine command via `__FORGE_DISPATCH`.
   *
   * Only available in development/test builds. Returns a `CommandResult`
   * with success status and timing.
   *
   * @param cmd - Command name (camelCase engine command).
   * @param payload - Command payload (camelCase keys).
   * @returns CommandResult
   */
  async sendCommand(cmd: string, payload: Record<string, unknown> = {}): Promise<CommandResult> {
    const start = Date.now();

    try {
      const dispatched = await this.page.evaluate(
        ([command, args]: [string, Record<string, unknown>]) => {
          const win = window as Window & typeof globalThis;
          const dispatch = win.__FORGE_DISPATCH;
          if (!dispatch) return false;
          return dispatch(command, args);
        },
        [cmd, payload] as [string, Record<string, unknown>],
      );

      return {
        success: dispatched,
        error: dispatched ? undefined : '__FORGE_DISPATCH not available (engine not initialized or production build)',
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        error: String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Set the engine to play mode by dispatching `set_engine_mode`.
   */
  async enterPlayMode(): Promise<CommandResult> {
    return this.sendCommand('set_engine_mode', { mode: 'play' });
  }

  /**
   * Return the engine to edit mode by dispatching `set_engine_mode`.
   */
  async exitPlayMode(): Promise<CommandResult> {
    return this.sendCommand('set_engine_mode', { mode: 'edit' });
  }

  /**
   * Wait until the engine store reports the given mode.
   *
   * @param mode - Expected engine mode.
   * @param timeout - Maximum wait in ms.
   */
  async waitForMode(
    mode: 'edit' | 'play' | 'paused',
    timeout = MODE_TIMEOUT,
  ): Promise<void> {
    await this.page.waitForFunction(
      (expectedMode: string) => {
        const win = window as Window & typeof globalThis;
        const store = win.__EDITOR_STORE;
        if (!store || typeof store !== 'object') return false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (store as any).getState?.()?.engineMode === expectedMode;
      },
      mode,
      { timeout },
    );
  }

  /**
   * Verify that an entity with the given name exists in the scene graph.
   *
   * @param name - Entity name (case-insensitive partial match).
   * @returns VerificationResult
   */
  async verifyEntityExists(name: string): Promise<VerificationResult> {
    const scene = await this.getSceneSnapshot();

    if (!scene) {
      return {
        passed: false,
        reason: 'Store not available — could not read scene graph',
        evidence: {},
      };
    }

    const lower = name.toLowerCase();
    const found = Object.values(scene.nodes).some(
      (node: SceneNodeSummary) => node.name.toLowerCase().includes(lower),
    );

    return {
      passed: found,
      reason: found
        ? `Entity "${name}" found in scene graph`
        : `Entity "${name}" not found in scene graph (${scene.entityCount} total entities)`,
      evidence: { sceneSnapshot: scene },
    };
  }

  /**
   * Verify that the given entity is currently selected.
   *
   * @param entityId - Entity ID to check.
   * @returns VerificationResult
   */
  async verifyEntitySelected(entityId: string): Promise<VerificationResult> {
    const scene = await this.getSceneSnapshot();

    if (!scene) {
      return {
        passed: false,
        reason: 'Store not available — could not read selection state',
        evidence: {},
      };
    }

    const selected = scene.selectedIds.includes(entityId);

    return {
      passed: selected,
      reason: selected
        ? `Entity "${entityId}" is selected`
        : `Entity "${entityId}" is not selected (selected: [${scene.selectedIds.join(', ')}])`,
      evidence: { sceneSnapshot: scene },
    };
  }

  /**
   * Select an entity by dispatching `select_entity`.
   *
   * @param entityId - Entity ID to select.
   * @returns CommandResult
   */
  async selectEntity(entityId: string): Promise<CommandResult> {
    return this.sendCommand('select_entity', { entityId });
  }

  /**
   * Wait for an entity with the given name to appear in the scene graph.
   *
   * @param name - Entity name (case-insensitive partial match).
   * @param timeout - Maximum wait in ms.
   */
  async waitForEntity(name: string, timeout = ENTITY_TIMEOUT): Promise<void> {
    await this.page.waitForFunction(
      (entityName: string) => {
        const win = window as Window & typeof globalThis;
        const store = win.__EDITOR_STORE;
        if (!store || typeof store !== 'object') return false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const state = (store as any).getState?.();
        const nodes = state?.sceneGraph?.nodes;
        if (!nodes) return false;
        const lower = entityName.toLowerCase();
        return Object.values(nodes).some(
          (n: unknown) => ((n as Record<string, unknown>).name as string)?.toLowerCase().includes(lower),
        );
      },
      name,
      { timeout },
    );
  }

  /**
   * Get the properties of the currently selected entity from the store.
   *
   * @returns SceneNodeSummary or null if nothing is selected or store unavailable.
   */
  async getSelectedEntityProperties(): Promise<SceneNodeSummary | null> {
    const scene = await this.getSceneSnapshot();
    if (!scene || scene.selectedIds.length === 0) return null;

    const primaryId = scene.selectedIds[0];
    return scene.nodes[primaryId] ?? null;
  }

  /**
   * Collected console error messages since `boot()` was called.
   */
  get consoleErrors(): string[] {
    return [...this._consoleErrors];
  }

  /**
   * Clear the collected console errors (useful between test assertions).
   */
  clearConsoleErrors(): void {
    this._consoleErrors = [];
  }
}
