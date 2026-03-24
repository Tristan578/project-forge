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
let mockPlayTickCallback: ((data: unknown) => void) | null = null;

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

vi.mock('@/stores/dialogueStore', () => ({
  useDialogueStore: {
    getState: () => ({
      startDialogue: vi.fn(),
      endDialogue: vi.fn(),
      advanceDialogue: vi.fn(),
      skipTypewriter: vi.fn(),
      dialogueTrees: {},
      updateTree: vi.fn(),
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

import { useScriptRunner, getScriptCollisionCallback } from '../useScriptRunner';
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
    latestWorker = null;
    workerPostMessages = [];
    workerTerminated = false;
    mockPlayTickCallback = null;
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
    expect(initMsg).not.toBeUndefined();
    expect((initMsg as Record<string, unknown>).scripts).not.toBeUndefined();
    expect((initMsg as Record<string, unknown>).entityInfos).not.toBeUndefined();
  });

  it('sends scene_info message after init', () => {
    mockEngineMode = 'play';
    renderHook(() => useScriptRunner({ wasmModule: mockWasmModule }));

    const sceneMsg = workerPostMessages.find(
      (m) => (m as Record<string, unknown>).type === 'scene_info',
    );
    expect(sceneMsg).not.toBeUndefined();
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