// @vitest-environment jsdom
/**
 * Tests for useScriptRunner hook — worker lifecycle, command dispatch,
 * message handling, watchdog timeout, audio commands, and cleanup.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
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

import { useScriptRunner, getScriptCollisionCallback, getScriptGameEventCallback } from '../useScriptRunner';
import { audioManager } from '@/lib/audio/audioManager';

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
});