/**
 * Shared type definitions for the AgentViewport integration layer.
 *
 * These types describe what agents observe and verify when interacting
 * with the SpawnForge editor through Playwright.
 */

/** Result of a WebGL2 canvas frame readback. */
export interface ViewportCapture {
  /** Base-64 encoded PNG data URL of the captured frame. */
  dataUrl: string;
  /** Width of the captured canvas in pixels. */
  width: number;
  /** Height of the captured canvas in pixels. */
  height: number;
  /** Unix timestamp (ms) when the frame was captured. */
  timestamp: number;
  /** Rendering backend detected from the canvas context. */
  backend: 'webgl2' | 'webgpu' | 'unknown';
  /** True when all sampled pixels are zero/transparent — engine not yet rendering. */
  isBlank: boolean;
}

/** Summary of a single scene node as seen from the Zustand store. */
export interface SceneNodeSummary {
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
}

/** Snapshot of the scene graph state at the time of observation. */
export interface SceneSnapshot {
  /** Total number of entities in the scene (including camera). */
  entityCount: number;
  /** IDs of root-level entities (no parent). */
  rootIds: string[];
  /** Map of entity ID → node summary. */
  nodes: Record<string, SceneNodeSummary>;
  /** IDs of currently selected entities. */
  selectedIds: string[];
  /** Current engine mode. */
  engineMode: 'edit' | 'play' | 'paused';
  /** Name of the active scene. */
  sceneName: string;
}

/** Everything an agent observes about the editor at a given moment. */
export interface ViewportObservation {
  /** Optional label for this observation (e.g. "after spawning cube"). */
  label?: string;
  /** Scene graph state. */
  scene: SceneSnapshot;
  /** Canvas frame capture. */
  viewport: ViewportCapture;
  /** Console error messages collected since page load. */
  consoleErrors: string[];
  /** Unix timestamp (ms) when this observation was taken. */
  capturedAt: number;
}

/** Result of dispatching a command via `__FORGE_DISPATCH`. */
export interface CommandResult {
  /** Whether the command dispatched without error. */
  success: boolean;
  /** Error message if success is false. */
  error?: string;
  /** Entity ID returned by spawn commands. */
  entityId?: string;
  /** Wall-clock time in ms from dispatch to response. */
  durationMs: number;
}

/** Result of a programmatic verification check. */
export interface VerificationResult {
  /** Whether the verification passed. */
  passed: boolean;
  /** Human-readable reason for the result. */
  reason: string;
  /** Supporting evidence for the result. */
  evidence: {
    sceneSnapshot?: SceneSnapshot;
    viewport?: ViewportCapture;
  };
}

/** Options for canvas frame capture. */
export interface CaptureOptions {
  /** CSS selector for the canvas element. Defaults to `canvas` (first match). */
  canvasSelector?: string;
  /** Max retry attempts if the first frame is blank. Default: 3. */
  maxRetries?: number;
  /** Delay in ms between retries. Default: 500. */
  retryDelayMs?: number;
}
