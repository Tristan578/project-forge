import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createCutsceneDispatcher, LOCAL_CUTSCENE_COMMANDS } from '../dispatch';
import { buildCommand, CutscenePlayer, type CommandDispatcher } from '../player';
import {
  CUTSCENE_TRACK_TYPES,
  useCutsceneStore,
  type Cutscene,
  type CutsceneKeyframe,
  type CutsceneTrackType,
} from '@/stores/cutsceneStore';
import { useDialogueStore, type DialogueTree } from '@/stores/dialogueStore';

const TREE: DialogueTree = {
  id: 'tree_1',
  name: 'Opening',
  startNodeId: 'n1',
  variables: {},
  nodes: [{ id: 'n1', type: 'text', speaker: 'Guide', text: 'Welcome.', next: null }],
};

function idleRuntime() {
  return {
    activeTreeId: null,
    currentNodeId: null,
    isActive: false,
    displayedText: '',
    typewriterComplete: false,
    currentChoices: [],
    history: [],
  };
}

describe('createCutsceneDispatcher', () => {
  let engine: Mock<CommandDispatcher>;
  let warn: ReturnType<typeof vi.spyOn>;
  /** The store is module state — a test that swaps an action must put it back. */
  let realStartDialogue: (treeId: string) => void;

  beforeEach(() => {
    engine = vi.fn<CommandDispatcher>();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    realStartDialogue = useDialogueStore.getState().startDialogue;
    useDialogueStore.setState({ dialogueTrees: { tree_1: TREE }, runtime: idleRuntime() });
  });

  afterEach(() => {
    useDialogueStore.setState({ startDialogue: realStartDialogue });
    warn.mockRestore();
  });

  it('opens the dialogue tree instead of dispatching to the engine', () => {
    createCutsceneDispatcher(engine)('start_dialogue', { treeId: 'tree_1' });

    expect(useDialogueStore.getState().runtime.activeTreeId).toBe('tree_1');
    expect(useDialogueStore.getState().runtime.isActive).toBe(true);
    expect(engine).not.toHaveBeenCalled();
  });

  it('forwards every other command to the engine with the payload untouched', () => {
    const payload = { mode: 'thirdPersonFollow', entityId: 'e1', _easedProgress: 0.5 };
    createCutsceneDispatcher(engine)('set_game_camera', payload);

    expect(engine).toHaveBeenCalledTimes(1);
    expect(engine.mock.calls[0]).toEqual(['set_game_camera', payload]);
  });

  it('reports a dialogue keyframe with no tree id rather than opening nothing', () => {
    createCutsceneDispatcher(engine)('start_dialogue', { entityId: 'npc1' });

    expect(useDialogueStore.getState().runtime.isActive).toBe(false);
    expect(engine).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('reports a dialogue keyframe naming a tree that no longer exists', () => {
    createCutsceneDispatcher(engine)('start_dialogue', { treeId: 'deleted_tree' });

    expect(useDialogueStore.getState().runtime.isActive).toBe(false);
    expect(engine).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('deleted_tree');
  });

  // `dialogueTrees` is a plain object, so a bare `dialogueTrees[treeId]` read
  // resolves these names to inherited members of Object.prototype — every one of
  // them truthy. An existence check written as a bare read would therefore let a
  // tree id that names no tree through to `startDialogue`, whose own
  // `tree.nodes.find(...)` then throws on a value that is not a tree at all.
  // The ids are reachable: `parseCutsceneResponse` copies keyframe payloads from
  // model output verbatim without validating a single field inside them.
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'treats the inherited property "%s" as a tree that does not exist',
    (treeId) => {
      expect(() => createCutsceneDispatcher(engine)('start_dialogue', { treeId })).not.toThrow();

      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
      expect(engine).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]?.[0])).toContain(treeId);
    },
  );

  it('reports a payload that is not an object rather than throwing mid-playback', () => {
    expect(() => createCutsceneDispatcher(engine)('start_dialogue', null)).not.toThrow();
    expect(useDialogueStore.getState().runtime.isActive).toBe(false);
    expect(engine).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('leaves the tree it is already showing alone instead of restarting it', () => {
    // Asserted against the store action rather than the resulting runtime: a
    // re-`startDialogue` lands on the same start node and `processCurrentNode`
    // rebuilds identical `displayedText`/`typewriterComplete`/`history` values,
    // so every field a caller could read back is the same either way. The reset
    // is only observable in whether the action was called at all.
    const startDialogue = vi.fn();
    useDialogueStore.setState({
      startDialogue,
      dialogueTrees: { tree_1: TREE, tree_2: { ...TREE, id: 'tree_2' } },
      runtime: { ...idleRuntime(), isActive: true, activeTreeId: 'tree_1', currentNodeId: 'n1' },
    });

    const dispatch = createCutsceneDispatcher(engine);
    dispatch('start_dialogue', { treeId: 'tree_1' });
    expect(startDialogue).not.toHaveBeenCalled();

    // Only the already-open tree is skipped — a different tree still opens.
    dispatch('start_dialogue', { treeId: 'tree_2' });
    expect(startDialogue).toHaveBeenCalledExactlyOnceWith('tree_2');
  });

  it('does not resolve a command name to an inherited function', () => {
    // `LOCAL_CUTSCENE_COMMANDS.toString` exists via the prototype chain. Looking a
    // command up with a bare read would "handle" it by calling Object.prototype's
    // method, so the real command would never reach the engine.
    createCutsceneDispatcher(engine)('toString', { entityId: 'e1' });

    expect(engine).toHaveBeenCalledTimes(1);
    expect(engine.mock.calls[0]).toEqual(['toString', { entityId: 'e1' }]);
  });
});

// ============================================================================
// The dialogue beat plays for real
// ============================================================================
//
// Everything above drives the dispatcher directly. The ticket's acceptance
// criterion is about playback, so this drives a real CutscenePlayer over a real
// cutscene and asserts the store the beat is supposed to open.

const DIALOGUE_CUTSCENE: Cutscene = {
  id: 'cs_1',
  name: 'Intro',
  duration: 10,
  tracks: [
    {
      id: 'track_1',
      type: 'dialogue',
      entityId: 'npc1',
      muted: false,
      keyframes: [{ timestamp: 1, duration: 0, easing: 'linear', payload: { treeId: 'tree_1' } }],
    },
  ],
  createdAt: 0,
  updatedAt: 0,
};

describe('a dialogue keyframe reached during playback', () => {
  let engine: Mock<CommandDispatcher>;
  let warn: ReturnType<typeof vi.spyOn>;
  let frames: FrameRequestCallback[];
  let clock: number;
  let player: CutscenePlayer;
  /** The store is module state — a test that swaps an action must put it back. */
  let realStartDialogue: (treeId: string) => void;

  /** Run every frame the player has queued, at the current clock value. */
  function advanceTo(ms: number): void {
    clock = ms;
    for (const frame of frames.splice(0, frames.length)) frame(clock);
  }

  beforeEach(() => {
    engine = vi.fn<CommandDispatcher>();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    frames = [];
    clock = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    realStartDialogue = useDialogueStore.getState().startDialogue;
    useDialogueStore.setState({ dialogueTrees: { tree_1: TREE }, runtime: idleRuntime() });
    useCutsceneStore.setState({ playbackState: 'idle', playbackTime: 0 });
    player = new CutscenePlayer({ dispatchCommand: createCutsceneDispatcher(engine) });
    player.load(DIALOGUE_CUTSCENE);
  });

  afterEach(() => {
    player.stop();
    useDialogueStore.setState({ startDialogue: realStartDialogue });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens the dialogue overlay', () => {
    player.play();
    advanceTo(1200);

    expect(useDialogueStore.getState().runtime.isActive).toBe(true);
    expect(useDialogueStore.getState().runtime.activeTreeId).toBe('tree_1');
    expect(useDialogueStore.getState().runtime.currentNodeId).toBe('n1');
    // The engine never sees it: `start_dialogue` is not one of its commands.
    expect(engine).not.toHaveBeenCalled();
  });

  it('keeps playing when the dialogue store throws', () => {
    useDialogueStore.setState({
      startDialogue: () => {
        throw new Error('tree is malformed');
      },
    });

    player.play();
    advanceTo(1200);

    // The player schedules the next frame *after* dispatching, so an exception
    // escaping the dispatcher would end playback here — mid-cutscene, with no
    // completion callback and nothing to restart it.
    expect(player.isPlaying).toBe(true);
    expect(frames).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();

    advanceTo(2400);
    expect(player.isPlaying).toBe(true);
  });
});

// ============================================================================
// Every command a cutscene can emit must be routed by something
// ============================================================================
//
// The bug this file exists for was a command name that nothing anywhere handled:
// `start_dialogue` went to the engine dispatcher, which does not know it, and
// `dispatchCommand` returns void — so an authored dialogue beat did nothing that
// a player could see. A new track type, or a renamed engine command, reintroduces
// it silently. This pins the whole set instead: every command `buildCommand` can
// produce is either handled locally or dispatched by the engine.

const ENGINE_COMMANDS_DIR = join(
  __dirname, '..', '..', '..', '..', '..', 'engine', 'src', 'core', 'commands',
);

/** The `{ ... }` block opening at `openIndex`, brace-matched. */
function blockAt(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(openIndex, i);
  }
  return '';
}

/** Every `fn <name>` body in `source` whose name matches `namePattern`. */
function fnBodies(source: string, namePattern: string): Array<[string, string]> {
  const bodies: Array<[string, string]> = [];
  const signature = new RegExp(`fn (${namePattern})\\s*\\(`, 'g');
  let match: RegExpExecArray | null;
  while ((match = signature.exec(source)) !== null) {
    const open = source.indexOf('{', signature.lastIndex);
    if (open !== -1) bodies.push([match[1], blockAt(source, open)]);
  }
  return bodies;
}

/**
 * Command names the engine's dispatch chain actually handles.
 *
 * Two refinements over a whole-file scan for quoted strings, both measured:
 *
 * 1. Scoped to `pub fn dispatch` bodies. A whole-file scan matches quoted payload
 *    *values* in the handlers below — `"mask"`, `"blend"`, `"high"`, `"toggle"` —
 *    and every one of those would be accepted as a routed command name.
 * 2. Minus commands whose arm delegates to a handler that only returns
 *    "<name> is not implemented". Those match on the name and then do nothing,
 *    which is the exact failure this pin exists to catch.
 */
function engineCommandNames(): Set<string> {
  const files = readdirSync(ENGINE_COMMANDS_DIR).filter(f => f.endsWith('.rs'));
  // Fails closed: a moved or renamed directory must report here, not pass vacuously.
  expect(
    files.length,
    `no .rs files under ${ENGINE_COMMANDS_DIR} — has the engine layout moved?`,
  ).toBeGreaterThan(0);

  const sources = files.map(file => readFileSync(join(ENGINE_COMMANDS_DIR, file), 'utf8'));

  const unimplemented = new Set<string>();
  for (const source of sources) {
    for (const [name, body] of fnBodies(source, '\\w+')) {
      if (body.includes('is not implemented')) unimplemented.add(name);
    }
  }

  const names = new Set<string>();
  for (const source of sources) {
    const dispatchBodies = fnBodies(source, 'dispatch');
    expect(dispatchBodies.length, 'a commands module with no dispatch fn').toBeGreaterThan(0);
    for (const [, body] of dispatchBodies) {
      // Both the single-arm form (`"spawn" => ...`) and the alternation lists
      // (`"play_audio" | "stop_audio" => ...`) that classify commands.
      for (const arm of body.matchAll(/"([a-z0-9_]+)"\s*(?:=>|\|)/g)) {
        const at = arm.index ?? 0;
        const handler = body.slice(at, at + 200).match(/\bhandle_\w+/)?.[0];
        if (handler !== undefined && unimplemented.has(handler)) continue;
        names.add(arm[1]);
      }
    }
  }
  return names;
}

describe('cutscene command routing is exhaustive', () => {
  /**
   * Track types that legitimately dispatch nothing.
   *
   * Named rather than filtered out of the results: a filter would also swallow a
   * NEW track type whose `buildCommand` arm nobody wrote, which returns null from
   * the `default` case and looks exactly like a `wait`.
   */
  const EMITS_NO_COMMAND = new Set<CutsceneTrackType>(['wait']);

  /**
   * One payload carrying every field any track's arm reads, so a single fixture
   * exercises all of them.
   *
   * `mode` is load-bearing rather than decorative: the camera arm reads the
   * keyframe through `isCameraMode` and returns null on a mode it does not
   * recognize (PF-1126), so a payload without one makes the camera track look
   * indistinguishable from a track whose arm nobody wrote — which is the exact
   * failure this test exists to catch.
   */
  const KEYFRAME: CutsceneKeyframe = {
    timestamp: 0,
    duration: 1,
    easing: 'linear',
    payload: { treeId: 'tree_1', clipName: 'run', mode: 'thirdPersonFollow' },
  };

  it('extracts real engine command names and not payload values', () => {
    const names = engineCommandNames();

    // Quoted payload values that a whole-file scan mistakes for command names.
    for (const value of ['mask', 'blend', 'value', 'high', 'add', 'toggle', 'step']) {
      expect(names.has(value), `"${value}" is a payload value, not a command`).toBe(false);
    }
    // Arms that match a name and then report the command is not implemented.
    for (const stub of ['set_camera', 'update_scene', 'list_shaders']) {
      expect(names.has(stub), `"${stub}" is matched but unimplemented`).toBe(false);
    }
    for (const real of [
      'spawn_entity', 'play_audio', 'set_game_camera', 'play_animation',
      'update_physics', 'mouse_delta',
    ]) {
      expect(names.has(real), `"${real}" is a real command and must be found`).toBe(true);
    }
    expect(names.size, 'engine command scan found implausibly few names').toBeGreaterThan(200);
  });

  it('every command a track can emit is routed by the engine or locally', () => {
    const engineNames = engineCommandNames();

    for (const type of CUTSCENE_TRACK_TYPES) {
      const built = buildCommand(type, 'entity1', KEYFRAME, 1);

      if (EMITS_NO_COMMAND.has(type)) {
        expect(built, `"${type}" emits a command — remove it from EMITS_NO_COMMAND`).toBeNull();
        continue;
      }

      expect(
        built,
        `"${type}" emits nothing — add a buildCommand arm, or list it in EMITS_NO_COMMAND`,
      ).not.toBeNull();

      const name = built?.command ?? '<no command>';
      const routed = Object.hasOwn(LOCAL_CUTSCENE_COMMANDS, name) || engineNames.has(name);
      expect(
        routed,
        `"${name}" is dispatched by nothing — add an engine handler or a local route`,
      ).toBe(true);
    }
  });

  it('sends the dialogue tree id under the key the local route reads', () => {
    // A full-shape assertion, not `objectContaining`: the whole bug was a payload
    // whose keys nothing on the receiving side read, and a partial match cannot
    // see a renamed or missing key.
    expect(buildCommand('dialogue', 'npc1', KEYFRAME, 1)).toEqual({
      command: 'start_dialogue',
      payload: { treeId: 'tree_1', entityId: 'npc1' },
    });
  });
});
