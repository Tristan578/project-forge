// @vitest-environment jsdom
/**
 * PF-1148 (#9237), board round 4 on PR #10187: an adjustment marker says "this
 * field holds X because you asked for Y", and it is keyed by entity id. Nothing
 * dropped the OUTGOING scene's markers when the scene was replaced.
 * `GAME_COMPONENT_CHANGED` prunes only a marker whose field now holds a
 * DIFFERENT value, so reloading the same scene file (or restoring a checkpoint,
 * or loading a template with fixed ids) brought the same id back holding the
 * applied value, and the old "you asked for 99999" came back with it.
 *
 * These run the real store, the real tracked dispatcher and the real event
 * handlers, because the defect is in the ORDER the three meet: the engine
 * answers a scene command when it queues it, and emits SCENE_LOADED a frame
 * later (`engine/src/bridge/scene_io.rs`, `apply_scene_load` / `apply_new_scene`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import {
  useEditorStore,
  setCommandDispatcher,
  setCommandBatchDispatcher,
  getCommandDispatcher,
  getCommandBatchDispatcher,
} from '@/stores/editorStore';
import { handleTransformEvent } from '@/hooks/events/transformEvents';
import { handleGameEvent } from '@/hooks/events/gameEvents';
import { buildStoreComponentWithReport } from '@/lib/engine/gameComponentWire';
import { componentAdjustmentsOf } from '@/lib/engine/gameComponentCorrections';
import { clearStagedSceneAudio } from '@/lib/audio/sceneAudioManifest';
import { MAX_COMMAND_PAYLOAD_DEPTH } from '@/lib/engine/commandPayloadGuard';
import { sceneFixture } from '@/lib/scenes/__tests__/sceneFixture';

const ENTITY = 'platform-1';

const speedClamp = {
  component: 'movingPlatform', field: 'speed', requested: 99999, applied: 1000, reason: 'clamped',
} as const;

/** The event handlers ignore `set`/`get`; they write through the store itself. */
const noSet = vi.fn();
const noGet = vi.fn();

/** Add a platform the way a chat tool does: report taken at the first coercion. */
function addOverRangePlatform(): void {
  const built = buildStoreComponentWithReport('moving_platform', { speed: 99999 });
  if (built === null) throw new Error('moving_platform did not build');
  useEditorStore.getState().addGameComponent(ENTITY, built.component, built);
}

function markers() {
  return componentAdjustmentsOf(useEditorStore.getState().gameComponentAdjustments, ENTITY, 'movingPlatform');
}

/** What the engine emits for the platform, in its own flat vocabulary. */
function engineReportsPlatform(speed: number): void {
  handleGameEvent('GAME_COMPONENT_CHANGED', {
    entityId: ENTITY,
    components: [{
      type: 'movingPlatform', speed, waypoints: [[0, 0, 0], [0, 3, 0]], pauseDuration: 0.5, loopMode: 'pingPong',
    }],
  }, noSet, noGet);
}

function engineReportsSceneLoaded(name: string): void {
  handleTransformEvent('SCENE_LOADED', { name }, noSet, noGet);
}

/**
 * An engine that accepts everything, and REFUSES the listed scene commands.
 * Nothing is emitted from inside a dispatch: the tests below fire the events
 * themselves, in the order the real engine produces them.
 */
function attachEngine(refuse: readonly string[] = []) {
  const dispatch = vi.fn((command: string) => (
    refuse.includes(command) ? { success: false, error: `Refused ${command}` } : { success: true }
  ));
  setCommandDispatcher(dispatch);
  return dispatch;
}

describe('adjustment markers across a scene replacement', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useEditorStore.setState({
      allGameComponents: {},
      primaryGameComponents: null,
      primaryId: null,
      gameComponentAdjustments: {},
    });
    clearStagedSceneAudio();
  });

  afterEach(() => {
    setCommandBatchDispatcher(undefined);
    clearStagedSceneAudio();
    vi.restoreAllMocks();
  });

  it.each([
    ['load_scene', () => useEditorStore.getState().loadScene(JSON.stringify(sceneFixture('Level 1')))],
    ['new_scene', () => useEditorStore.getState().newScene()],
  ] as const)('an accepted %s leaves nothing for the same entity id to bring back', (command, replace) => {
    const dispatch = attachEngine();
    addOverRangePlatform();
    // Non-vacuous: the marker the outgoing scene carries.
    expect(markers()).toEqual({ speed: speedClamp });

    expect(replace()).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(command, expect.anything());

    // The engine applies the scene, then reports the same id holding the value
    // the old correction applied — a reload of the same scene file.
    engineReportsSceneLoaded('Level 1');
    engineReportsPlatform(1000);

    expect(useEditorStore.getState().gameComponentAdjustments).toEqual({});
    // The component itself came back; only the claim about it did not.
    expect(useEditorStore.getState().allGameComponents[ENTITY]).toHaveLength(1);
  });

  it('keeps the incoming scene’s markers, written before its SCENE_LOADED arrives', () => {
    // `create_scene_from_description` calls `newScene()` and adds its components
    // in the same task; the engine emits SCENE_LOADED only on its next frame.
    // Those markers describe the incoming scene, so the event must not take them.
    attachEngine();
    expect(useEditorStore.getState().newScene()).toBe(true);
    addOverRangePlatform();
    expect(markers()).toEqual({ speed: speedClamp });

    engineReportsSceneLoaded('Untitled');
    engineReportsPlatform(1000);

    expect(markers()).toEqual({ speed: speedClamp });
  });

  it.each([
    ['load_scene', () => useEditorStore.getState().loadScene(
      JSON.stringify(sceneFixture('Level 1')),
      { rejectionStrandsEditor: false },
    )],
    ['new_scene', () => useEditorStore.getState().newScene()],
  ] as const)('a %s the engine refuses keeps the scene on screen, and its markers', (command, replace) => {
    attachEngine([command]);
    addOverRangePlatform();

    expect(replace()).toBe(false);

    expect(markers()).toEqual({ speed: speedClamp });
  });

  it('a load refused for its size, before it reaches the engine, keeps the markers', () => {
    const dispatch = attachEngine();
    addOverRangePlatform();
    // One level deeper than the guard allows: refused in the wrapper, never sent.
    let deep: unknown = 0;
    for (let i = 0; i <= MAX_COMMAND_PAYLOAD_DEPTH; i += 1) deep = [deep];

    expect(getCommandDispatcher()?.('load_scene', { json: 'x', deep })).toMatchObject({ success: false });
    expect(dispatch).not.toHaveBeenCalledWith('load_scene', expect.anything());

    expect(markers()).toEqual({ speed: speedClamp });
  });

  it('a scene dispatch that throws drops them: the outgoing scene may be gone', () => {
    setCommandDispatcher((command) => {
      if (command === 'new_scene') throw new Error('Transport failed');
      return { success: true };
    });
    addOverRangePlatform();

    expect(() => getCommandDispatcher()?.('new_scene', {})).toThrow('Transport failed');

    expect(useEditorStore.getState().gameComponentAdjustments).toEqual({});
  });

  it('a command that does not replace the scene leaves the markers alone', () => {
    attachEngine();
    addOverRangePlatform();

    getCommandDispatcher()?.('spawn_entity', { entityType: 'cube' });
    getCommandDispatcher()?.('export_scene', { requestId: 'r1' });

    expect(markers()).toEqual({ speed: speedClamp });
  });

  describe('through the batch dispatcher', () => {
    function attachBatchEngine(answer: (command: string) => { success: boolean }) {
      setCommandBatchDispatcher((commands) => {
        const results = commands.map(({ command }) => answer(command));
        return { success: results.every((r) => r.success), results };
      });
      return getCommandBatchDispatcher()!;
    }

    it('an accepted scene command in a batch drops them', () => {
      attachEngine();
      addOverRangePlatform();
      const batch = attachBatchEngine(() => ({ success: true }));

      batch([{ command: 'spawn_entity', payload: {} }, { command: 'new_scene', payload: {} }]);

      expect(useEditorStore.getState().gameComponentAdjustments).toEqual({});
    });

    it('a refused scene command in a batch keeps them, however the rest of the batch went', () => {
      attachEngine();
      addOverRangePlatform();
      const batch = attachBatchEngine((command) => ({ success: command !== 'new_scene' }));

      batch([{ command: 'spawn_entity', payload: {} }, { command: 'new_scene', payload: {} }]);

      expect(markers()).toEqual({ speed: speedClamp });
    });

    it('a batch that throws with a scene command in it drops them, as the single path does', () => {
      attachEngine();
      addOverRangePlatform();
      setCommandBatchDispatcher(() => { throw new Error('Transport failed'); });

      expect(() => getCommandBatchDispatcher()!([{ command: 'new_scene', payload: {} }])).toThrow('Transport failed');

      expect(useEditorStore.getState().gameComponentAdjustments).toEqual({});
    });

    it('a batch the engine never ran keeps them', () => {
      // `useEngineEvents` answers a thrown or unsupported batch with no results.
      attachEngine();
      addOverRangePlatform();
      setCommandBatchDispatcher(() => ({ success: false, results: [] }));

      getCommandBatchDispatcher()!([{ command: 'load_scene', payload: { json: '{}' } }]);

      expect(markers()).toEqual({ speed: speedClamp });
    });
  });
});
