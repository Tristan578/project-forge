// @vitest-environment jsdom
/**
 * #10202: a THROWN scene load must lock saving in the editor.
 *
 * #10079 made a thrown scene dispatch set `sceneLoadError(ENGINE_LOAD_THREW)`
 * and lock every save path, even for a caller that passes
 * `rejectionStrandsEditor: false`. Its tests installed a dispatcher double that
 * RETHROWS. No production dispatcher does: the one the editor registers,
 * `useEngineEvents.dispatchCommand`, catches the throw from
 * `wasmModule.handle_command` and answers `{ success: false, error, threw: true }`.
 * `dispatchSceneLoad` read that as a clean rejection, so with
 * `rejectionStrandsEditor: false` nothing locked, the `switch_scene` tool
 * claimed the scene was unchanged, and the next autosave could write a
 * half-applied viewport over the stored scene.
 *
 * So these run the REAL store, the REAL tracked dispatcher and the REAL
 * `useEngineEvents` over a stand-in WASM module whose `handle_command` throws
 * — not a dispatcher double that rethrows. The throw is where `handle_command`
 * (engine/src/bridge/mod.rs) can produce one: it runs `dispatch` (which queues
 * the `load_scene`) and only then serializes its answer, so the throw can
 * arrive after the engine has acted.
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

// `switchScene` reports through `showError`; the tracked dispatcher toasts a
// first rejection too. Mocked so the wording can be asserted without sonner.
vi.mock('@/lib/toast', () => ({
  showError: vi.fn(),
  showPersistentError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
}));

import { useEditorStore, setCommandBatchDispatcher, getCommandDispatcher } from '@/stores/editorStore';
import { setSceneDispatcher } from '@/stores/slices/sceneSlice';
import { useEngineEvents } from '@/hooks/useEngineEvents';
import { sceneManagementHandlers } from '@/lib/chat/handlers/sceneManagementHandlers';
import { loadProjectScenes, saveProjectScenes } from '@/lib/scenes/sceneManager';
import { SCENE_EXPORTED_EVENT } from '@/lib/scenes/captureScene';
import { clearStagedSceneAudio } from '@/lib/audio/sceneAudioManifest';
import { sceneFixture } from '@/lib/scenes/__tests__/sceneFixture';
import { EngineDispatchThrewError, ENGINE_THREW_RELOAD_GUIDANCE } from '@/lib/scenes/engineDispatchThrew';
import * as toastModule from '@/lib/toast';

/** What `handle_command` throws when serializing its answer fails. */
const ENGINE_FAILURE = 'JsValue("serialize failed")';
/** The head of the `ENGINE_LOAD_THREW` reason, as the lockout notice shows it. */
const THREW_SENTENCE = 'the engine failed while loading it';
/** The head of the `ENGINE_LOAD_REJECTION` reason, for the control cases. */
const REJECTION_SENTENCE = 'the engine refused to load it';

type StandInEngine = {
  handle_command: ReturnType<typeof vi.fn<(command: string, payload: unknown) => unknown>>;
};

/**
 * A stand-in WASM module. It accepts every command, answers `export_scene` the
 * way the bridge's SCENE_EXPORTED round trip does (the window event the capture
 * helpers await), and for the listed commands either THROWS — the shape
 * `useEngineEvents` catches — or REFUSES with a clean `{ success: false }`.
 */
function standInEngine(opts: { throws?: readonly string[]; refuses?: readonly string[] } = {}): StandInEngine {
  const throws = opts.throws ?? [];
  const refuses = opts.refuses ?? [];
  return {
    handle_command: vi.fn((command: string, payload: unknown) => {
      if (throws.includes(command)) throw new Error(ENGINE_FAILURE);
      if (refuses.includes(command)) return { success: false, error: `Refused ${command}` };
      if (command === 'export_scene') {
        const requestId = (payload as { requestId?: string } | undefined)?.requestId;
        window.dispatchEvent(new CustomEvent(SCENE_EXPORTED_EVENT, {
          detail: { json: JSON.stringify(sceneFixture('Live')), requestId },
        }));
      }
      return { success: true };
    }),
  };
}

/** Install the production dispatchers over `engine`, as `EditorLayout` does. */
function attach(engine: StandInEngine): void {
  renderHook(() => useEngineEvents({ wasmModule: engine }));
}

function exportsRequested(engine: StandInEngine): number {
  return engine.handle_command.mock.calls.filter(([command]) => command === 'export_scene').length;
}

/**
 * Every save path refuses to ask the engine for the scene: the manual save,
 * the cloud save, and the chat `export_scene` tool. Asserted against the
 * engine's own call log, so a lockout that only changed a flag would fail.
 */
async function expectSavingLocked(engine: StandInEngine): Promise<void> {
  const before = exportsRequested(engine);
  useEditorStore.getState().saveScene();
  useEditorStore.getState().saveToCloud();
  const exported = await sceneManagementHandlers.export_scene({}, chatContext());
  expect(exported.success).toBe(false);
  expect(exported.error).toContain('Nothing was exported.');
  expect(exportsRequested(engine)).toBe(before);
}

/** The inverse: a save reaches the engine. Makes the lockout assertions non-vacuous. */
function expectSavingReachesEngine(engine: StandInEngine): void {
  const before = exportsRequested(engine);
  useEditorStore.getState().saveScene();
  expect(exportsRequested(engine)).toBe(before + 1);
}

function expectThrewLockout(): void {
  const error = useEditorStore.getState().sceneLoadError;
  expect(error).toEqual({ reason: expect.stringContaining(THREW_SENTENCE), at: expect.any(Number) });
  // The cause is not swallowed: the engine's own message rides along.
  expect(error?.reason).toContain(ENGINE_FAILURE);
  expect(error?.reason).not.toContain(REJECTION_SENTENCE);
}

/** The context `executor.ts` hands a chat tool: the live store and the tracked dispatcher. */
function chatContext() {
  return { store: useEditorStore.getState(), dispatchCommand: getCommandDispatcher()! };
}

/** Run `fn` and return what it threw, so the SAME throw can be inspected for class, fields and message. */
function catchThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

/**
 * Add a second scene to the (null-id) project and return its id. `withData`
 * stores a scene file on it so a switch takes the `loadScene` branch; with
 * `data: null` (which `createNewScene` does not produce on its own)
 * `switchSceneIn` yields `sceneToLoad: null` and the switch falls back to
 * `newScene()`.
 */
function addTargetScene(withData: boolean): string {
  useEditorStore.getState().createNewScene('Second');
  const target = useEditorStore.getState().scenes.find((s) => s.name === 'Second');
  if (!target) throw new Error('createNewScene did not record the scene');
  const project = loadProjectScenes(null);
  saveProjectScenes(
    {
      ...project,
      scenes: project.scenes.map((s) => (s.id === target.id ? { ...s, data: withData ? sceneFixture('Second') : null } : s)),
    },
    null,
  );
  return target.id;
}

describe('a thrown scene load through the dispatcher useEngineEvents registers (#10202)', () => {
  beforeEach(() => {
    // `useEngineEvents` logs the throw and the tracked wrapper logs the
    // rejection it reads from the answer; neither is the subject here.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.clear();
    clearStagedSceneAudio();
    useEditorStore.setState({
      sceneLoadError: null,
      scenes: [],
      activeSceneId: null,
      projectId: null,
      sceneModified: false,
      sceneSwitching: false,
    });
    vi.mocked(toastModule.showError).mockClear();
  });

  afterEach(() => {
    setSceneDispatcher(null);
    setCommandBatchDispatcher(undefined);
    clearStagedSceneAudio();
    vi.restoreAllMocks();
  });

  describe('loadScene', () => {
    it('locks every save path with the ENGINE_LOAD_THREW reason even though a rejection would not strand (rejectionStrandsEditor: false)', async () => {
      const engine = standInEngine({ throws: ['load_scene'] });
      attach(engine);
      expectSavingReachesEngine(engine);

      // The caught throw is re-raised: a thrown dispatch is the documented
      // `@throws` of `loadScene`, however the dispatcher reported it — and it
      // is re-raised as the ONE typed error every caller narrows on, so the
      // production dispatcher's answer and the lockout claim stay coupled
      // (#10202 review, M3).
      const thrown = catchThrow(() => useEditorStore.getState().loadScene(
        JSON.stringify(sceneFixture('Target')),
        { rejectionStrandsEditor: false },
      ));
      expect(thrown).toBeInstanceOf(EngineDispatchThrewError);
      expect((thrown as EngineDispatchThrewError).command).toBe('load_scene');
      expect((thrown as Error).message).toBe(ENGINE_FAILURE);

      expectThrewLockout();
      await expectSavingLocked(engine);
    });

    it('still honours strandOnThrow: false for a caught throw (the caller owns the lockout)', () => {
      const engine = standInEngine({ throws: ['load_scene'] });
      attach(engine);

      expect(() => useEditorStore.getState().loadScene(
        JSON.stringify(sceneFixture('Target')),
        { rejectionStrandsEditor: false, strandOnThrow: false },
      )).toThrow(ENGINE_FAILURE);

      expect(useEditorStore.getState().sceneLoadError).toBeNull();
      expectSavingReachesEngine(engine);
    });

    it('control: a clean { success: false } with rejectionStrandsEditor: false locks nothing, exactly as before', () => {
      const engine = standInEngine({ refuses: ['load_scene'] });
      attach(engine);

      expect(useEditorStore.getState().loadScene(
        JSON.stringify(sceneFixture('Target')),
        { rejectionStrandsEditor: false },
      )).toBe(false);

      expect(useEditorStore.getState().sceneLoadError).toBeNull();
      expectSavingReachesEngine(engine);
    });

    it('control: a clean { success: false } under the default policy is a REJECTION lockout, never mistaken for a throw', () => {
      const engine = standInEngine({ refuses: ['load_scene'] });
      attach(engine);

      expect(useEditorStore.getState().loadScene(JSON.stringify(sceneFixture('Target')))).toBe(false);

      const error = useEditorStore.getState().sceneLoadError;
      expect(error?.reason).toContain(REJECTION_SENTENCE);
      expect(error?.reason).not.toContain(THREW_SENTENCE);
    });
  });

  describe('newScene', () => {
    it('locks every save path with the ENGINE_LOAD_THREW reason', async () => {
      const engine = standInEngine({ throws: ['new_scene'] });
      attach(engine);
      expectSavingReachesEngine(engine);

      const thrown = catchThrow(() => useEditorStore.getState().newScene());
      expect(thrown).toBeInstanceOf(EngineDispatchThrewError);
      expect((thrown as EngineDispatchThrewError).command).toBe('new_scene');
      expect((thrown as Error).message).toBe(ENGINE_FAILURE);

      expectThrewLockout();
      await expectSavingLocked(engine);
      // The tracked dispatcher saw the `threw` answer first and used to toast
      // "Couldn't create a new scene. The engine ran into an error." from
      // there — a second notice beside the lockout the slice has just set
      // and the reload sentence the caller shows. It is withheld for the
      // scene-replacing commands (#10202 review, round 2); the lockout notice
      // is the report here, where no caller toasts.
      expect(toastModule.showError).not.toHaveBeenCalled();
    });

    it('control: a clean { success: false } returns false and locks nothing, exactly as before', () => {
      const engine = standInEngine({ refuses: ['new_scene'] });
      attach(engine);

      expect(useEditorStore.getState().newScene()).toBe(false);

      expect(useEditorStore.getState().sceneLoadError).toBeNull();
      expectSavingReachesEngine(engine);
    });
  });

  describe('switchScene (Scene Browser)', () => {
    it('locks saving and tells the user to reload, not that the scene is unchanged, when the target load throws', async () => {
      const engine = standInEngine({ throws: ['load_scene'] });
      attach(engine);
      const targetId = addTargetScene(true);

      await expect(useEditorStore.getState().switchScene(targetId)).resolves.toBeUndefined();

      expect(engine.handle_command).toHaveBeenCalledWith('load_scene', expect.anything());
      expectThrewLockout();
      // ONE user-facing report: the Scene Browser's reload sentence. The
      // tracked dispatcher's generic "Couldn't load the scene. The engine ran
      // into an error." used to land beside it for the same failure; it is
      // withheld for a thrown scene-replacing command (#10202 review, round 2).
      expect(toastModule.showError).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(ENGINE_THREW_RELOAD_GUIDANCE));
      expect(toastModule.showError).not.toHaveBeenCalledWith(expect.stringContaining('unchanged'));
      await expectSavingLocked(engine);
    });
  });

  describe('switch_scene chat tool', () => {
    it('tells the user to reload, not that the scene is unchanged, when the target load throws', async () => {
      const engine = standInEngine({ throws: ['load_scene'] });
      attach(engine);
      const targetId = addTargetScene(true);

      const result = await sceneManagementHandlers.switch_scene({ sceneId: targetId }, chatContext());

      expect(engine.handle_command).toHaveBeenCalledWith('load_scene', expect.anything());
      expect(result.success).toBe(false);
      expect(result.error).toContain(ENGINE_THREW_RELOAD_GUIDANCE);
      expect(result.error).toContain(ENGINE_FAILURE);
      expect(result.error).not.toContain('unchanged');
      expectThrewLockout();
      await expectSavingLocked(engine);
    });

    it('does the same when the target has no stored data and the newScene() fallback throws', async () => {
      const engine = standInEngine({ throws: ['new_scene'] });
      attach(engine);
      const targetId = addTargetScene(false);

      const result = await sceneManagementHandlers.switch_scene({ sceneId: targetId }, chatContext());

      // The fallback branch ran (`new_scene`, not `load_scene`).
      expect(engine.handle_command).toHaveBeenCalledWith('new_scene', {});
      expect(engine.handle_command).not.toHaveBeenCalledWith('load_scene', expect.anything());
      expect(result.success).toBe(false);
      expect(result.error).toContain('Reload the editor');
      expect(result.error).not.toContain('unchanged');
      expectThrewLockout();
      await expectSavingLocked(engine);
    });

    it('control: a clean refusal of the target still answers "unchanged" and locks nothing', async () => {
      const engine = standInEngine({ refuses: ['load_scene'] });
      attach(engine);
      const targetId = addTargetScene(true);

      const result = await sceneManagementHandlers.switch_scene({ sceneId: targetId }, chatContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('unchanged');
      expect(result.error).not.toContain('Reload the editor');
      expect(useEditorStore.getState().sceneLoadError).toBeNull();
      expectSavingReachesEngine(engine);
    });
  });
});
