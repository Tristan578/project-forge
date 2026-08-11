import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createCutsceneDispatcher, LOCAL_CUTSCENE_COMMANDS } from '../dispatch';
import { buildCommand, type CommandDispatcher } from '../player';
import { CUTSCENE_TRACK_TYPES, type CutsceneKeyframe } from '@/stores/cutsceneStore';
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

  beforeEach(() => {
    engine = vi.fn<CommandDispatcher>();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useDialogueStore.setState({ dialogueTrees: { tree_1: TREE }, runtime: idleRuntime() });
  });

  afterEach(() => {
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

  it('reports a payload that is not an object rather than throwing mid-playback', () => {
    expect(() => createCutsceneDispatcher(engine)('start_dialogue', null)).not.toThrow();
    expect(useDialogueStore.getState().runtime.isActive).toBe(false);
    expect(engine).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Every command a cutscene can emit must be routed by something
// ============================================================================
//
// The bug this file exists for was a command name that nothing anywhere handled:
// `start_dialogue` went to the engine dispatcher, which does not know it, and
// `dispatchCommand` returns void — so an authored dialogue beat did nothing and
// reported nothing. A new track type, or a renamed engine command, reintroduces
// it silently. This pins the whole set instead: every command `buildCommand` can
// produce is either handled locally or dispatched by the engine.

/** Command names the engine's own dispatch chain matches on. */
function engineCommandNames(): Set<string> {
  const dir = join(__dirname, '..', '..', '..', '..', '..', 'engine', 'src', 'core', 'commands');
  const files = readdirSync(dir).filter(f => f.endsWith('.rs'));
  // Fails closed: a moved or renamed directory must report here, not pass vacuously.
  expect(files.length, `no .rs files under ${dir} — has the engine layout moved?`).toBeGreaterThan(0);

  const names = new Set<string>();
  for (const file of files) {
    const source = readFileSync(join(dir, file), 'utf8');
    // Both the single-arm form (`"spawn" => ...`) and the alternation lists
    // (`"play_audio" | "stop_audio" => ...`) that classify commands.
    for (const [, name] of source.matchAll(/"([a-z0-9_]+)"\s*(?:=>|\|)/g)) {
      names.add(name);
    }
  }
  expect(names.size, 'engine command scan found implausibly few names').toBeGreaterThan(50);
  return names;
}

describe('cutscene command routing is exhaustive', () => {
  it('every command a track can emit is routed by the engine or locally', () => {
    const keyframe: CutsceneKeyframe = {
      timestamp: 0,
      duration: 1,
      easing: 'linear',
      payload: { treeId: 'tree_1', clipName: 'run' },
    };

    const emitted = CUTSCENE_TRACK_TYPES.map(
      type => buildCommand(type, 'entity1', keyframe, 1)?.command,
    ).filter((name): name is string => typeof name === 'string');

    // Guard the guard: if buildCommand stops emitting anything, the loop below
    // is vacuous and would pass on a completely broken player.
    expect(emitted.length).toBeGreaterThan(0);

    const engineNames = engineCommandNames();
    for (const name of emitted) {
      const routed = name in LOCAL_CUTSCENE_COMMANDS || engineNames.has(name);
      expect(routed, `"${name}" is dispatched by nothing — add an engine handler or a local route`).toBe(true);
    }
  });
});
