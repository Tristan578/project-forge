// @vitest-environment jsdom
/**
 * #10227: a saved 2D scene reopens as 2D.
 *
 * `spriteSlice.projectType` used to have exactly one kind of writer — the AI
 * handlers calling `setProjectType` during a session — and nothing persisted
 * what they wrote. A 2D project reopened after a reload started in `'3d'`:
 * `TilemapToolbar` and the 2D inspector sections stayed hidden until an AI
 * turn happened to set the type again, and the engine, which also starts in
 * 3D, rendered the sprites through no camera at all.
 *
 * The scene file now carries `metadata.projectType`, the engine restores it
 * on `load_scene` and reports the result as `PROJECT_TYPE_CHANGED`, and the
 * sprite event handler mirrors that into the store. These run the REAL store,
 * the REAL dispatcher `useEngineEvents` registers and the REAL event handlers
 * over a stand-in WASM module, because the claim is about how those three
 * meet: the type has to arrive through the engine's report, not be written by
 * the page before the engine has applied the scene.
 *
 * The stand-in models what `engine/src/core/scene_file.rs` and
 * `engine/src/bridge/{scene_io,sprite}.rs` do — the Rust unit tests and
 * source pins in `scene_file.rs` are what hold THAT side to its word.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// SCENE_LOADED resets the Web Audio graph; the real one owns `AudioContext`
// nodes this suite has no use for.
vi.mock('@/lib/audio/entityAudioGraph', () => ({
  releaseEntityAudio: vi.fn(),
  resetEntityAudioGraphForScene: vi.fn(),
}));

// `gameEvents` forwards game events to the script worker through this module,
// which pulls in the audio manager. Only the one export it reads is needed.
vi.mock('@/lib/scripting/useScriptRunner', () => ({
  getScriptGameEventCallback: () => undefined,
}));

import { useEditorStore } from '@/stores/editorStore';
import { useEngineEvents } from '@/hooks/useEngineEvents';
import { cancelDeferredSceneLoad, hasDeferredSceneLoad, setSceneDispatcher } from '@/stores/slices/sceneSlice';
import { clearStagedSceneAudio } from '@/lib/audio/sceneAudioManifest';
import { sceneFixture } from '@/lib/scenes/__tests__/sceneFixture';
import { readProjectTypeFromSceneData } from '@/lib/scenes/sceneProjectType';

type ProjectType = '2d' | '3d';
type EngineEvent = { type: string; payload: Record<string, unknown> };

/**
 * A stand-in for the WASM module with ONE piece of state: the `ProjectType`
 * resource. Like the engine it answers a command when it QUEUES it and
 * applies it on its next frame (`tick`), where it also emits what the bridge
 * emits: `SCENE_LOADED` then `PROJECT_TYPE_CHANGED` for a load (the load
 * system queues the file's type into the same queue `set_project_type`
 * feeds), `PROJECT_TYPE_CHANGED` for every processed type request, and a
 * `SCENE_EXPORTED` whose file carries the live resource.
 */
function standInEngine(initial: ProjectType = '3d') {
  let projectType: ProjectType = initial;
  let emit: ((event: EngineEvent) => void) | null = null;
  const frame: Array<() => void> = [];
  const sent: string[] = [];

  const wasm = {
    set_event_callback: (callback: (event: unknown) => void) => {
      emit = callback as (event: EngineEvent) => void;
    },
    handle_command: vi.fn((command: string, payload: unknown): { success: boolean; error?: string } => {
      sent.push(command);
      const body = (payload ?? {}) as Record<string, unknown>;
      switch (command) {
        case 'set_project_type': {
          const requested = body.projectType;
          if (requested !== '2d' && requested !== '3d') {
            return { success: false, error: `projectType must be "2d" or "3d", got ${JSON.stringify(requested)}` };
          }
          frame.push(() => {
            projectType = requested;
            emit?.({ type: 'PROJECT_TYPE_CHANGED', payload: { projectType } });
          });
          return { success: true };
        }
        case 'load_scene': {
          const scene = JSON.parse(body.json as string) as { metadata: { name: string } };
          const saved = readProjectTypeFromSceneData(scene);
          frame.push(() => {
            emit?.({ type: 'SCENE_LOADED', payload: { name: scene.metadata.name } });
            projectType = saved;
            emit?.({ type: 'PROJECT_TYPE_CHANGED', payload: { projectType } });
          });
          return { success: true };
        }
        case 'export_scene': {
          const scene = sceneFixture('Saved');
          const json = JSON.stringify({ ...scene, metadata: { ...scene.metadata, projectType } });
          frame.push(() => {
            emit?.({ type: 'SCENE_EXPORTED', payload: { json, name: 'Saved', requestId: body.requestId ?? null } });
          });
          return { success: true };
        }
        default:
          return { success: true };
      }
    }),
  };

  /** Run one engine frame: apply everything queued, in order. */
  const tick = () => {
    const work = frame.splice(0);
    for (const step of work) step();
  };

  return { wasm, tick, sent, get projectType() { return projectType; } };
}

/** The scene file a 2D project saves — `metadata.projectType` as the engine writes it. */
function saved2dScene() {
  const scene = sceneFixture('Side Scroller');
  return JSON.stringify({ ...scene, metadata: { ...scene.metadata, projectType: '2d' } });
}

/** A fresh editor session: the store back at its default, no engine attached. */
function freshSession() {
  useEditorStore.setState({ projectType: '3d', camera2dData: null });
  setSceneDispatcher(null);
  cancelDeferredSceneLoad();
}

describe('project type across save and reopen (#10227)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    clearStagedSceneAudio();
    freshSession();
  });

  afterEach(() => {
    freshSession();
    clearStagedSceneAudio();
    vi.restoreAllMocks();
  });

  it('starts every session in 3d, the engine default', () => {
    expect(useEditorStore.getState().projectType).toBe('3d');
  });

  it('a saved 2D scene reopens as 2D through the engine report, with no AI turn', () => {
    const engine = standInEngine();
    renderHook(() => useEngineEvents({ wasmModule: engine.wasm }));

    expect(useEditorStore.getState().loadScene(saved2dScene())).toBe(true);
    // Accepted is not applied: the store still says 3d until the engine's frame.
    expect(useEditorStore.getState().projectType).toBe('3d');

    engine.tick();

    expect(engine.projectType).toBe('2d');
    expect(useEditorStore.getState().projectType).toBe('2d');
    // The type arrived through the engine's report, not through a store write
    // that would have echoed `set_project_type` back: the only command sent
    // was the load itself.
    expect(engine.sent).toEqual(['load_scene']);
  });

  it('a cold open: the load deferred until the engine attaches replays and lands as 2D', () => {
    // The editor page calls `loadScene(..., { deferUntilEngineAttaches: true })`
    // before `useEngineEvents` has mounted (#10192). The replay goes through
    // the same dispatcher, so the saved type comes back the same way.
    expect(useEditorStore.getState().loadScene(saved2dScene(), { deferUntilEngineAttaches: true })).toBe(false);
    expect(hasDeferredSceneLoad()).toBe(true);
    expect(useEditorStore.getState().projectType).toBe('3d');

    const engine = standInEngine();
    renderHook(() => useEngineEvents({ wasmModule: engine.wasm }));
    expect(hasDeferredSceneLoad()).toBe(false);
    expect(engine.sent).toContain('load_scene');

    engine.tick();

    expect(useEditorStore.getState().projectType).toBe('2d');
  });

  it('what a 2D session saves is what the next session reads back', () => {
    // Session one: the AI (or the user) switches to 2D and the engine applies it.
    const first = standInEngine();
    renderHook(() => useEngineEvents({ wasmModule: first.wasm }));
    useEditorStore.getState().setProjectType('2d');
    first.tick();
    expect(first.projectType).toBe('2d');

    // Save: the export carries the live resource.
    let savedJson: string | null = null;
    const exported = (event: unknown) => {
      const { type, payload } = event as EngineEvent;
      if (type === 'SCENE_EXPORTED') savedJson = payload.json as string;
    };
    first.wasm.set_event_callback(exported);
    first.wasm.handle_command('export_scene', { requestId: 'save-1' });
    first.tick();
    expect(savedJson).not.toBeNull();
    expect(readProjectTypeFromSceneData(JSON.parse(savedJson!))).toBe('2d');

    // Session two: a fresh store and a fresh engine, both at their 3D defaults.
    freshSession();
    const second = standInEngine();
    renderHook(() => useEngineEvents({ wasmModule: second.wasm }));
    expect(useEditorStore.getState().loadScene(savedJson!)).toBe(true);
    second.tick();

    expect(second.projectType).toBe('2d');
    expect(useEditorStore.getState().projectType).toBe('2d');
  });

  it('a scene saved before the field existed reopens as 3D, even in a session left in 2D', () => {
    // The legacy case: no `metadata.projectType` at all. And the store is
    // deliberately ahead of the engine here — a `setProjectType` that landed
    // while no dispatcher was attached — to show the engine's report wins.
    useEditorStore.getState().setProjectType('2d');
    expect(useEditorStore.getState().projectType).toBe('2d');

    const engine = standInEngine();
    renderHook(() => useEngineEvents({ wasmModule: engine.wasm }));
    expect(useEditorStore.getState().loadScene(JSON.stringify(sceneFixture('Legacy')))).toBe(true);
    engine.tick();

    expect(engine.projectType).toBe('3d');
    expect(useEditorStore.getState().projectType).toBe('3d');
  });
});
