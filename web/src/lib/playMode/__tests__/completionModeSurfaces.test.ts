/**
 * @vitest-environment jsdom
 *
 * Completion modes across every surface that sets or reads them
 * (idea.FR-1.OP-04, #9998).
 *
 * Two creators, one field. The manual picker calls `setCompletionMode`; the AI
 * calls the `set_completion_mode` tool through the real chat executor. Both
 * must land on the same `sceneGraph.completionMode`, be refused with the same
 * words, and be judged identically by the two gates that read it: the Play
 * button (`gameSlice.play()`) and orchestrator verification
 * (`verify_all_scenes`). Then the value has to survive save and reopen through
 * the real SCENE_EXPORTED / loadScene / SCENE_LOADED handlers.
 *
 * Everything here is production code on the real editor store. The only double
 * is the engine: a dispatcher that accepts every command.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore, setCommandDispatcher } from '@/stores/editorStore';
import { executeToolCall } from '@/lib/chat/executor';
import { handleTransformEvent } from '@/hooks/events/transformEvents';
import { verifyExecutor } from '@/lib/game-creation/executors/verifyExecutor';
import { SCENE_EXPORTED_EVENT, type SceneExportedDetail } from '@/lib/engine/sceneExportWire';
import { savePrefabInstancesToStorage } from '@/lib/prefabs/prefabStore';
import { COMPLETION_MODES, type CompletionMode } from '@/lib/playMode/completionMode';
import { takeStagedSceneCompletionMode } from '@/lib/scenes/sceneCompletionMode';
import type { ExecutorContext } from '@/lib/game-creation/types';
import type { GameComponentData, SceneNode } from '@/stores/slices/types';

const dispatch = vi.fn((_command: string, _payload: unknown) => ({ success: true }));

function node(entityId: string, name: string, components: string[] = []): SceneNode {
  return { entityId, name, parentId: null, children: [], components, visible: true };
}

const CONTROLLER: GameComponentData = {
  type: 'characterController',
  characterController: { speed: 5, jumpHeight: 2, gravityScale: 1, canDoubleJump: false },
};

/**
 * A sandbox-shaped scene: camera, ground, a controllable player and a thing to
 * interact with — and no win condition anywhere.
 */
function seedSceneWithoutGoal(extraComponents: Record<string, GameComponentData[]> = {}) {
  useEditorStore.setState({
    sceneGraph: {
      nodes: {
        player: node('player', 'Player', ['PhysicsEnabled']),
        cam: node('cam', 'MainCamera'),
        ground: node('ground', 'Ground'),
        ball: node('ball', 'Ball'),
      },
      rootIds: ['player', 'cam', 'ground', 'ball'],
    },
    nodeCount: 4,
    allGameComponents: { player: [CONTROLLER], ...extraComponents },
    completionModeHistory: { past: [], future: [] },
    sceneModified: false,
    sceneLoadError: null,
    engineMode: 'edit',
  });
}

function verifyCtx(): ExecutorContext {
  return {
    dispatchCommand: vi.fn(),
    getStore: () => useEditorStore.getState(),
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: () => undefined,
    resolveStepOutputs: () => [],
  };
}

/** Press Play. True when the gate let the `play` command through. */
function pressPlay(): boolean {
  dispatch.mockClear();
  useEditorStore.getState().play();
  return dispatch.mock.calls.some(([command]) => command === 'play');
}

async function verify(): Promise<{ success: boolean; codes: string[] }> {
  const result = await verifyExecutor.execute({}, verifyCtx());
  return {
    success: result.success,
    codes: ((result.output?.winnabilityIssues as string[] | undefined) ?? []),
  };
}

type Surface = 'manual' | 'ai';

async function setMode(surface: Surface, mode: unknown): Promise<{ ok: boolean; error?: string }> {
  if (surface === 'manual') {
    // The action the picker's radio buttons call.
    const result = useEditorStore.getState().setCompletionMode(mode);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }
  const result = await executeToolCall('set_completion_mode', { mode }, useEditorStore.getState());
  return result.success ? { ok: true } : { ok: false, error: result.error };
}

beforeEach(() => {
  setCommandDispatcher(dispatch);
  savePrefabInstancesToStorage([]);
  takeStagedSceneCompletionMode();
  seedSceneWithoutGoal();
});

afterEach(() => {
  dispatch.mockClear();
  sessionStorage.clear();
  localStorage.clear();
});

describe.each(['manual', 'ai'] as const)('the %s surface', (surface) => {
  it.each(COMPLETION_MODES)('sets %s, and Play and verify agree on it', async (mode) => {
    await expect(setMode(surface, mode)).resolves.toEqual({ ok: true });

    expect(useEditorStore.getState().sceneGraph.completionMode).toBe(mode);
    const played = pressPlay();
    const verified = await verify();
    if (mode === 'win') {
      // Win mode with no goal: both gates refuse, for the same reason.
      expect(played).toBe(false);
      expect(verified.success).toBe(false);
      expect(verified.codes).toEqual(['NO_WIN_CONDITION']);
    } else {
      // Sandbox/endless/narrative with no goal is the point of the mode.
      expect(played).toBe(true);
      expect(verified).toEqual({ success: true, codes: [] });
    }
  });

  it('records the change for undo, so the other surface can revert it', async () => {
    await setMode(surface, 'sandbox');

    const undone = surface === 'manual'
      ? (await executeToolCall('undo', { scope: 'completion_mode' }, useEditorStore.getState())).success
      : useEditorStore.getState().undoCompletionMode();
    expect(undone).toBe(true);
    expect(useEditorStore.getState().sceneGraph.completionMode).toBeUndefined();
  });
});

describe('identical validation and errors', () => {
  it.each(['puzzle', 'Sandbox', undefined, 7])('both surfaces refuse %p with the same words and change nothing', async (bad) => {
    useEditorStore.getState().setCompletionMode('endless');

    const manual = await setMode('manual', bad);
    const ai = await setMode('ai', bad);

    expect(manual.ok).toBe(false);
    expect(ai).toEqual(manual);
    expect(useEditorStore.getState().sceneGraph.completionMode).toBe('endless');
  });
});

describe('a win goal that is missing fails both gates in every mode', () => {
  it.each(COMPLETION_MODES)('%s mode: a reach-goal pointing at a deleted entity blocks Play and verify', async (mode) => {
    // The mode only removes the REQUIREMENT for a goal. A goal that exists but
    // cannot be satisfied is still a broken game, whatever the mode.
    seedSceneWithoutGoal({
      ball: [{ type: 'winCondition', winCondition: { conditionType: 'reachGoal', targetScore: null, targetEntityId: 'gone' } }],
    });
    await setMode('ai', mode);

    expect(pressPlay()).toBe(false);
    const verified = await verify();
    expect(verified.success).toBe(false);
    expect(verified.codes).toContain('GOAL_TARGET_MISSING');
  });
});

describe('a manual correction survives a later targeted AI edit', () => {
  it('keeps the creator\'s mode through an AI rename and the engine\'s answers to it', async () => {
    await setMode('ai', 'sandbox');
    // The creator disagrees and corrects it by hand.
    await setMode('manual', 'narrative');

    // A later, unrelated AI edit, and every event the engine sends back for it.
    const edit = await executeToolCall('rename_entity', { entityId: 'ball', name: 'Beach ball' }, useEditorStore.getState());
    expect(edit.success).toBe(true);
    expect(dispatch).toHaveBeenCalledWith('rename_entity', { entityId: 'ball', name: 'Beach ball' });
    handleTransformEvent('SCENE_NODE_UPDATED', { entityId: 'ball', name: 'Beach ball' }, useEditorStore.setState, useEditorStore.getState);
    const graph = useEditorStore.getState().sceneGraph;
    // The engine's rebuild payload never carries a mode.
    handleTransformEvent('SCENE_GRAPH_UPDATE', { nodes: graph.nodes, rootIds: graph.rootIds }, useEditorStore.setState, useEditorStore.getState);

    expect(useEditorStore.getState().sceneGraph.nodes.ball.name).toBe('Beach ball');
    expect(useEditorStore.getState().sceneGraph.completionMode).toBe('narrative');
    expect(pressPlay()).toBe(true);
  });
});

describe('save and reopen', () => {
  /** What the engine exports: the ECS scene, with no idea a mode exists. */
  function engineExport(name: string): string {
    return JSON.stringify({
      formatVersion: 3,
      metadata: { name, createdAt: '', modifiedAt: '' },
      environment: {},
      ambientLight: { color: [1, 1, 1], brightness: 300 },
      entities: [],
    });
  }

  /** Answer an export the way the bridge does, and return what consumers saw. */
  function exportScene(rawJson: string): string {
    let saved = '';
    const listener = (event: Event) => {
      saved = (event as CustomEvent<SceneExportedDetail>).detail.json;
    };
    window.addEventListener(SCENE_EXPORTED_EVENT, listener);
    try {
      handleTransformEvent('SCENE_EXPORTED', { json: rawJson, name: 'Saved' }, useEditorStore.setState, useEditorStore.getState);
    } finally {
      window.removeEventListener(SCENE_EXPORTED_EVENT, listener);
    }
    return saved;
  }

  /** Reopen a saved file: the load request, then the engine's confirmation. */
  function reopen(savedJson: string): void {
    // Something else was open in between.
    useEditorStore.getState().hydrateCompletionMode('endless');
    expect(useEditorStore.getState().loadScene(savedJson)).toBe(true);
    handleTransformEvent('SCENE_LOADED', { name: 'Saved' }, useEditorStore.setState, useEditorStore.getState);
    // The engine's first graph after a load carries no mode either.
    handleTransformEvent('SCENE_GRAPH_UPDATE', { nodes: {}, rootIds: [] }, useEditorStore.setState, useEditorStore.getState);
  }

  it.each([
    ['manual', 'sandbox'], ['ai', 'sandbox'],
    ['manual', 'endless'], ['ai', 'narrative'], ['manual', 'win'],
  ] as const)('a mode set by the %s surface (%s) is in the saved file and back after reopening', async (surface, mode) => {
    await setMode(surface, mode as CompletionMode);

    const saved = exportScene(engineExport('Saved'));
    expect(JSON.parse(saved).completionMode).toBe(mode);
    expect(sessionStorage.getItem('forge:scene-last-json')).toBe(saved);

    reopen(saved);

    expect(useEditorStore.getState().sceneGraph.completionMode).toBe(mode);
    // Reopening restores what was saved; it is not an undoable edit.
    expect(useEditorStore.getState().completionModeHistory).toEqual({ past: [], future: [] });
  });

  it.each(['manual', 'ai'] as const)('a sandbox scene with no goal set by the %s surface plays both before and after save/reopen', async (surface) => {
    await setMode(surface, 'sandbox');
    expect(pressPlay()).toBe(true);

    const saved = exportScene(engineExport('Saved'));
    reopen(saved);
    // Reopening replaced the graph; put the same goal-free scene back.
    const { completionMode } = useEditorStore.getState().sceneGraph;
    seedSceneWithoutGoal();
    useEditorStore.getState().hydrateCompletionMode(completionMode);

    expect(pressPlay()).toBe(true);
    expect(await verify()).toEqual({ success: true, codes: [] });
  });

  it('a legacy file (no field) opens as win, keeps the win gate, and resaves without gaining the field', () => {
    const legacy = engineExport('Legacy');

    reopen(legacy);

    expect(useEditorStore.getState().sceneGraph.completionMode).toBeUndefined();
    seedSceneWithoutGoal();
    expect(pressPlay()).toBe(false);

    // Resaving writes exactly what the engine exported: nothing added, nothing dropped.
    expect(exportScene(legacy)).toBe(legacy);
  });
});


describe('AI completion-mode history scope', () => {
  it('undoes and redoes without dispatching engine history', async () => {
    await setMode('ai', 'sandbox');
    dispatch.mockClear();
    expect((await executeToolCall('undo', { scope: 'completion_mode' }, useEditorStore.getState())).success).toBe(true);
    expect(useEditorStore.getState().sceneGraph.completionMode).toBeUndefined();
    expect((await executeToolCall('redo', { scope: 'completion_mode' }, useEditorStore.getState())).success).toBe(true);
    expect(useEditorStore.getState().sceneGraph.completionMode).toBe('sandbox');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each(['undo', 'redo'])('%s refuses empty history and invalid scopes without touching the engine', async (tool) => {
    dispatch.mockClear();
    expect((await executeToolCall(tool, { scope: 'completion_mode' }, useEditorStore.getState())).success).toBe(false);
    expect((await executeToolCall(tool, { scope: 'typo' }, useEditorStore.getState())).success).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
