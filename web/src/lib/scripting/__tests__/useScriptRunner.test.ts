// @vitest-environment jsdom
/**
 * Tests for useScriptRunner hook — worker lifecycle, command dispatch,
 * message handling, watchdog timeout, audio commands, and cleanup.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import type { MockInstance } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock Worker
// ---------------------------------------------------------------------------
let workerPostMessages: unknown[] = [];
let workerTerminated = false;

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;

  constructor() {
    workerPostMessages = [];
    workerTerminated = false;
  }

  postMessage(data: unknown) {
    workerPostMessages.push(data);
  }

  terminate() {
    workerTerminated = true;
  }

  // Simulate receiving a message from the worker
  simulateMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }
}

// Store references for test access
let latestWorker: MockWorker | null = null;

const TestWorker = class extends MockWorker {
  constructor(_url: URL, _opts?: WorkerOptions) {
    super();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    latestWorker = this;
  }
};
vi.stubGlobal('Worker', TestWorker);

// ---------------------------------------------------------------------------
// Mock stores & modules
// ---------------------------------------------------------------------------

let mockEngineMode = 'edit';
const mockAddScriptLog = vi.fn();
const mockSetHudElements = vi.fn();
const mockSetEngineMode = vi.fn();
const mockSetGameCamera = vi.fn();
const mockCameraShake = vi.fn();
const mockStartSceneTransition = vi.fn();
// Win/score state — `mockGameWon` drives the `!gameWon` loop-prevention guard.
let mockGameWon = false;
const mockSetGameWon = vi.fn();
const mockSetGameScore = vi.fn();
let mockPlayTickCallback: ((data: unknown) => void) | null = null;
// Spies for the record/replay fan-out bus the play-tick callback publishes into
// (#9902). Declared via `vi.hoisted` so they are initialized before the hoisted
// `vi.mock` factory that closes over them runs (a plain const sits in the TDZ at
// that point, since ESM imports execute first). Call history is wiped by
// `vi.clearAllMocks()` in `beforeEach`.
const { mockPublishPlayTick, mockResetPlayTickBus } = vi.hoisted(() => ({
  mockPublishPlayTick: vi.fn(),
  mockResetPlayTickBus: vi.fn(),
}));

// Dialogue trees the `dialogue_set_variable` branch looks up. Held in a `let` so a
// test can seed a tree without re-mocking the store.
let mockDialogueTrees: Record<string, unknown> = {};
const mockUpdateTree = vi.fn();

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => {
      const state: Record<string, unknown> = {
        engineMode: mockEngineMode,
        addScriptLog: mockAddScriptLog,
        primaryId: null,
        primaryScript: null,
        allScripts: {},
        sceneGraph: { nodes: {}, rootIds: [] },
        tilemaps: {},
        skeletons2d: {},
        scenes: [{ id: 'scene-1', name: 'Main' }],
        activeSceneId: 'scene-1',
        activeGameCameraId: null,
        allGameCameras: {},
      };
      return selector(state);
    },
    {
      getState: () => ({
        setHudElements: mockSetHudElements,
        setEngineMode: mockSetEngineMode,
        setGameCamera: mockSetGameCamera,
        cameraShake: mockCameraShake,
        startSceneTransition: mockStartSceneTransition,
        gameWon: mockGameWon,
        setGameWon: mockSetGameWon,
        setGameScore: mockSetGameScore,
        primaryId: null,
        primaryScript: null,
        allScripts: {},
        sceneGraph: { nodes: {}, rootIds: [] },
        tilemaps: {},
        skeletons2d: {},
        scenes: [{ id: 'scene-1', name: 'Main' }],
        activeSceneId: 'scene-1',
        activeGameCameraId: 'cam-1',
        allGameCameras: { 'cam-1': { mode: 'thirdPersonFollow', targetEntity: null } },
        locales: {
          ja: { locale: 'ja', translations: { 'ui.start': 'スタート' } },
        },
        sourceLocale: 'en',
        previewLocale: 'ja',
      }),
    },
  ),
  setPlayTickCallback: vi.fn((cb: ((data: unknown) => void) | null) => {
    mockPlayTickCallback = cb;
  }),
}));

// `getTree` is pulled through `importActual` rather than stubbed: it is the guard
// under test for the `dialogue_set_variable` branch below, and a hand-written stub
// is free to drift away from the real one. Its absence here was also latent — the
// module imports `getTree`, so vitest's proxy would have thrown "No getTree export
// is defined on the mock" the moment any test drove that branch.
vi.mock('@/stores/dialogueStore', async () => ({
  getTree: (await vi.importActual<typeof import('@/stores/dialogueStore')>(
    '@/stores/dialogueStore',
  )).getTree,
  useDialogueStore: {
    getState: () => ({
      startDialogue: vi.fn(),
      endDialogue: vi.fn(),
      advanceDialogue: vi.fn(),
      skipTypewriter: vi.fn(),
      dialogueTrees: mockDialogueTrees,
      updateTree: mockUpdateTree,
    }),
  },
}));

vi.mock('@/lib/audio/audioManager', () => ({
  audioManager: {
    getPlayingStates: vi.fn(() => ({})),
    getOccludableEntities: vi.fn(() => []),
    getListenerPosition: vi.fn(() => null),
    getSourcePosition: vi.fn(() => null),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    removeAllLayers: vi.fn(),
    crossfade: vi.fn(),
    playOneShot: vi.fn(),
    fadeIn: vi.fn(),
    fadeOut: vi.fn(),
  },
}));

// The play-tick fan-out bus is the record/replay observation seam (#9902). The
// hook is the ONLY production writer into it — `publishPlayTick` per tick,
// `resetPlayTickBus` on stop/unmount — so it is mocked here to assert the hook
// publishes the correct snapshot shape and clears the bus on teardown. Only the
// two symbols the hook imports are provided.
vi.mock('@/lib/playtest/playTickBus', () => ({
  publishPlayTick: mockPublishPlayTick,
  resetPlayTickBus: mockResetPlayTickBus,
}));

// A CALL-THROUGH wrapper, not a stub: every test runs the real
// `createSandboxedScriptHost` unless it swaps the implementation, which only
// the sandbox runtime-failure suite at the bottom does (and restores after).
vi.mock('../sandboxOrigin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sandboxOrigin')>();
  return { ...actual, createSandboxedScriptHost: vi.fn(actual.createSandboxedScriptHost) };
});

import {
  useScriptRunner,
  getScriptCollisionCallback,
  getScriptGameEventCallback,
  WATCHDOG_TIMEOUT_MS,
  SANDBOX_RUNTIME_ERROR_CONSOLE_LIMIT,
} from '../useScriptRunner';
import {
  createSandboxedScriptHost,
  SANDBOX_BOOT_TIMEOUT_MS,
  SCRIPT_SANDBOX_RUNTIME_FAILED_MESSAGE,
  SCRIPT_SANDBOX_START_FAILED_MESSAGE,
  type SandboxedScriptHost,
  type SandboxedScriptHostOptions,
} from '../sandboxOrigin';
import { AST_FALLBACK_NOTICE } from '../sandboxConfig';
import { audioManager } from '@/lib/audio/audioManager';
// Deliberately NOT mocked: the module singleton IS the thing under test here,
// and a stub would pin the test's own idea of the wire instead of the hook's.
import {
  setCharacterGrounded,
  getGroundedStates,
  clearGroundedStates,
} from '@/lib/scripting/groundedRegistry';

describe('useScriptRunner', () => {
  afterAll(() => vi.unstubAllGlobals());

  const mockWasmModule = {
    handle_command: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockEngineMode = 'edit';
    mockGameWon = false;
    latestWorker = null;
    workerPostMessages = [];
    workerTerminated = false;
    mockPlayTickCallback = null;
    mockDialogueTrees = {};
    // The grounded registry is a module singleton shared by every test in this
    // file; a leftover entry would make a later assertion pass for the wrong
    // reason. Cleared through the hook's own export, not a private reset.
    clearGroundedStates();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Worker lifecycle
  // ---------------------------------------------------------------------------
  it('does not create worker in edit mode', () => {
    mockEngineMode = 'edit';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));
    expect(latestWorker).toBeNull();
  });

  it('creates worker when entering play mode', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));
    expect(latestWorker).not.toBeNull();
  });

  it('sends init message to worker on creation', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const initMsg = workerPostMessages.find(
      (m) => (m as Record<string, unknown>).type === 'init',
    );
    expect(initMsg).toBeDefined();
    expect((initMsg as Record<string, unknown>).scripts).toBeDefined();
    expect((initMsg as Record<string, unknown>).entityInfos).toBeDefined();
  });

  it('includes localization bundles and locale in the init message', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const initMsg = workerPostMessages.find(
      (m) => (m as Record<string, unknown>).type === 'init',
    ) as Record<string, unknown>;
    expect(initMsg).toBeDefined();
    expect(initMsg.locales).toEqual({
      ja: { locale: 'ja', translations: { 'ui.start': 'スタート' } },
    });
    expect(initMsg.sourceLocale).toBe('en');
    expect(initMsg.previewLocale).toBe('ja');
  });

  it('registers the leaderboard channel and rejects without a published-game identity', async () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    // Worker asks to submit a score through the leaderboard channel.
    await act(async () => {
      latestWorker!.simulateMessage({
        type: 'async_request',
        requestId: 'req_1',
        channel: 'leaderboard',
        method: 'submit',
        args: { name: 'hs', playerName: 'Ada', score: 1 },
      });
      // Let the router's async handler settle so its response is queued.
      await Promise.resolve();
      await Promise.resolve();
    });

    // Drive a play tick, which flushes queued async responses to the worker.
    act(() => {
      mockPlayTickCallback!({
        entities: {},
        entityInfos: {},
        inputState: { pressed: {}, justPressed: {}, justReleased: {}, axes: {} },
      });
    });

    const tickMsg = workerPostMessages
      .filter(
        (m) =>
          (m as Record<string, unknown>).type === 'tick' &&
          Array.isArray((m as Record<string, unknown>).asyncResponses),
      )
      .pop() as Record<string, unknown> | undefined;
    expect(tickMsg).toBeDefined();
    const responses = tickMsg!.asyncResponses as Array<Record<string, unknown>>;
    const resp = responses.find((r) => r.requestId === 'req_1');
    expect(resp).toBeDefined();
    // A registered-but-unavailable channel yields the handler's own error, NOT
    // the router's "Unknown async channel" — that distinction proves it is wired.
    expect(resp!.status).toBe('error');
    expect(resp!.error).toContain('only available when playing a published game');
    expect(resp!.error).not.toContain('Unknown async channel');
  });

  it('sends scene_info message after init', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const sceneMsg = workerPostMessages.find(
      (m) => (m as Record<string, unknown>).type === 'scene_info',
    );
    expect(sceneMsg).toBeDefined();
    expect((sceneMsg as Record<string, unknown>).currentScene).toBe('Main');
  });

  it('terminates worker when switching to edit mode', () => {
    mockEngineMode = 'play';
    const { rerender } = renderHook(
      ({ mode }) => {
        mockEngineMode = mode;
        return useScriptRunner({ wasmModule: mockWasmModule });
      },
      { initialProps: { mode: 'play' as string } },
    );

    expect(latestWorker).not.toBeNull();

    rerender({ mode: 'edit' });

    expect(workerTerminated).toBe(true);
    expect(mockSetHudElements).toHaveBeenCalledWith([]);
  });

  it('terminates worker on unmount', () => {
    mockEngineMode = 'play';
    const { unmount } = renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    expect(latestWorker).not.toBeNull();
    unmount();
    expect(workerTerminated).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Command dispatch
  // ---------------------------------------------------------------------------
  it('dispatches allowed commands from worker to WASM', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const worker = latestWorker!;
    act(() => {
      worker.simulateMessage({
        type: 'commands',
        commands: [
          { cmd: 'update_transform', entityId: 'e1', position: [1, 2, 3] },
        ],
      });
    });

    expect(mockWasmModule.handle_command).toHaveBeenCalledWith(
      'update_transform',
      expect.objectContaining({ entityId: 'e1' }),
    );
  });

  it('blocks unauthorized commands', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const worker = latestWorker!;

    act(() => {
      worker.simulateMessage({
        type: 'commands',
        commands: [
          { cmd: 'malicious_delete_all', target: 'everything' },
        ],
      });
    });

    expect(mockWasmModule.handle_command).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Blocked unauthorized command'),
    );
    // AND IT REACHES THE SCRIPT CONSOLE, which is the half that matters to the
    // author. `'*'` is not decoration: `ScriptEditorPanel` renders only
    // `l.entityId === primaryId || l.entityId === '*'`, and the `commands`
    // message is a per-frame flush carrying no entityId — so any other value
    // here is a log nobody can see, which is the silence this exists to end.
    expect(mockAddScriptLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: '*',
        level: 'error',
        message: expect.stringContaining('malicious_delete_all'),
      }),
    );
    consoleSpy.mockRestore();
  });

  it('reports an engine command refusal to the script console', () => {
    mockEngineMode = 'play';
    // `handle_command` answering `{success: false}` is what the engine returns
    // for a command it refused — the envelope `json_compatible()` builds in
    // `engine/src/bridge/mod.rs`. It used to be discarded here.
    mockWasmModule.handle_command.mockReturnValue({
      success: false,
      error: 'Unknown command: set_velocity2d',
    });
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const worker = latestWorker!;

    act(() => {
      worker.simulateMessage({
        type: 'commands',
        commands: [{ cmd: 'apply_force2d', entityId: 'e1', forceX: 1, forceY: 0 }],
      });
    });

    expect(mockAddScriptLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: '*',
        level: 'error',
        message: expect.stringContaining('apply_force2d'),
      }),
    );
    consoleSpy.mockRestore();
  });

  it('reports each refused command once, not once per frame', () => {
    mockEngineMode = 'play';
    mockWasmModule.handle_command.mockReturnValue({ success: false, error: 'nope' });
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const worker = latestWorker!;

    // A script emitting a refused command in `onUpdate` emits it every frame;
    // logging each one would bury the console it is trying to reach.
    act(() => {
      for (let i = 0; i < 5; i++) {
        worker.simulateMessage({
          type: 'commands',
          commands: [{ cmd: 'apply_force2d', entityId: 'e1', forceX: 1, forceY: 0 }],
        });
      }
    });

    const refusals = mockAddScriptLog.mock.calls.filter(
      ([entry]) => typeof entry?.message === 'string' && entry.message.includes('apply_force2d'),
    );
    expect(refusals).toHaveLength(1);
    consoleSpy.mockRestore();
  });

  it('refuses a payload deep enough to trap the engine, without calling into WASM', () => {
    // A user script builds this structure and `structuredClone` posts it
    // verbatim. The Rust guard cannot help here: `serde_wasm_bindgen` walks the
    // value recursively to build what that guard checks, and on wasm32
    // overflowing that walk is an unrecoverable trap, not an error. So the
    // refusal has to happen on this side of the boundary — asserting that
    // `handle_command` is never reached is the whole point of the test.
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const worker = latestWorker!;

    // Built iteratively — a recursive helper would overflow building the input.
    let deep: unknown = 1;
    for (let i = 0; i < 10_000; i += 1) deep = { a: deep };

    act(() => {
      worker.simulateMessage({
        type: 'commands',
        commands: [{ cmd: 'update_transform', entityId: 'e1', position: deep }],
      });
    });

    expect(mockWasmModule.handle_command).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Refused command 'update_transform'"),
    );
    consoleSpy.mockRestore();
  });

  it('still dispatches an ordinary payload', () => {
    // Pins the guard from the accepting side: a refusal that also refused
    // normal traffic would leave the test above green while breaking scripting
    // outright.
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const worker = latestWorker!;
    act(() => {
      worker.simulateMessage({
        type: 'commands',
        commands: [{ cmd: 'update_transform', entityId: 'e1', position: [1, 2, 3] }],
      });
    });

    expect(mockWasmModule.handle_command).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Audio command routing
  // ---------------------------------------------------------------------------
  it('routes audio_add_layer to audioManager instead of WASM', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const worker = latestWorker!;
    act(() => {
      worker.simulateMessage({
        type: 'commands',
        commands: [{
          cmd: 'audio_add_layer',
          entityId: 'e1',
          slotName: 'bg',
          assetId: 'music.mp3',
          volume: 0.8,
        }],
      });
    });

    expect(audioManager.addLayer).toHaveBeenCalledWith(
      'e1', 'bg', 'music.mp3',
      expect.objectContaining({ volume: 0.8 }),
    );
    expect(mockWasmModule.handle_command).not.toHaveBeenCalled();
  });

  it('writes dialogue_set_variable through for a real tree', () => {
    mockEngineMode = 'play';
    // `startNodeId` is required by `DialogueTree` and `getTree` refuses a tree
    // missing it — a fixture without one is not a smaller tree, it is one the
    // guard correctly declines, which would make this assertion fail for a
    // reason that has nothing to do with the write it is pinning.
    mockDialogueTrees = {
      'tree-1': { id: 'tree-1', nodes: [], variables: { gold: 1 }, startNodeId: 'n1' },
    };
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({
        type: 'dialogue_set_variable', treeId: 'tree-1', key: 'gold', value: 2,
      });
    });

    expect(mockUpdateTree).toHaveBeenCalledWith('tree-1', { variables: { gold: 2 } });
  });

  it('ignores a dialogue_set_variable naming an inherited tree id', () => {
    // `treeId` comes out of a user script, so `dialogueTrees['__proto__']` is
    // reachable. It is truthy, so the `if (tree)` gate alone let it through and the
    // spread read `Object.prototype.variables` — undefined, so the write landed on
    // a tree that does not exist. `getTree` gates on `Object.hasOwn` instead.
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({
        type: 'dialogue_set_variable', treeId: '__proto__', key: 'gold', value: 2,
      });
    });

    expect(mockUpdateTree).not.toHaveBeenCalled();
  });

  it('routes audio_crossfade to audioManager', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({
        type: 'commands',
        commands: [{
          cmd: 'audio_crossfade',
          fromEntityId: 'e1',
          toEntityId: 'e2',
          durationMs: 1000,
        }],
      });
    });

    expect(audioManager.crossfade).toHaveBeenCalledWith('e1', 'e2', 1000);
  });

  it('routes audio_play_one_shot to audioManager', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({
        type: 'commands',
        commands: [{
          cmd: 'audio_play_one_shot',
          assetId: 'sfx.wav',
          volume: 0.5,
        }],
      });
    });

    expect(audioManager.playOneShot).toHaveBeenCalledWith('sfx.wav', expect.objectContaining({ volume: 0.5 }));
  });

  it('routes audio_fade_in to audioManager', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({
        type: 'commands',
        commands: [{ cmd: 'audio_fade_in', entityId: 'e1', durationMs: 500 }],
      });
    });

    expect(audioManager.fadeIn).toHaveBeenCalledWith('e1', 500);
  });

  it('routes audio_fade_out to audioManager', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({
        type: 'commands',
        commands: [{ cmd: 'audio_fade_out', entityId: 'e1', durationMs: 300 }],
      });
    });

    expect(audioManager.fadeOut).toHaveBeenCalledWith('e1', 300);
  });

  it('routes audio_remove_layer to audioManager', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({
        type: 'commands',
        commands: [{ cmd: 'audio_remove_layer', entityId: 'e1', slotName: 'bg' }],
      });
    });

    expect(audioManager.removeLayer).toHaveBeenCalledWith('e1', 'bg');
  });

  it('routes audio_remove_all_layers to audioManager', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({
        type: 'commands',
        commands: [{ cmd: 'audio_remove_all_layers', entityId: 'e1' }],
      });
    });

    expect(audioManager.removeAllLayers).toHaveBeenCalledWith('e1');
  });

  // ---------------------------------------------------------------------------
  // Log and error messages
  // ---------------------------------------------------------------------------
  it('forwards log messages to addScriptLog', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({
        type: 'log',
        entityId: 'e1',
        level: 'info',
        message: 'Hello from script',
      });
    });

    expect(mockAddScriptLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'e1',
        level: 'info',
        message: 'Hello from script',
      }),
    );
  });

  it('forwards error messages with line number', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({
        type: 'error',
        entityId: 'e2',
        line: 42,
        message: 'undefined is not a function',
      });
    });

    expect(mockAddScriptLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'e2',
        level: 'error',
        message: '[line 42] undefined is not a function',
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // UI messages
  // ---------------------------------------------------------------------------
  it('forwards ui messages to setHudElements', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const elements = [{ type: 'text', text: 'Score: 100' }];
    act(() => {
      latestWorker!.simulateMessage({ type: 'ui', elements });
    });

    expect(mockSetHudElements).toHaveBeenCalledWith(elements);
  });

  // ---------------------------------------------------------------------------
  // Camera messages
  // ---------------------------------------------------------------------------
  it('handles camera_set_mode message', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({ type: 'camera_set_mode', mode: 'firstPerson' });
    });

    expect(mockSetGameCamera).toHaveBeenCalledWith(
      'cam-1',
      expect.objectContaining({ mode: 'firstPerson' }),
    );
  });

  it('handles camera_set_target message', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({ type: 'camera_set_target', entityId: 'player-1' });
    });

    expect(mockSetGameCamera).toHaveBeenCalledWith(
      'cam-1',
      expect.objectContaining({ targetEntity: 'player-1' }),
    );
  });

  it('handles camera_shake message', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({ type: 'camera_shake', intensity: 0.5, duration: 200 });
    });

    expect(mockCameraShake).toHaveBeenCalledWith('cam-1', 0.5, 200);
  });

  it('handles camera_set_property message', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({ type: 'camera_set_property', property: 'fov', value: 90 });
    });

    expect(mockSetGameCamera).toHaveBeenCalledWith(
      'cam-1',
      expect.objectContaining({ fov: 90 }),
    );
  });

  // ---------------------------------------------------------------------------
  // Scene messages
  // ---------------------------------------------------------------------------
  it('handles scene_load message', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({
        type: 'scene_load',
        sceneName: 'Level2',
        transition: { type: 'fade', duration: 500 },
      });
    });

    expect(mockStartSceneTransition).toHaveBeenCalledWith(
      'Level2',
      { type: 'fade', duration: 500 },
    );
  });

  it('handles scene_restart message', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({ type: 'scene_restart' });
    });

    expect(mockStartSceneTransition).toHaveBeenCalledWith('Main', { type: 'instant' });
  });

  // ---------------------------------------------------------------------------
  // Collision callback
  // ---------------------------------------------------------------------------
  it('exports collision callback in play mode', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const cb = getScriptCollisionCallback();
    expect(cb).not.toBeNull();
  });

  it('clears collision callback in edit mode', () => {
    mockEngineMode = 'edit';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const cb = getScriptCollisionCallback();
    expect(cb).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Game win / score (forge.game.*)
  // ---------------------------------------------------------------------------
  function gameWinBroadcasts() {
    return workerPostMessages.filter(
      (m) =>
        (m as Record<string, unknown>).type === 'GAME_EVENT' &&
        (m as Record<string, unknown>).eventName === 'game_win',
    );
  }

  it('game_win sets win state once and re-broadcasts to the worker', () => {
    // forge.game.win() in a script → worker posts {type:'game_win'} → the hook
    // flips the store flag and re-broadcasts GAME_EVENT so EVERY script's onWin
    // fires. This is the script-initiated half of the win path.
    mockEngineMode = 'play';
    mockGameWon = false;
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({ type: 'game_win' });
    });

    expect(mockSetGameWon).toHaveBeenCalledWith(true);
    const broadcasts = gameWinBroadcasts();
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({
      type: 'GAME_EVENT',
      eventName: 'game_win',
      sourceEntityId: null,
      targetEntityId: null,
    });
  });

  it('game_win is a no-op when the game is already won (loop-prevention guard)', () => {
    // The re-broadcast makes the worker fire onWin handlers, which could call
    // forge.game.win() again → infinite loop. The `!gameWon` guard breaks it:
    // once won, a second game_win message must NOT re-flip or re-broadcast.
    mockEngineMode = 'play';
    mockGameWon = true;
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({ type: 'game_win' });
    });

    expect(mockSetGameWon).not.toHaveBeenCalled();
    expect(gameWinBroadcasts()).toHaveLength(0);
  });

  it('game_set_score forwards a numeric score to the store', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({ type: 'game_set_score', score: 7 });
    });

    expect(mockSetGameScore).toHaveBeenCalledWith(7);
  });

  it('game_set_score coerces a non-numeric score to 0', () => {
    // A malformed worker payload must not push a non-number into the store.
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({ type: 'game_set_score', score: 'oops' });
    });

    expect(mockSetGameScore).toHaveBeenCalledWith(0);
  });

  // ---------------------------------------------------------------------------
  // Game-event callback bridge (engine win/score → script worker)
  // ---------------------------------------------------------------------------
  it('exports game-event callback in play mode and forwards events to the worker', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const cb = getScriptGameEventCallback();
    expect(cb).not.toBeNull();

    act(() => {
      cb!({ eventName: 'game_win', sourceEntityId: 'goal-1', targetEntityId: 'player-1' });
    });

    const forwarded = workerPostMessages.find(
      (m) =>
        (m as Record<string, unknown>).type === 'GAME_EVENT' &&
        (m as Record<string, unknown>).sourceEntityId === 'goal-1',
    );
    expect(forwarded).toMatchObject({
      type: 'GAME_EVENT',
      eventName: 'game_win',
      sourceEntityId: 'goal-1',
      targetEntityId: 'player-1',
    });
  });

  it('clears game-event callback in edit mode', () => {
    mockEngineMode = 'edit';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const cb = getScriptGameEventCallback();
    expect(cb).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Watchdog
  // ---------------------------------------------------------------------------
  it('terminates worker after watchdog timeout (5s without response)', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    // Simulate a tick callback (which starts the watchdog)
    expect(mockPlayTickCallback).not.toBeNull();

    act(() => {
      mockPlayTickCallback!({
        entities: {},
        entityInfos: {},
        inputState: { pressed: {}, justPressed: {}, justReleased: {}, axes: {} },
      });
    });

    // Advance past watchdog timeout (5s)
    act(() => {
      vi.advanceTimersByTime(5001);
    });

    expect(mockAddScriptLog).toHaveBeenCalledWith(
      expect.objectContaining({
        // '*' for the same reason as the blocked-command log: this message
        // explains why Play just stopped, and it belongs to no single entity.
        entityId: '*',
        level: 'error',
        message: expect.stringContaining('timed out'),
      }),
    );
    expect(mockSetEngineMode).toHaveBeenCalledWith('edit');
  });

  it('clears watchdog when worker responds', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    // Start a tick (starts watchdog)
    act(() => {
      mockPlayTickCallback!({
        entities: {},
        entityInfos: {},
        inputState: { pressed: {}, justPressed: {}, justReleased: {}, axes: {} },
      });
    });

    // Worker responds before timeout
    act(() => {
      vi.advanceTimersByTime(1000);
      latestWorker!.simulateMessage({ type: 'commands', commands: [] });
    });

    // Advance past watchdog — should NOT trigger timeout
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // setEngineMode should NOT have been called to switch back to edit
    expect(mockSetEngineMode).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // dispatchCommand error handling
  // ---------------------------------------------------------------------------
  it('catches errors from wasmModule.handle_command', () => {
    mockEngineMode = 'play';
    mockWasmModule.handle_command.mockImplementation(() => {
      throw new Error('WASM crash');
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      latestWorker!.simulateMessage({
        type: 'commands',
        commands: [{ cmd: 'apply_force', entityId: 'e1', force: [0, 10, 0] }],
      });
    });

    // Should not throw, but log the error
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Command error'),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // No WASM module
  // ---------------------------------------------------------------------------
  it('does not create worker when wasmModule is null', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: null }));
    expect(latestWorker).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Kinematic ground contact -> script sandbox (PF-1214)
  //
  // The engine decides `grounded` inside Rapier's character sweep and emits
  // CHANGES only; the browser accumulates them in `groundedRegistry` and the
  // hook is the ONLY thing that carries them to the worker. Nothing else in
  // this file touched that path, so every line of it could be deleted with all
  // 171 tests in the five suites this PR touches still green while
  // `forge.physics.isGrounded()` returned false forever.
  //
  // Each assertion below is written so deleting the line it covers turns it
  // red — verified by mutation, not assumed.
  // ---------------------------------------------------------------------------
  const TICK = {
    entities: {},
    entityInfos: {},
    inputState: { pressed: {}, justPressed: {}, justReleased: {}, axes: {} },
  };

  const messagesOfType = (type: string) =>
    workerPostMessages.filter((m) => (m as Record<string, unknown>).type === type);

  it('carries accumulated ground contact to the worker on every tick', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    // The engine reported a landing between init and this tick.
    act(() => {
      setCharacterGrounded('player-1', true);
      mockPlayTickCallback!(TICK);
    });

    const tick = messagesOfType('tick')[0] as Record<string, unknown>;
    expect(tick).toBeDefined();
    // toEqual, not objectContaining: the worker answers isGrounded() straight
    // out of this object, so an extra or renamed entity id is a wrong answer,
    // not a harmless extra.
    expect(tick.groundedStates).toEqual({ 'player-1': true });
  });

  it('carries a later takeoff on the next tick, not a stale landing', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      setCharacterGrounded('player-1', true);
      mockPlayTickCallback!(TICK);
    });
    act(() => {
      // The engine emits changes only, so this is the single notification the
      // script will ever get about leaving the ground.
      setCharacterGrounded('player-1', false);
      mockPlayTickCallback!(TICK);
    });

    const ticks = messagesOfType('tick') as Record<string, unknown>[];
    expect(ticks).toHaveLength(2);
    expect(ticks[0].groundedStates).toEqual({ 'player-1': true });
    expect(ticks[1].groundedStates).toEqual({ 'player-1': false });
  });

  it('reports every character, not just the first', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      setCharacterGrounded('player-1', true);
      setCharacterGrounded('enemy-3', false);
      mockPlayTickCallback!(TICK);
    });

    const tick = messagesOfType('tick')[0] as Record<string, unknown>;
    expect(tick.groundedStates).toEqual({ 'player-1': true, 'enemy-3': false });
  });

  /**
   * The engine and this hook do not start on the same task. `play` enters the
   * engine on the rAF loop; the effect that spawns the worker is a React
   * effect. So the very first (id, true) for a character standing on the floor
   * at play start is routinely already in the registry by the time this effect
   * runs — and because the engine emits CHANGES only, discarding it means
   * `forge.physics.isGrounded()` answers false until the character next leaves
   * the ground and comes back (review finding #8).
   */
  it('carries ground contact that arrived before the worker started', () => {
    setCharacterGrounded('player-1', true);

    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const init = messagesOfType('init')[0] as Record<string, unknown>;
    expect(init).toBeDefined();
    // The key must be present (the worker seeds its own map from it) and must
    // carry the pre-init landing rather than an empty object.
    expect(init).toHaveProperty('groundedStates');
    expect(init.groundedStates).toEqual({ 'player-1': true });
  });

  /**
   * The stale-`true`-from-last-session hazard the removed init-time clear was
   * written for. It is really closed by the stop clear, so prove it across a
   * real play -> edit -> play cycle rather than by clearing at init and
   * throwing away the pre-init landing above along with it.
   */
  it('does not inherit the previous session ground contact across a restart', () => {
    const { rerender } = renderHook(
      ({ mode }) => {
        mockEngineMode = mode;
        return useScriptRunner({ wasmModule: mockWasmModule });
      },
      { initialProps: { mode: 'play' as string } },
    );

    act(() => {
      setCharacterGrounded('player-1', true);
    });

    rerender({ mode: 'edit' });
    rerender({ mode: 'play' });

    // MockWorker resets the captured message list in its constructor, so this
    // is the SECOND session's init, not the first one replayed.
    const inits = messagesOfType('init') as Record<string, unknown>[];
    expect(inits).toHaveLength(1);
    expect(inits[0].groundedStates).toEqual({});
    expect(getGroundedStates()).toEqual({});
  });

  it('clears ground contact when play stops', () => {
    const { rerender } = renderHook(
      ({ mode }) => {
        mockEngineMode = mode;
        return useScriptRunner({ wasmModule: mockWasmModule });
      },
      { initialProps: { mode: 'play' as string } },
    );

    act(() => {
      setCharacterGrounded('player-1', true);
    });
    expect(getGroundedStates()).toEqual({ 'player-1': true });

    rerender({ mode: 'edit' });

    expect(getGroundedStates()).toEqual({});
  });

  it('clears ground contact on unmount', () => {
    mockEngineMode = 'play';
    const { unmount } = renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      setCharacterGrounded('player-1', true);
    });
    expect(getGroundedStates()).toEqual({ 'player-1': true });

    unmount();

    expect(getGroundedStates()).toEqual({});
  });

  // ---------------------------------------------------------------------------
  // Record/replay play-tick fan-out (#9902)
  //
  // The per-tick callback is the ONLY production callsite that publishes the
  // engine snapshot onto the shared record/replay bus, and stop/unmount are the
  // only places that reset it. Every playtest-directory test stubs the bus
  // directly, so without these, a regression in this wiring — a dropped `*1000`
  // conversion, a renamed field, a missing default, a bus that is never reset —
  // would leave the entire downstream record/replay feature broken with a green
  // suite. `performance.now` is pinned so the elapsed math is exact and a
  // mutation to the conversion turns the assertion red rather than flaky.
  // ---------------------------------------------------------------------------
  it('publishes the engine snapshot onto the record/replay bus with elapsed in milliseconds', () => {
    mockEngineMode = 'play';
    // Play start reads `lastTickRef` at 1000ms; the tick below reads 1500ms, so
    // the accumulated dt is exactly 0.5s and the published `elapsedMs` must be
    // 500 — a dropped `* 1000` conversion would surface 0.5 here instead.
    let nowMs = 1000;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    nowMs = 1500;
    act(() => {
      mockPlayTickCallback!({
        entities: { 'player-1': { position: [1, 2, 3] } },
        entityInfos: {},
        inputState: { pressed: { move_right: true }, axes: { move_x: 1 } },
      });
    });

    expect(mockPublishPlayTick).toHaveBeenCalledTimes(1);
    // toHaveBeenCalledWith is a deep equal on the whole snapshot: a renamed or
    // extra field fails it, not just a wrong value.
    expect(mockPublishPlayTick).toHaveBeenCalledWith({
      entities: { 'player-1': { position: [1, 2, 3] } },
      inputState: { pressed: { move_right: true }, axes: { move_x: 1 } },
      elapsedMs: 500,
    });

    nowSpy.mockRestore();
  });

  it('defaults the published input state when the engine tick omits it', () => {
    mockEngineMode = 'play';
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => 0);
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    act(() => {
      mockPlayTickCallback!({
        entities: {},
        entityInfos: {},
        // inputState deliberately absent: the engine can emit a tick before its
        // first evaluated input frame, and the bus contract requires a concrete
        // { pressed, axes } shape rather than undefined.
      });
    });

    expect(mockPublishPlayTick).toHaveBeenCalledWith(
      expect.objectContaining({ inputState: { pressed: {}, axes: {} } }),
    );

    nowSpy.mockRestore();
  });

  it('resets the record/replay bus when play stops', () => {
    const { rerender } = renderHook(
      ({ mode }) => {
        mockEngineMode = mode;
        return useScriptRunner({ wasmModule: mockWasmModule });
      },
      { initialProps: { mode: 'play' as string } },
    );

    // Entering play must not reset the bus — only teardown does.
    expect(mockResetPlayTickBus).not.toHaveBeenCalled();

    rerender({ mode: 'edit' });

    expect(mockResetPlayTickBus).toHaveBeenCalledTimes(1);
  });

  it('resets the record/replay bus on unmount', () => {
    mockEngineMode = 'play';
    const { unmount } = renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    expect(mockResetPlayTickBus).not.toHaveBeenCalled();

    unmount();

    expect(mockResetPlayTickBus).toHaveBeenCalledTimes(1);
  });
});
// ---------------------------------------------------------------------------
// Script isolation transport (#8700). NOT mocked: the flag is read through the
// real sandboxConfig, and the sandboxed path runs the real sandboxOrigin module
// (through the call-through wrapper declared at the top of this file).
// Vitest does not run the build-time loader, so the bundled worker is the empty
// placeholder — which is itself the observable: the host must refuse it loudly
// rather than start a worker with no code.
// ---------------------------------------------------------------------------
describe('useScriptRunner — script isolation transport', () => {
  const mockWasmModule = { handle_command: vi.fn() };

  // The suite above unstubs every global in its afterAll.
  afterAll(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.stubGlobal('Worker', TestWorker);
    vi.clearAllMocks();
    mockEngineMode = 'play';
    latestWorker = null;
    workerPostMessages = [];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    document.body.innerHTML = '';
  });

  it('flag unset: the same-origin module Worker, exactly as before', () => {
    vi.stubEnv('NEXT_PUBLIC_SCRIPT_ISOLATION', undefined);
    const { unmount } = renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));
    expect(latestWorker).not.toBeNull();
    expect(workerPostMessages.some((m) => (m as { type?: string }).type === 'init')).toBe(true);
    unmount();
  });

  it("'sandboxed-origin': no same-origin Worker is constructed, and an unbundled worker is reported, not run", async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('NEXT_PUBLIC_SCRIPT_ISOLATION', 'sandboxed-origin');
    const { unmount } = renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));
    expect(latestWorker).toBeNull();
    // The creator sees plain words in the script console...
    await vi.waitFor(() =>
      expect(mockAddScriptLog).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: '*', level: 'error', message: SCRIPT_SANDBOX_START_FAILED_MESSAGE }),
      ),
    );
    // ...and the bundling hint goes to the devtools, never to the script console.
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/was not bundled/));
    const logged = mockAddScriptLog.mock.calls.map(([entry]) => (entry as { message: string }).message);
    expect(logged.some((m) => /bundled|next\.config|boot-error|worker-error/.test(m))).toBe(false);
    unmount();
    errorSpy.mockRestore();
  });

  it("'ast': tells the creator in plain words and runs the sandboxed transport — never the weaker one", () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('NEXT_PUBLIC_SCRIPT_ISOLATION', 'ast');
    const { unmount } = renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));
    expect(latestWorker).toBeNull();
    expect(mockAddScriptLog).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: '*', level: 'warn', message: AST_FALLBACK_NOTICE }),
    );
    // The mode and issue number are for developers, in the devtools.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/'ast' is not implemented yet \(#8700/));
    unmount();
    warnSpy.mockRestore();
  });

  it('the sandbox boot timeout is shorter than the watchdog, so a boot failure is reported before the watchdog can fire', () => {
    // By value, not by source text: both are the constants the code runs with.
    expect(SANDBOX_BOOT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(SANDBOX_BOOT_TIMEOUT_MS).toBeLessThan(WATCHDOG_TIMEOUT_MS);
  });

  it('a sandbox boot failure is logged to the creator once, stops Play, and is NOT followed by the infinite-loop message', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      vi.stubEnv('NEXT_PUBLIC_SCRIPT_ISOLATION', 'sandboxed-origin');
      const { unmount } = renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

      // A tick lands BEFORE the (asynchronous) boot failure, arming the
      // watchdog — the ordering in which the misleading message used to follow.
      expect(mockPlayTickCallback).not.toBeNull();
      act(() => {
        mockPlayTickCallback!({
          entities: {},
          entityInfos: {},
          inputState: { pressed: {}, justPressed: {}, justReleased: {}, axes: {} },
        });
      });
      expect(mockAddScriptLog).not.toHaveBeenCalled();

      await vi.waitFor(() =>
        expect(mockAddScriptLog).toHaveBeenCalledWith(
          expect.objectContaining({ entityId: '*', level: 'error', message: SCRIPT_SANDBOX_START_FAILED_MESSAGE }),
        ),
      );

      // Well past the watchdog AND the host's own boot timer.
      act(() => {
        vi.advanceTimersByTime(WATCHDOG_TIMEOUT_MS + SANDBOX_BOOT_TIMEOUT_MS + 1000);
      });

      const logged = mockAddScriptLog.mock.calls.map(([entry]) => (entry as { message: string }).message);
      expect(logged).toEqual([SCRIPT_SANDBOX_START_FAILED_MESSAGE]);
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringMatching(/timeout|infinite loop/i));
      // Play is stopped, and no further tick can re-arm the watchdog.
      expect(mockSetEngineMode).toHaveBeenCalledWith('edit');
      expect(mockPlayTickCallback).toBeNull();
      // Fail CLOSED: a sandbox that cannot start is never replaced by the
      // weaker same-origin transport. This is the path WebKit takes today
      // (CI run 35997735154), so "no Worker" is what keeps its scripts off
      // the network rather than merely off the sandbox.
      expect(latestWorker).toBeNull();
      expect(vi.mocked(createSandboxedScriptHost)).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Sandbox RUNTIME failures (#8700) — what the hook does with phase 'runtime'.
//
// The host is FAKED here, and only here: it captures the `onError` the hook
// hands it and lets the test call it. That the real host reports an uncaught
// error in an already-started worker as 'runtime' (and one before start as
// 'boot') is pinned in `sandboxOrigin.test.ts` ("an uncaught error in a worker
// that has STARTED is a runtime failure"); this suite pins the other half —
// the hook's handling of that report.
// ---------------------------------------------------------------------------
describe('useScriptRunner — sandbox runtime failures (fake sandboxed host)', () => {
  const mockWasmModule = { handle_command: vi.fn() };
  type OnError = SandboxedScriptHostOptions['onError'];
  let fakeHosts: { host: SandboxedScriptHost; onError: OnError }[] = [];
  let actualCreate: typeof createSandboxedScriptHost;
  let errorSpy: MockInstance<typeof console.error>;

  const tick = () =>
    act(() => {
      mockPlayTickCallback!({
        entities: {},
        entityInfos: {},
        inputState: { pressed: {}, justPressed: {}, justReleased: {}, axes: {} },
      });
    });

  /** The worker says something, so it has started (and the watchdog is cleared). */
  const workerSpeaks = (host: SandboxedScriptHost) =>
    act(() => {
      host.onmessage?.(new MessageEvent('message', { data: { type: 'log', entityId: 'e1', level: 'info', message: 'hi' } }));
    });

  const scriptLogMessages = () => mockAddScriptLog.mock.calls.map(([entry]) => (entry as { message: string }).message);
  const runtimeDetailLines = () =>
    errorSpy.mock.calls.filter(([line]) => typeof line === 'string' && line.includes('Script sandbox runtime failure'));
  const suppressedLines = () =>
    errorSpy.mock.calls.filter(([line]) => typeof line === 'string' && /suppressed/i.test(line));

  afterAll(() => vi.unstubAllGlobals());

  beforeEach(async () => {
    actualCreate = (await vi.importActual<typeof import('../sandboxOrigin')>('../sandboxOrigin')).createSandboxedScriptHost;
    vi.stubGlobal('Worker', TestWorker);
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SCRIPT_ISOLATION', 'sandboxed-origin');
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockEngineMode = 'play';
    mockPlayTickCallback = null;
    latestWorker = null;
    fakeHosts = [];
    vi.mocked(createSandboxedScriptHost).mockImplementation((options) => {
      const host: SandboxedScriptHost = { onmessage: null, frame: null, postMessage: vi.fn(), terminate: vi.fn() };
      fakeHosts.push({ host, onError: options.onError });
      return host;
    });
  });

  afterEach(() => {
    vi.mocked(createSandboxedScriptHost).mockImplementation(actualCreate);
    errorSpy.mockRestore();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('tells the creator in the RUNTIME words, and leaves Play, the tick callback and the watchdog alone', () => {
    const { unmount } = renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));
    // The sandboxed transport, not the same-origin Worker.
    expect(latestWorker).toBeNull();
    expect(fakeHosts).toHaveLength(1);
    const [{ host, onError }] = fakeHosts;
    expect(typeof onError).toBe('function');

    workerSpeaks(host);
    // A tick with no answer yet arms the watchdog.
    tick();
    mockAddScriptLog.mockClear();

    act(() => onError('Script sandbox worker-error: TypeError: late', 'runtime'));

    expect(scriptLogMessages()).toEqual([SCRIPT_SANDBOX_RUNTIME_FAILED_MESSAGE]);
    expect(scriptLogMessages()).not.toContain(SCRIPT_SANDBOX_START_FAILED_MESSAGE);
    expect(mockAddScriptLog).toHaveBeenCalledWith(expect.objectContaining({ entityId: '*', level: 'error' }));
    // The raw detail is for the devtools.
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('worker-error: TypeError: late'));
    // Play keeps running: no stop, no teardown of the tick callback.
    expect(mockSetEngineMode).not.toHaveBeenCalled();
    expect(mockPlayTickCallback).not.toBeNull();
    expect(host.terminate).not.toHaveBeenCalled();

    // The watchdog armed by the tick is still armed: it fires on schedule. Had
    // the runtime path cleared it (as the boot path does), nothing would.
    act(() => {
      vi.advanceTimersByTime(WATCHDOG_TIMEOUT_MS);
    });
    expect(scriptLogMessages()).toContain('Script execution timed out (possible infinite loop). Play mode stopped.');
    expect(mockSetEngineMode).toHaveBeenCalledWith('edit');
    unmount();
  });

  it('a script that throws forever: ONE script-console entry, and a bounded devtools console', () => {
    const { unmount } = renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));
    const [{ host, onError }] = fakeHosts;
    workerSpeaks(host);
    mockAddScriptLog.mockClear();
    errorSpy.mockClear();

    const failures = SANDBOX_RUNTIME_ERROR_CONSOLE_LIMIT * 20;
    act(() => {
      for (let i = 0; i < failures; i++) onError(`Script sandbox worker-error: Error: boom ${i}`, 'runtime');
    });

    expect(scriptLogMessages()).toEqual([SCRIPT_SANDBOX_RUNTIME_FAILED_MESSAGE]);
    // The first LIMIT details, in order, then one suppression line, then silence.
    expect(runtimeDetailLines()).toHaveLength(SANDBOX_RUNTIME_ERROR_CONSOLE_LIMIT);
    expect(runtimeDetailLines().map(([line]) => line)).toEqual(
      Array.from({ length: SANDBOX_RUNTIME_ERROR_CONSOLE_LIMIT }, (_, i) =>
        `[ScriptRunner] Script sandbox runtime failure: Script sandbox worker-error: Error: boom ${i}`,
      ),
    );
    expect(suppressedLines()).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledTimes(SANDBOX_RUNTIME_ERROR_CONSOLE_LIMIT + 1);
    // Guard the premise: the loop really did outrun the bound.
    expect(failures).toBeGreaterThan(SANDBOX_RUNTIME_ERROR_CONSOLE_LIMIT + 1);
    unmount();
  });

  it('a new Play session reports again', () => {
    const { rerender, unmount } = renderHook(
      ({ mode }) => {
        mockEngineMode = mode;
        return useScriptRunner({ wasmModule: mockWasmModule });
      },
      { initialProps: { mode: 'play' as string } },
    );
    const first = fakeHosts[0];
    workerSpeaks(first.host);
    act(() => {
      for (let i = 0; i < SANDBOX_RUNTIME_ERROR_CONSOLE_LIMIT + 3; i++) first.onError(`first ${i}`, 'runtime');
    });
    expect(scriptLogMessages().filter((m) => m === SCRIPT_SANDBOX_RUNTIME_FAILED_MESSAGE)).toHaveLength(1);

    rerender({ mode: 'edit' });
    expect(first.host.terminate).toHaveBeenCalled();
    rerender({ mode: 'play' });
    expect(fakeHosts).toHaveLength(2);
    const second = fakeHosts[1];
    workerSpeaks(second.host);
    mockAddScriptLog.mockClear();
    errorSpy.mockClear();

    act(() => second.onError('second 0', 'runtime'));

    expect(scriptLogMessages()).toEqual([SCRIPT_SANDBOX_RUNTIME_FAILED_MESSAGE]);
    expect(errorSpy).toHaveBeenCalledWith('[ScriptRunner] Script sandbox runtime failure: second 0');
    expect(suppressedLines()).toHaveLength(0);
    unmount();
  });
});
