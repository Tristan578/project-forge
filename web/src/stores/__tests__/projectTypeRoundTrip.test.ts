// @vitest-environment jsdom
/**
 * #10227: a saved 2D scene reopens as 2D, and a scene that states no type
 * inherits the session's.
 *
 * `spriteSlice.projectType` used to have exactly one kind of writer — the AI
 * handlers calling `setProjectType` during a session — and nothing persisted
 * what they wrote. A 2D project reopened after a reload started in `'3d'`:
 * `TilemapToolbar` and the 2D inspector sections stayed hidden until an AI
 * turn happened to set the type again, and the engine, which also starts in
 * 3D, rendered the sprites through no camera at all.
 *
 * The scene file now carries `metadata.projectType`, the engine applies it on
 * `load_scene` when present and reports the type in force as
 * `PROJECT_TYPE_CHANGED`, and the sprite event handler mirrors that into the
 * store. The field is ABSENT-AWARE (review board round 1 on #10358): a file
 * with no key leaves the engine's current type alone, so a second scene
 * created by an older editor, a pre-#10227 save, a legacy import or an
 * auto-save recovery switched to inside a 2D project keeps the project 2D;
 * only a fresh engine, which starts at 3D, opens such a file as 3D.
 *
 * These run the REAL store, the REAL dispatcher `useEngineEvents` registers,
 * the REAL event handlers and the REAL scene producers (`sceneManager`) over
 * a stand-in WASM module, because the claim is about how they meet: the type
 * has to arrive through the engine's report, not be written by the page before
 * the engine has applied the scene.
 *
 * The stand-in models what `engine/src/core/scene_file.rs`
 * (`SceneMetadata.project_type: Option<ProjectType>`),
 * `engine/src/core/project_type.rs` (`ProjectType::apply_request`) and
 * `engine/src/bridge/{scene_io,sprite}.rs` do. It PROVES THE WEB HALF ONLY.
 * The engine half is held to the same rule by the native Rust unit tests in
 * `project_type.rs` and `scene_file.rs` and by the textual pins in
 * `scene_file.rs`, which CI executes; nothing here exercises Rust.
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
import { createInitialProject, createScene, switchScene } from '@/lib/scenes/sceneManager';
import { readProjectTypeFromSceneData } from '@/lib/scenes/sceneProjectType';

type ProjectType = '2d' | '3d';
type EngineEvent = { type: string; payload: Record<string, unknown> };

/**
 * A stand-in for the WASM module with ONE piece of state: the `ProjectType`
 * resource. Like the engine it answers a command when it QUEUES it and
 * applies it on its next frame (`tick`), where it also emits what the bridge
 * emits: `SCENE_LOADED` then `PROJECT_TYPE_CHANGED` for a load (the load
 * system hands the file's `Option<ProjectType>` to the same queue
 * `set_project_type` feeds; the drain applies `Some` and leaves the resource
 * alone for `None`, and reports the RESOURCE either way — `apply_request`),
 * `PROJECT_TYPE_CHANGED` for every processed type request, and a
 * `SCENE_EXPORTED` whose file carries the live resource as `Some`.
 */
function standInEngine(initial: ProjectType = '3d') {
  let projectType: ProjectType = initial;
  let emit: ((event: EngineEvent) => void) | null = null;
  const frame: Array<() => void> = [];
  const sent: string[] = [];
  const reported: ProjectType[] = [];

  const report = () => {
    reported.push(projectType);
    emit?.({ type: 'PROJECT_TYPE_CHANGED', payload: { projectType } });
  };

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
            report();
          });
          return { success: true };
        }
        case 'load_scene': {
          const scene = JSON.parse(body.json as string) as { metadata: { name: string } };
          // `Option<ProjectType>`: `null` is a file that states no type.
          const saved = readProjectTypeFromSceneData(scene);
          frame.push(() => {
            emit?.({ type: 'SCENE_LOADED', payload: { name: scene.metadata.name } });
            // `ProjectType::apply_request`: `Some` applies, `None` leaves the
            // resource alone; the report carries the resource either way.
            if (saved !== null) projectType = saved;
            report();
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

  return { wasm, tick, sent, reported, get projectType() { return projectType; } };
}

/** The scene file a project saves — `metadata.projectType` as the engine writes it. */
function savedScene(name: string, projectType: ProjectType) {
  const scene = sceneFixture(name);
  return JSON.stringify({ ...scene, metadata: { ...scene.metadata, projectType } });
}

/** A scene file that states no type: saved before the field existed. */
function keyLessScene(name: string) {
  const scene = sceneFixture(name);
  expect(Object.keys(scene.metadata ?? {})).not.toContain('projectType');
  return JSON.stringify(scene);
}

/** A fresh editor session: the store back at its default, no engine attached. */
function freshSession() {
  useEditorStore.setState({ projectType: '3d', camera2dData: null });
  setSceneDispatcher(null);
  cancelDeferredSceneLoad();
}

/** An engine already in 2D with the store following it: a 2D project mid-session. */
function twoDSession() {
  const engine = standInEngine('2d');
  renderHook(() => useEngineEvents({ wasmModule: engine.wasm }));
  useEditorStore.setState({ projectType: '2d' });
  return engine;
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

    expect(useEditorStore.getState().loadScene(savedScene('Side Scroller', '2d'))).toBe(true);
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
    expect(useEditorStore.getState().loadScene(savedScene('Side Scroller', '2d'), { deferUntilEngineAttaches: true })).toBe(false);
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

    // Save: the export carries the live resource, always as a stated type.
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

  it('an explicit key applies: 3d in a 2D session switches to 3D, 2d in a 3D session to 2D', () => {
    const engine = twoDSession();
    expect(useEditorStore.getState().loadScene(savedScene('Lobby', '3d'))).toBe(true);
    engine.tick();
    expect(engine.projectType).toBe('3d');
    expect(useEditorStore.getState().projectType).toBe('3d');

    expect(useEditorStore.getState().loadScene(savedScene('Side Scroller', '2d'))).toBe(true);
    engine.tick();
    expect(engine.projectType).toBe('2d');
    expect(useEditorStore.getState().projectType).toBe('2d');
    expect(engine.reported).toEqual(['3d', '2d']);
  });

  describe('a scene that states no type (saved before the field existed)', () => {
    it('loaded into a 2D session keeps 2D — the engine leaves its type alone and reports it', () => {
      // The review board's major on #10358: reading absence as 3D flipped a
      // 2D project to 3D the moment any key-less scene was loaded — the
      // engine despawned the 2D camera, the store followed, sprites vanished.
      const engine = twoDSession();

      expect(useEditorStore.getState().loadScene(keyLessScene('Legacy'))).toBe(true);
      engine.tick();

      expect(engine.projectType).toBe('2d');
      expect(useEditorStore.getState().projectType).toBe('2d');
      // Still reported — once, for this one request — so a drifted store
      // would have converged; here it simply confirms the type in force.
      expect(engine.reported).toEqual(['2d']);
      expect(engine.sent).toEqual(['load_scene']);
    });

    it('still makes a store that drifted converge on the engine', () => {
      // The store at its 3D default while the engine is already 2D (a
      // `PROJECT_TYPE_CHANGED` missed before the handler mounted, say). The
      // key-less load changes nothing in the engine and its report corrects
      // the store.
      const engine = standInEngine('2d');
      renderHook(() => useEngineEvents({ wasmModule: engine.wasm }));
      expect(useEditorStore.getState().projectType).toBe('3d');

      expect(useEditorStore.getState().loadScene(keyLessScene('Legacy'))).toBe(true);
      engine.tick();

      expect(engine.projectType).toBe('2d');
      expect(useEditorStore.getState().projectType).toBe('2d');
    });

    it('opened in a fresh engine is 3D, because the engine starts there — even with the store left in 2D', () => {
      // The migration rule for a cold open holds through the engine's default,
      // not through the loader. The store is deliberately ahead of the engine
      // here — a `setProjectType` that landed while no dispatcher was attached
      // — to show the engine's report wins.
      useEditorStore.getState().setProjectType('2d');
      expect(useEditorStore.getState().projectType).toBe('2d');

      const engine = standInEngine();
      renderHook(() => useEngineEvents({ wasmModule: engine.wasm }));
      expect(useEditorStore.getState().loadScene(keyLessScene('Legacy'))).toBe(true);
      engine.tick();

      expect(engine.projectType).toBe('3d');
      expect(useEditorStore.getState().projectType).toBe('3d');
      expect(engine.reported).toEqual(['3d']);
    });
  });

  describe('creating a second scene in a 2D project', () => {
    it('createScene states the live type, so switchScene keeps 2D and the scene is self-describing', () => {
      // `sceneSlice.createNewScene` (and the AI's `create_scene`, and the
      // generated game's first scene) pass the store's type into
      // `createScene`; this runs the same producers against the stand-in.
      const engine = twoDSession();
      const { project: withTwo, sceneId } = createScene(createInitialProject(), 'Level 2', useEditorStore.getState().projectType);
      const result = switchScene(withTwo, sceneId);
      if ('error' in result) throw new Error(result.error);
      expect(result.sceneToLoad?.metadata?.projectType).toBe('2d');

      expect(useEditorStore.getState().loadScene(JSON.stringify(result.sceneToLoad))).toBe(true);
      engine.tick();

      expect(engine.projectType).toBe('2d');
      expect(useEditorStore.getState().projectType).toBe('2d');
      expect(engine.reported).toEqual(['2d']);
    });

    it('a scene created WITHOUT a type (an older editor, a caller that omitted it) still keeps 2D on switch', () => {
      // The key is absent, not '3d': the engine leaves its type alone, so the
      // project does not flip. Only the cold-open self-description is lost.
      const engine = twoDSession();
      const { project: withTwo, sceneId } = createScene(createInitialProject(), 'Level 2');
      const result = switchScene(withTwo, sceneId);
      if ('error' in result) throw new Error(result.error);
      expect(Object.keys(result.sceneToLoad?.metadata ?? {})).not.toContain('projectType');

      expect(useEditorStore.getState().loadScene(JSON.stringify(result.sceneToLoad))).toBe(true);
      engine.tick();

      expect(engine.projectType).toBe('2d');
      expect(useEditorStore.getState().projectType).toBe('2d');
    });
  });
});
