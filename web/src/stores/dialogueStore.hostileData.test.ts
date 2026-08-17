/**
 * dialogueStore hardening against hostile / generated tree data (PF-1144).
 *
 * Dialogue trees are not authored under supervision: the chat handlers write
 * model output into this store verbatim, `importTree` accepts arbitrary JSON,
 * and `loadFromLocalStorage` re-reads whatever was persisted. So a tree id and a
 * variable name are both attacker- (or generator-) controlled values, and each
 * one had a path into a throw or a re-shaped variables object.
 *
 * Scope note: the guards themselves — the hop budget and the condition-depth
 * bound — landed separately as PF-1146, and `dialogueStore.edgeCases.test.ts`
 * pins that they hold at all. What is asserted here is the half PF-1144 adds on
 * top: that giving up REACHES THE AUTHOR (a toast naming the node, not only a
 * console line), and that a tree whose SHAPE is wrong is refused before it can
 * reach the walk at all. Both suites read the same exported `MAX_DIALOGUE_HOPS`
 * / `MAX_CONDITION_DEPTH` rather than carrying a second copy of the limits.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showError } from '@/lib/toast';
import {
  useDialogueStore, MAX_DIALOGUE_HOPS, getTree, listTrees, choicesOf, actionsOf, conditionOf,
} from './dialogueStore';
import type { ConditionNode, ActionNode, EndNode, Condition, DialogueTree } from './dialogueStore';

// Hand-stubbed rather than pulled through `vi.importActual`: this is a leaf of
// pure side-effect functions that the tests ASSERT AGAINST, not a guard under
// test, so there is nothing here for a stub to drift away from. (The guards
// themselves are imported for real, which is the point of the distinction.)
vi.mock('@/lib/toast', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
}));

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

/** Read a tree without going through the store's own guarded lookup. */
function rawTree(treeId: string) {
  return useDialogueStore.getState().dialogueTrees[treeId];
}

beforeEach(() => {
  localStorageMock.clear();
  useDialogueStore.setState({
    dialogueTrees: {},
    runtime: {
      activeTreeId: null,
      currentNodeId: null,
      isActive: false,
      displayedText: '',
      typewriterComplete: false,
      currentChoices: [],
      history: [],
    },
    selectedTreeId: null,
    selectedNodeId: null,
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // `restoreAllMocks` below only unwinds `vi.spyOn`; a `vi.fn()` from a module
  // factory keeps its call log across tests, so an assertion that a toast fired
  // would pass on a leftover call from an earlier one.
  vi.mocked(showError).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// PF-1144 — inherited keys are not trees
// ===========================================================================

describe('tree lookup does not walk the prototype chain', () => {
  // `dialogueTrees['__proto__']` is Object.prototype and `['constructor']` is a
  // function. Both are truthy, so the `if (!tree) return` guarding every lookup
  // used to pass them through to `tree.nodes.find(...)`, which throws because
  // neither has a `nodes` array.
  const inheritedIds = ['__proto__', 'constructor', 'toString', 'valueOf'];

  for (const id of inheritedIds) {
    it(`startDialogue("${id}") is a no-op rather than a throw`, () => {
      expect(() => useDialogueStore.getState().startDialogue(id)).not.toThrow();
      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
      expect(useDialogueStore.getState().runtime.activeTreeId).toBeNull();
    });

    it(`duplicateTree("${id}") returns null rather than throwing`, () => {
      let result: string | null = 'not-called';
      expect(() => { result = useDialogueStore.getState().duplicateTree(id); }).not.toThrow();
      expect(result).toBeNull();
    });

    it(`exportTree("${id}") returns null rather than throwing`, () => {
      let result: string | null = 'not-called';
      expect(() => { result = useDialogueStore.getState().exportTree(id); }).not.toThrow();
      expect(result).toBeNull();
    });
  }

  it('mutating actions against an inherited id leave the store untouched', () => {
    const before = useDialogueStore.getState().dialogueTrees;

    expect(() => {
      useDialogueStore.getState().updateTree('__proto__', { name: 'pwned' });
      useDialogueStore.getState().addNode('__proto__', { id: 'n', type: 'end' } as EndNode);
      useDialogueStore.getState().updateNode('__proto__', 'n', { id: 'x' });
      useDialogueStore.getState().removeNode('__proto__', 'n');
    }).not.toThrow();

    expect(useDialogueStore.getState().dialogueTrees).toEqual(before);
    // The lookup must not have written an own key by touching the inherited one.
    expect(Object.hasOwn(useDialogueStore.getState().dialogueTrees, '__proto__')).toBe(false);
    expect(Object.getPrototypeOf(useDialogueStore.getState().dialogueTrees)).toBe(Object.prototype);
  });

  it('advanceDialogue survives a runtime pointed at an inherited id', () => {
    useDialogueStore.setState(state => ({
      runtime: { ...state.runtime, activeTreeId: '__proto__', currentNodeId: 'anything', isActive: true },
    }));

    expect(() => useDialogueStore.getState().advanceDialogue()).not.toThrow();
    expect(() => useDialogueStore.getState().selectChoice('c1')).not.toThrow();
    expect(() => useDialogueStore.getState().processCurrentNode()).not.toThrow();
    // `skipTypewriter` is the fifth runtime reader of `activeTreeId` and reaches
    // `tree.nodes.find` just like the others; omitting it here left its lookup
    // free to revert to a bare index with nothing failing.
    expect(() => useDialogueStore.getState().skipTypewriter()).not.toThrow();
  });

  it('a real tree named "__proto__" is still reachable as an own key', () => {
    // Object.hasOwn must gate on ownership, not on the spelling of the id — a
    // tree genuinely stored under this key is data, not an inherited artefact.
    const real = { id: '__proto__', name: 'Real', nodes: [], startNodeId: 's', variables: {} };
    useDialogueStore.setState({ dialogueTrees: { ['__proto__']: real } as never });

    expect(useDialogueStore.getState().exportTree('__proto__')).not.toBeNull();
  });

  it('an inherited value that merely looks like a tree is still refused', () => {
    // The shape check is not a substitute for the ownership check. It turns away
    // `Object.prototype` and the builtins hanging off it only because none of them
    // happens to be shaped like a tree — hang a genuinely walkable one there and a
    // bare index lookup hands back a "tree" the store never stored. Decorating the
    // prototype like this is what a library shim or an earlier prototype-pollution
    // bug does for free, so ownership, not shape, is what has to decide.
    Object.defineProperty(Object.prototype, 'sneaky', {
      value: {
        id: 'sneaky',
        name: 'Sneaky',
        startNodeId: 's',
        variables: {},
        nodes: [{ id: 's', type: 'text', speaker: 'X', text: 'pwned', next: null }],
      },
      configurable: true,
    });
    try {
      expect(() => useDialogueStore.getState().startDialogue('sneaky')).not.toThrow();
      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
      expect(useDialogueStore.getState().runtime.activeTreeId).toBeNull();
      expect(useDialogueStore.getState().exportTree('sneaky')).toBeNull();
    } finally {
      delete (Object.prototype as unknown as Record<string, unknown>).sneaky;
    }
  });
});

// ===========================================================================
// PF-1146 — routing chains are walked, not recursed
// ===========================================================================

/**
 * Build `start(text) -> cond -> act -> cond ...`, a routing loop with no text,
 * choice or end node in it. Under the previous self-recursive implementation
 * this was unbounded recursion: a RangeError thrown out of `advanceDialogue`,
 * leaving `isActive` true with no way to close the overlay.
 */
function seedRoutingCycle(): string {
  const treeId = useDialogueStore.getState().addTree('Cyclic', 'Start');
  const { startNodeId } = rawTree(treeId);

  const cond: ConditionNode = {
    id: 'cond_a',
    type: 'condition',
    condition: { type: 'equals', variable: 'always', value: true },
    onTrue: 'act_b',
    onFalse: 'act_b',
  };
  const act: ActionNode = {
    id: 'act_b',
    type: 'action',
    actions: [{ type: 'increment', key: 'laps', amount: 1 }],
    next: 'cond_a',
  };

  useDialogueStore.getState().addNode(treeId, cond);
  useDialogueStore.getState().addNode(treeId, act);
  useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond_a' } as never);
  useDialogueStore.getState().startDialogue(treeId);
  return treeId;
}

describe('a routing cycle ends the dialogue instead of overflowing the stack', () => {
  it('does not throw when the chain loops back on itself', () => {
    seedRoutingCycle();
    expect(() => useDialogueStore.getState().advanceDialogue()).not.toThrow();
    expect(useDialogueStore.getState().runtime.currentNodeId).toBeNull();
  });

  it('closes the dialogue rather than leaving it stuck open', () => {
    seedRoutingCycle();
    useDialogueStore.getState().advanceDialogue();

    expect(useDialogueStore.getState().runtime.isActive).toBe(false);
    expect(useDialogueStore.getState().runtime.activeTreeId).toBeNull();
  });

  it('bounds the work a cycle can do instead of running it forever', () => {
    // The budget is deliberately not a visited-node set. A set would stop at the
    // first repeat, which also stops the terminating counter loop below — the two
    // are indistinguishable by the state they touch, so the only sound
    // discriminator is whether the walk ever ends. The price is that a genuine
    // cycle re-runs its actions until the budget is spent; the guarantee is that
    // the number is bounded and the pass returns.
    const treeId = seedRoutingCycle();
    useDialogueStore.getState().advanceDialogue();

    // Pinned, not bounded: `laps` is produced by the same budget being asserted
    // against, so `laps <= MAX_DIALOGUE_HOPS` holds for every possible budget
    // value and discriminates nothing. The cycle spends one hop on the condition
    // and one on the action, so a completed pass lands on exactly half the budget.
    const laps = rawTree(treeId).variables.laps as number;
    expect(laps).toBe(Math.floor(MAX_DIALOGUE_HOPS / 2));
  });

  it('tells the author, not the console, which node it gave up on', () => {
    // The console is not a channel an author playtesting in the editor watches,
    // and a dialogue that closes itself with nothing said is indistinguishable
    // from one that ended normally. `useScriptRunner` already toasts the sibling
    // failure — a script that would not terminate — and this is the same shape.
    // The node id is the whole repair affordance: "a dialogue closed itself" is
    // not something an author can act on. Either node of the two-node cycle is a
    // fair answer — which one the budget lands on is an artifact of its parity.
    seedRoutingCycle();
    useDialogueStore.getState().advanceDialogue();

    expect(showError).toHaveBeenCalledWith(expect.stringMatching(/"(cond_a|act_b)"/));
  });

  it('a counter loop that ends on its own runs to completion', () => {
    // The shape a visited-node set breaks: "increment until the threshold, then
    // continue" revisits the same two nodes every lap and is a perfectly ordinary
    // thing to author. It must reach its text node with the full count, not be
    // cut off at the first repeat with the variable half-updated.
    const treeId = useDialogueStore.getState().addTree('Counter', 'Start');
    const { startNodeId } = rawTree(treeId);

    // Seeded, because `less` requires a number: an unset counter compares false
    // and the loop would never run a lap at all.
    useDialogueStore.getState().updateTree(treeId, { variables: { laps: 0 } });
    useDialogueStore.getState().addNode(treeId, {
      id: 'cond_a',
      type: 'condition',
      condition: { type: 'less', variable: 'laps', value: 3 },
      onTrue: 'act_b',
      onFalse: 'txt_done',
    } as ConditionNode);
    useDialogueStore.getState().addNode(treeId, {
      id: 'act_b',
      type: 'action',
      actions: [{ type: 'increment', key: 'laps', amount: 1 }],
      next: 'cond_a',
    } as ActionNode);
    useDialogueStore.getState().addNode(treeId, {
      id: 'txt_done', type: 'text', speaker: 'N', text: 'DONE', next: null,
    } as never);
    useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond_a' } as never);

    useDialogueStore.getState().startDialogue(treeId);
    useDialogueStore.getState().advanceDialogue();

    expect(rawTree(treeId).variables.laps).toBe(3);
    expect(useDialogueStore.getState().runtime.displayedText).toBe('DONE');
    expect(useDialogueStore.getState().runtime.isActive).toBe(true);
  });

  it('a chain that revisits a node only after rendering is not treated as a cycle', () => {
    // The guard is per-pass, so a tree that legitimately returns to an earlier
    // action node after the player advances through a text node keeps working.
    const treeId = useDialogueStore.getState().addTree('Revisit', 'Start');
    const { startNodeId } = rawTree(treeId);

    useDialogueStore.getState().addNode(treeId, {
      id: 'act_b',
      type: 'action',
      actions: [{ type: 'increment', key: 'visits', amount: 1 }],
      next: 'txt_c',
    } as ActionNode);
    useDialogueStore.getState().addNode(treeId, {
      id: 'txt_c', type: 'text', speaker: 'N', text: 'again', next: 'act_b',
    } as never);
    useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'act_b' } as never);

    useDialogueStore.getState().startDialogue(treeId);
    useDialogueStore.getState().advanceDialogue(); // start -> act_b -> txt_c
    useDialogueStore.getState().advanceDialogue(); // txt_c -> act_b -> txt_c

    expect(rawTree(treeId).variables.visits).toBe(2);
    expect(useDialogueStore.getState().runtime.isActive).toBe(true);
  });
});

describe('a node of an unknown type ends the walk instead of spinning', () => {
  /**
   * Nothing validates `node.type` at write time — `importTree` and
   * `loadFromLocalStorage` both cast arbitrary JSON, and the chat handlers write
   * model output verbatim. Routing to such a node matches no case, so without a
   * `default` arm the loop re-enters with byte-identical state: a synchronous
   * spin that wedges the tab with no error and no Sentry event.
   *
   * A vitest timeout would NOT have caught that — a synchronous spin never yields
   * the event loop, so the timer never fires and the whole run hangs. What makes
   * this test able to FAIL rather than hang is the step budget, which terminates
   * any non-advancing branch whether or not the `default` arm exists. The arm is
   * what makes it end AT the offending node and say which one.
   */
  function seedUnknownNodeType(): string {
    const treeId = useDialogueStore.getState().addTree('Malformed', 'Start');
    const { startNodeId } = rawTree(treeId);

    useDialogueStore.getState().addNode(treeId, { id: 'weird_x', type: 'wat' } as never);
    useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'weird_x' } as never);
    useDialogueStore.getState().startDialogue(treeId);
    return treeId;
  }

  it('returns rather than looping', () => {
    seedUnknownNodeType();
    expect(() => useDialogueStore.getState().advanceDialogue()).not.toThrow();
  });

  it('closes the dialogue rather than leaving it stuck open', () => {
    seedUnknownNodeType();
    useDialogueStore.getState().advanceDialogue();

    expect(useDialogueStore.getState().runtime.isActive).toBe(false);
    expect(useDialogueStore.getState().runtime.activeTreeId).toBeNull();
  });

  it('reports the type it did not recognise to the console', () => {
    // The console pair is what Sentry groups on, so the message stays a fixed
    // string with the type as a separate argument — interpolating the node id
    // into it would give every malformed tree its own issue. The node id
    // reaches the author through the toast instead (below).
    seedUnknownNodeType();
    useDialogueStore.getState().advanceDialogue();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('unrecognized type'),
      'wat',
    );
  });

  it('stops at the node rather than burning the whole routing budget', () => {
    // Distinguishes the `default` arm from the budget backstop. Both end the pass,
    // so the discriminator is which one reported it: the arm names the node on the
    // first hop, the backstop names the hop count after spending the whole budget.
    // (This is the only assertion here that can fail — a "tree still exists" or
    // "no counter moved" check holds under either outcome and would be filler.)
    seedUnknownNodeType();
    useDialogueStore.getState().advanceDialogue();

    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining(String(MAX_DIALOGUE_HOPS)),
    );
  });

  it('tells the author which node it did not recognise', () => {
    // Same reasoning as the budget's toast: the give-up is only actionable if it
    // reaches the person playtesting, and the node id is the whole affordance.
    seedUnknownNodeType();
    useDialogueStore.getState().advanceDialogue();

    expect(showError).toHaveBeenCalledWith(expect.stringContaining('weird_x'));
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('wat'));
  });
});

describe('a tree with no nodes array is not a tree', () => {
  // The id vector is only half of PF-1144. `importTree` and `loadFromLocalStorage`
  // both cast arbitrary JSON to `DialogueTree` with no runtime shape check, so a
  // tree stored under a perfectly ordinary own key can have no `nodes` at all —
  // and every lookup below went straight to `tree.nodes.find(...)`.
  const SHAPELESS = JSON.stringify({
    id: 'x', name: 'Shapeless', startNodeId: 's', variables: {},
  });

  it('is refused at import instead of stored under a treeId that can never run', () => {
    // The import used to answer with a real treeId for a tree `getTree` would then
    // refuse forever — "reports success, never runs", the same harm the
    // variable-bag repair exists to prevent, reproduced for `nodes`. Both callers
    // already handle `null` by telling the author the import failed.
    expect(useDialogueStore.getState().importTree(SHAPELESS)).toBeNull();
    expect(useDialogueStore.getState().dialogueTrees).toEqual({});
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('cannot be walked'));
  });

  it('is still refused by every read if it reaches the map some other way', () => {
    // The boundary refusal above does not retire the guard: a chat handler writing
    // model output, or any future caller of `set`, puts a tree in the map without
    // passing through ingest at all.
    useDialogueStore.setState({
      dialogueTrees: {
        x: { id: 'x', name: 'Shapeless', startNodeId: 's', variables: {} } as unknown as DialogueTree,
      },
    });

    expect(() => useDialogueStore.getState().startDialogue('x')).not.toThrow();
    expect(useDialogueStore.getState().runtime.isActive).toBe(false);
    expect(() => useDialogueStore.getState().exportTree('x')).not.toThrow();
    expect(useDialogueStore.getState().duplicateTree('x')).toBeNull();
  });

  it('a tree with no startNodeId is refused too', () => {
    // `startNodeId` is where every walk begins, and the editor renders it as a
    // string (`startNodeId.slice(...)`), so a tree without one crashes the panel
    // that would have shown the author what is wrong with it.
    expect(useDialogueStore.getState().importTree(JSON.stringify({
      id: 'x', name: 'No Start', variables: {}, nodes: [],
    }))).toBeNull();

    useDialogueStore.setState({
      dialogueTrees: {
        y: { id: 'y', name: 'No Start', variables: {}, nodes: [] } as unknown as DialogueTree,
      },
    });
    expect(() => useDialogueStore.getState().startDialogue('y')).not.toThrow();
    expect(useDialogueStore.getState().runtime.isActive).toBe(false);
  });
});

describe('condition nesting is bounded', () => {
  /**
   * A chain of ONE combinator type. Both `and` and `or` gained their own
   * `depth + 1`, and a chain that alternates them cannot tell which arm is
   * charging: with 200 levels only half need to count to blow a limit of 32, so
   * either arm can stop charging and the depth test still passes. Measured — an
   * alternating builder let exactly that mutation survive.
   */
  function nest(depth: number, type: 'and' | 'or'): Condition {
    let c: Condition = { type: 'equals', variable: 'a', value: 1 };
    for (let i = 0; i < depth; i++) {
      c = { type, conditions: [c] };
    }
    return c;
  }

  /** Route a condition to two text nodes so the verdict is readable, not just non-throwing. */
  function seedCondition(condition: Condition): string {
    const treeId = useDialogueStore.getState().addTree('Cond', 'Start');
    useDialogueStore.getState().updateTree(treeId, { variables: { a: 1 } });
    const { startNodeId } = rawTree(treeId);

    useDialogueStore.getState().addNode(treeId, {
      id: 'cond', type: 'condition', condition, onTrue: 'txt_true', onFalse: 'txt_false',
    } as ConditionNode);
    useDialogueStore.getState().addNode(treeId, {
      id: 'txt_true', type: 'text', speaker: 'N', text: 'TRUE', next: null,
    } as never);
    useDialogueStore.getState().addNode(treeId, {
      id: 'txt_false', type: 'text', speaker: 'N', text: 'FALSE', next: null,
    } as never);
    useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond' } as never);

    useDialogueStore.getState().startDialogue(treeId);
    return treeId;
  }

  for (const type of ['and', 'or'] as const) {
    it(`evaluates a legally deep "${type}" chain normally`, () => {
      // Asserts the verdict, not merely `not.toThrow()`: with `onFalse` routing
      // anywhere at all, a depth limit of 2 also does not throw, so a throw-only
      // assertion cannot tell "evaluated" from "gave up".
      seedCondition(nest(8, type));

      expect(() => useDialogueStore.getState().advanceDialogue()).not.toThrow();
      expect(useDialogueStore.getState().runtime.displayedText).toBe('TRUE');
    });

    it(`a non-array conditions field on "${type}" is false, not a TypeError`, () => {
      seedCondition({ type, conditions: undefined } as never);

      expect(() => useDialogueStore.getState().advanceDialogue()).not.toThrow();
      expect(useDialogueStore.getState().runtime.displayedText).toBe('FALSE');
    });

    it(`treats a "${type}" chain past the limit as false instead of overflowing`, () => {
      // The condition is true at every level; only the depth bound can make it
      // false. One chain per arm is what makes this fail if EITHER arm stops
      // charging depth.
      seedCondition(nest(200, type));

      expect(() => useDialogueStore.getState().advanceDialogue()).not.toThrow();
      expect(useDialogueStore.getState().runtime.displayedText).toBe('FALSE');
    });
  }

});

// ===========================================================================
// Boy Scout — generated variable names cannot re-shape the variables object
// ===========================================================================

describe('reserved variable names are refused', () => {
  function runAction(action: ActionNode['actions'][number]): string {
    const treeId = useDialogueStore.getState().addTree('Vars', 'Start');
    const { startNodeId } = rawTree(treeId);

    useDialogueStore.getState().addNode(treeId, {
      id: 'act', type: 'action', actions: [action], next: 'end_1',
    } as ActionNode);
    useDialogueStore.getState().addNode(treeId, { id: 'end_1', type: 'end' } as EndNode);
    useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'act' } as never);

    useDialogueStore.getState().startDialogue(treeId);
    useDialogueStore.getState().advanceDialogue();
    return treeId;
  }

  it('set_state cannot re-point the prototype of the variables bag', () => {
    // `variables.__proto__ = x` invokes the inherited setter rather than storing a
    // value, which re-shapes the bag itself. An object value is what makes this
    // discriminating — the setter silently swallows a non-object, so a numeric
    // write looks identical whether or not the guard ran.
    const treeId = runAction({ type: 'set_state', key: '__proto__', value: { injected: 'yes' } });
    const vars = rawTree(treeId).variables;

    expect(Object.getPrototypeOf(vars)).toBe(Object.prototype);
    expect(vars.injected).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('__proto__'));
  });

  it('increment refuses __proto__ loudly rather than silently no-opping', () => {
    const treeId = runAction({ type: 'increment', key: '__proto__', amount: 5 });

    expect(Object.getPrototypeOf(rawTree(treeId).variables)).toBe(Object.prototype);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('__proto__'));
  });

  for (const key of ['constructor', 'prototype'] as const) {
    it(`a variable named "${key}" is stored, not refused`, () => {
      // These are NOT hazards on a plain object: the write creates an ordinary own
      // property, and reads are own-property reads, so the value round-trips. They
      // were briefly in the refusal set, which made an author-chosen name silently
      // unwritable — and left an unset `constructor` reading back as `Object`,
      // which is worse than storing it. This test records that decision.
      const treeId = runAction({ type: 'set_state', key, value: 'mine' });
      const vars = rawTree(treeId).variables;

      expect(Object.hasOwn(vars, key)).toBe(true);
      expect(vars[key]).toBe('mine');
    });
  }

  it('ordinary variable names still write through', () => {
    const treeId = runAction({ type: 'set_state', key: 'gold', value: 10 });
    expect(rawTree(treeId).variables.gold).toBe(10);
  });

  // The refusal above is a `Set<string>` membership test, and that is only sound if
  // the key really is a string. It is typed `string` but comes out of a parsed
  // action, so its runtime type is whatever the JSON said — and a `Set` compares by
  // SameValueZero, so `has(['__proto__'])` is `false` for the one-element array
  // while the write that follows runs ToPropertyKey on it and lands on exactly
  // `"__proto__"`. Every test above drives the string spelling only, which is
  // precisely why this bypass survived them.
  //
  // These cases pin the refusal on the TYPE. No larger Set could close this: every
  // non-string spelling of the same key is a different value.
  describe('a variable name that is not a string is refused, not coerced', () => {
    for (const [label, key] of [
      ['a one-element array', ['__proto__']],
      ['a nested array', [['__proto__']]],
      ['an object with a toString', { toString: () => '__proto__' }],
    ] as const) {
      it(`set_state with ${label} cannot re-point the bag's prototype`, () => {
        const treeId = runAction({
          type: 'set_state',
          key: key as unknown as string,
          value: { injected: 'yes' },
        });
        const vars = rawTree(treeId).variables;

        expect(Object.getPrototypeOf(vars)).toBe(Object.prototype);
        expect(vars.injected).toBeUndefined();
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not a string'));
      });
    }

    it('increment with a non-string key is refused too', () => {
      const treeId = runAction({
        type: 'increment',
        key: ['__proto__'] as unknown as string,
        amount: 5,
      });

      expect(Object.getPrototypeOf(rawTree(treeId).variables)).toBe(Object.prototype);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not a string'));
    });

    it('a non-string key that is NOT __proto__ is still refused, and stores nothing', () => {
      // The refusal is on the type, so it does not depend on which key the
      // coercion would have landed on. A numeric key would be an ordinary own
      // property write, and it is still turned away — a name that is not a string
      // is not a name an author wrote.
      const treeId = runAction({ type: 'set_state', key: 7 as unknown as string, value: 'x' });
      const vars = rawTree(treeId).variables;

      expect(Object.hasOwn(vars, '7')).toBe(false);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not a string'));
    });
  });
});

describe('a variable that was never written is unset, whatever it is named', () => {
  // The read half of the same problem. `variables[key]` walks the prototype chain,
  // so an unset variable named `toString` reads back as a function and one named
  // `constructor` as `Object` — a condition then turns on a name the author never
  // set. `equals: undefined` is the discriminating comparison: under an own-property
  // read it is true, under a bare index read the inherited value makes it false.
  for (const name of ['toString', 'constructor', 'valueOf']) {
    it(`an unset variable named "${name}" does not read back as its inherited value`, () => {
      const treeId = useDialogueStore.getState().addTree('Unset', 'Start');
      const { startNodeId } = rawTree(treeId);

      useDialogueStore.getState().addNode(treeId, {
        id: 'cond',
        type: 'condition',
        condition: { type: 'equals', variable: name, value: undefined },
        onTrue: 'txt_unset',
        onFalse: 'txt_inherited',
      } as ConditionNode);
      useDialogueStore.getState().addNode(treeId, {
        id: 'txt_unset', type: 'text', speaker: 'N', text: 'UNSET', next: null,
      } as never);
      useDialogueStore.getState().addNode(treeId, {
        id: 'txt_inherited', type: 'text', speaker: 'N', text: 'INHERITED', next: null,
      } as never);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond' } as never);

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.displayedText).toBe('UNSET');
    });
  }

  it('an inherited items array is not appended to by add_item', () => {
    // `add_item` used to test `Array.isArray(variables.items)` and then push into
    // whatever that found — an inherited array would be mutated in place, i.e.
    // state shared with every other variables bag in the process.
    const shared: unknown[] = [];
    Object.defineProperty(Object.prototype, 'items', {
      value: shared, writable: true, configurable: true,
    });
    try {
      const treeId = useDialogueStore.getState().addTree('Items', 'Start');
      const { startNodeId } = rawTree(treeId);
      useDialogueStore.getState().addNode(treeId, {
        id: 'act', type: 'action', actions: [{ type: 'add_item', itemId: 'sword' }], next: 'end_1',
      } as ActionNode);
      useDialogueStore.getState().addNode(treeId, { id: 'end_1', type: 'end' } as EndNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'act' } as never);

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(shared).toEqual([]);
      expect(rawTree(treeId).variables.items).toEqual(['sword']);
    } finally {
      delete (Object.prototype as unknown as Record<string, unknown>).items;
    }
  });
});

// ===========================================================================
// Fields inside a tree that the id guard cannot vouch for
// ===========================================================================

describe('a tree that clears the id guard can still carry hostile fields', () => {
  /**
   * The realistic vector, not a hand-built store state: `importTree` parses
   * arbitrary JSON and casts it to `DialogueTree`, so every field below is a
   * value some model or file chose.
   */
  function importRaw(tree: unknown): string {
    const treeId = useDialogueStore.getState().importTree(JSON.stringify(tree));
    expect(treeId).not.toBeNull();
    return treeId as string;
  }

  const TEXT = (id: string, text: string) => ({ id, type: 'text', text, next: null });

  describe('the tree itself', () => {
    it('a missing variables bag is repaired at import, not left to fail later', () => {
      // Omitting an empty bag is a benign thing for a model to do, and the tree is
      // otherwise walkable. Refusing it would mean the import reports success and
      // the tree then never runs, with nothing said — so the bag is filled in here
      // and the condition reads `k` as unset.
      const treeId = importRaw({
        startNodeId: 'c',
        nodes: [
          { id: 'c', type: 'condition', condition: { type: 'equals', variable: 'k', value: 1 }, onTrue: 'y', onFalse: 'n' },
          TEXT('y', 'TRUE'), TEXT('n', 'FALSE'),
        ],
      });

      expect(rawTree(treeId).variables).toEqual({});
      useDialogueStore.getState().startDialogue(treeId);
      expect(useDialogueStore.getState().runtime.displayedText).toBe('FALSE');
    });

    it('a null variables bag is repaired at import rather than replacing the reads', () => {
      // `readVariable` calls `Object.hasOwn(variables, key)`, which throws rather
      // than answering false when the bag is null — the guard would be the crash.
      const treeId = importRaw({
        startNodeId: 'c',
        variables: null,
        nodes: [
          { id: 'c', type: 'condition', condition: { type: 'equals', variable: 'k', value: 1 }, onTrue: 'y', onFalse: 'n' },
          TEXT('y', 'TRUE'), TEXT('n', 'FALSE'),
        ],
      });

      expect(rawTree(treeId).variables).toEqual({});
      expect(() => useDialogueStore.getState().startDialogue(treeId)).not.toThrow();
      expect(useDialogueStore.getState().runtime.displayedText).toBe('FALSE');
    });

    it('a null variables bag that never passed through ingest is refused outright', () => {
      // The repair lives at the boundary; the guard has to hold for a tree that
      // reached the map some other way — a chat handler writing model output, or a
      // future caller of `set`. Without it the first read throws on `hasOwn(null)`.
      useDialogueStore.setState({
        dialogueTrees: {
          injected: {
            id: 'injected', name: 'Injected', startNodeId: 'c',
            variables: null as unknown as Record<string, unknown>,
            nodes: [
              { id: 'c', type: 'condition', condition: { type: 'equals', variable: 'k', value: 1 }, onTrue: 'y', onFalse: 'n' },
              TEXT('y', 'TRUE'), TEXT('n', 'FALSE'),
            ] as unknown as DialogueTree['nodes'],
          },
        },
      });

      expect(() => useDialogueStore.getState().startDialogue('injected')).not.toThrow();
      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
    });

    it('a nodes array holding a null element is repaired at ingest, not walked as-is', () => {
      // `Array.isArray` vouches for the container, never for its elements:
      // `[null]` clears it and throws inside the very first `.find`.
      //
      // The member is dropped rather than the tree refused. The shape is intact —
      // this is one bad element in a tree the author can otherwise still see and
      // edit — so refusing it would cost them every other node to fix one, and the
      // "reports success, never runs" harm is absent either way because what lands
      // in the map is a tree the read guard accepts. The loss is not silent: the
      // count is reported. A tree with no `nodes` array at all is a different
      // thing and is still refused, above.
      const treeId = useDialogueStore.getState().importTree(
        JSON.stringify({ startNodeId: 's', variables: {}, nodes: [null, TEXT('s', 'HELLO')] }),
      );

      expect(treeId).not.toBeNull();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('1 imported node'));
      expect(getTree(useDialogueStore.getState().dialogueTrees, treeId as string)?.nodes)
        .toEqual([TEXT('s', 'HELLO')]);

      useDialogueStore.getState().startDialogue(treeId as string);
      expect(useDialogueStore.getState().runtime.displayedText).toBe('HELLO');
    });

    it('the same tree injected past ingest is still refused by the read', () => {
      useDialogueStore.setState({
        dialogueTrees: {
          n: {
            id: 'n', name: 'Null node', startNodeId: 's', variables: {},
            nodes: [null] as unknown as DialogueTree['nodes'],
          },
        },
      });

      expect(() => useDialogueStore.getState().startDialogue('n')).not.toThrow();
      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
    });

    it('a well-formed tree through the same path still runs', () => {
      const treeId = importRaw({ startNodeId: 's', variables: {}, nodes: [TEXT('s', 'HELLO')] });

      useDialogueStore.getState().startDialogue(treeId);
      expect(useDialogueStore.getState().runtime.displayedText).toBe('HELLO');
    });
  });

  describe('the container the trees live in', () => {
    it('the lookup answers rather than throwing when the container is not an object', () => {
      // Two separate defences, deliberately not relying on each other: load
      // normalizes a non-record blob away, and `getTree` refuses one on its own.
      // It has to be called directly to pin the second, because `getTree` never
      // receives the store's map — it receives whatever its caller passed, and
      // `Object.hasOwn(null, id)` THROWS rather than returning false, so a guard
      // that skipped this check would itself be the crash it exists to prevent.
      for (const container of [null, undefined, 'nope', 42, []]) {
        expect(
          getTree(container as unknown as Record<string, DialogueTree>, '__proto__'),
        ).toBeUndefined();
      }
    });

    it('a present id whose stored value is not a record is refused, not walked', () => {
      // A record container holding a non-record VALUE is a different leg of the
      // walkability check from the container test above, and it is the first leg:
      // every check after it reads a property off `value`, so without it the guard
      // is the throw. Driven through both exported readers because they reach it
      // differently — `getTree` after an ownership check, `listTrees` from inside
      // the `filter` that exists to stop one bad tree taking down the panel.
      for (const stored of [null, 'nope', 42, () => {}]) {
        const map = { t1: stored } as unknown as Record<string, DialogueTree>;

        expect(getTree(map, 't1')).toBeUndefined();
        expect(listTrees(map)).toEqual([]);
      }
    });

    it('a persisted blob that is not an object leaves the runtime idle, not crashed', () => {
      localStorage.setItem('forge_dialogue_trees', 'null');
      useDialogueStore.getState().loadFromLocalStorage();

      expect(() => useDialogueStore.getState().startDialogue('anything')).not.toThrow();
      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
    });

    it('a tree persisted before the repair existed is repaired on load, not stranded', () => {
      // `importTree` used to spread arbitrary JSON straight into the map, so a tree
      // saved by an older build can be sitting in localStorage with no bag. Repairing
      // only at import would leave that tree permanently unrunnable.
      localStorage.setItem('forge_dialogue_trees', JSON.stringify({
        t1: { id: 't1', name: 'T', startNodeId: 's', nodes: [TEXT('s', 'RECOVERED')] },
      }));
      useDialogueStore.getState().loadFromLocalStorage();

      expect(rawTree('t1').variables).toEqual({});
      useDialogueStore.getState().startDialogue('t1');
      expect(useDialogueStore.getState().runtime.displayedText).toBe('RECOVERED');
    });

    it('a persisted object of real trees still loads and runs', () => {
      localStorage.setItem('forge_dialogue_trees', JSON.stringify({
        t1: { id: 't1', name: 'T', startNodeId: 's', variables: {}, nodes: [TEXT('s', 'PERSISTED')] },
      }));
      useDialogueStore.getState().loadFromLocalStorage();

      useDialogueStore.getState().startDialogue('t1');
      expect(useDialogueStore.getState().runtime.displayedText).toBe('PERSISTED');
    });

    it('one unwalkable entry is dropped by name, and does not strand the rest', () => {
      // `{"bad": null}` in storage used to put `null` in the map, and every
      // whole-map read then threw during render. Dropping the one entry costs that
      // tree; keeping it cost the panel — so the entry goes and the id is named,
      // because a tree vanishing silently is not something an author can act on.
      localStorage.setItem('forge_dialogue_trees', JSON.stringify({
        bad: null,
        alsoBad: { id: 'alsoBad', name: 'No nodes', startNodeId: 's', variables: {} },
        good: { id: 'good', name: 'T', startNodeId: 's', variables: {}, nodes: [TEXT('s', 'SURVIVED')] },
      }));
      useDialogueStore.getState().loadFromLocalStorage();

      expect(Object.keys(useDialogueStore.getState().dialogueTrees)).toEqual(['good']);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('bad'));
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('alsoBad'));

      useDialogueStore.getState().startDialogue('good');
      expect(useDialogueStore.getState().runtime.displayedText).toBe('SURVIVED');
    });

    it('a non-object container is refused deliberately, not by falling into the catch', () => {
      // Iterating a non-record throws, and the method-wide try/catch swallows that
      // — so "the map ended up empty" is true both with the guard and without it,
      // and an assertion on the map alone cannot tell a considered refusal from a
      // crash. Two things separate them: the guard REPLACES what was loaded before
      // (the throw path never reaches `set`, so a stale map survives), and it says
      // what it saw instead of reporting a failure it cannot explain.
      useDialogueStore.setState({
        dialogueTrees: {
          stale: { id: 'stale', name: 'S', startNodeId: 's', variables: {}, nodes: [TEXT('s', 'OLD')] },
        } as unknown as Record<string, DialogueTree>,
      });
      localStorage.setItem('forge_dialogue_trees', 'null');
      useDialogueStore.getState().loadFromLocalStorage();

      expect(useDialogueStore.getState().dialogueTrees).toEqual({});
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not an object'));
      expect(console.error).not.toHaveBeenCalled();
    });

    it('a non-object container leaves an empty map, not the parsed value', () => {
      // `Object.keys(null)` throws, and `gameReviewer` calls exactly that to decide
      // whether the game has dialogue — so `null` here is not merely unwalkable, it
      // is a crash one module over. There is nothing in a non-record container to
      // preserve by assigning it through.
      localStorage.setItem('forge_dialogue_trees', 'null');
      useDialogueStore.getState().loadFromLocalStorage();

      expect(useDialogueStore.getState().dialogueTrees).toEqual({});
      expect(() => Object.keys(useDialogueStore.getState().dialogueTrees)).not.toThrow();
    });
  });

  describe('reading the whole map, not one tree by id', () => {
    // `getTree` guards a read by id and says nothing about a read of the whole map,
    // which is what four call sites did — `Object.values(dialogueTrees)` followed by
    // `tree.nodes`, `tree.id` or `tree.name`. Those bypass the guard entirely, so
    // they get their own boundary: `listTrees`.
    const HOSTILE_MAP = {
      nullEntry: null,
      noNodes: { id: 'noNodes', name: 'No nodes', startNodeId: 's', variables: {} },
      real: { id: 'real', name: 'Real', startNodeId: 's', variables: {}, nodes: [TEXT('s', 'HI')] },
    } as unknown as Record<string, DialogueTree>;

    it('skips what cannot be walked and keeps every walkable sibling', () => {
      // Skipped rather than repaired: an author with one corrupt tree keeps every
      // other tree in the panel, which is the only view they have of the tree they
      // need to fix.
      const trees = listTrees(HOSTILE_MAP);

      expect(trees.map((t) => t.id)).toEqual(['real']);
    });

    it('a walk over the result cannot throw on a bad entry', () => {
      // This is the shape of every one of the four call sites: values, then a field.
      expect(() => listTrees(HOSTILE_MAP).map((t) => t.nodes.length + t.name.length)).not.toThrow();
    });

    it('a container that is not an object yields nothing rather than throwing', () => {
      // `Object.values(null)` throws, and the panels that call this run inside a
      // React render where a throw unmounts the surface the author is looking at.
      expect(listTrees(null as unknown as Record<string, DialogueTree>)).toEqual([]);
      expect(listTrees(undefined as unknown as Record<string, DialogueTree>)).toEqual([]);
    });

    it('an all-good map is passed through unfiltered', () => {
      const map = { a: HOSTILE_MAP.real, b: { ...HOSTILE_MAP.real, id: 'b' } };

      expect(listTrees(map).map((t) => t.id)).toEqual(['real', 'b']);
    });
  });

  describe('a condition that is not a condition', () => {
    /** Route the verdict to two text nodes so the branch taken is readable. */
    function seedRawCondition(condition: unknown): string {
      const treeId = importRaw({
        startNodeId: 'c',
        variables: {},
        nodes: [
          { id: 'c', type: 'condition', condition, onTrue: 'y', onFalse: 'n' },
          TEXT('y', 'TRUE'), TEXT('n', 'FALSE'),
        ],
      });
      useDialogueStore.getState().startDialogue(treeId);
      return treeId;
    }

    it('a null condition is false rather than a TypeError on .type', () => {
      expect(() => seedRawCondition(null)).not.toThrow();
      expect(useDialogueStore.getState().runtime.displayedText).toBe('FALSE');
    });

    it('a null nested inside an and-chain is false, not a throw one frame down', () => {
      // The `and` arm checks `Array.isArray(conditions)` and cannot vouch for the
      // elements, so this clears that check and arrives at the recursive call.
      expect(() => seedRawCondition({ type: 'and', conditions: [null] })).not.toThrow();
      expect(useDialogueStore.getState().runtime.displayedText).toBe('FALSE');
    });

    it('a real condition through the same path still evaluates true', () => {
      seedRawCondition({ type: 'and', conditions: [{ type: 'not_equals', variable: 'k', value: 1 }] });
      expect(useDialogueStore.getState().runtime.displayedText).toBe('TRUE');
    });
  });

  describe('actions that are not actions', () => {
    function seedRawActions(actions: unknown): string {
      const treeId = importRaw({
        startNodeId: 'a',
        variables: {},
        nodes: [
          { id: 'a', type: 'action', actions, next: 'done' },
          TEXT('done', 'DONE'),
        ],
      });
      useDialogueStore.getState().startDialogue(treeId);
      return treeId;
    }

    it('a non-array actions field is skipped instead of throwing on for…of', () => {
      // `for…of` over a number throws outright; over a string it would silently
      // iterate characters, which is why the check is on the container, not the
      // elements alone.
      expect(() => seedRawActions(123)).not.toThrow();
      expect(useDialogueStore.getState().runtime.displayedText).toBe('DONE');
    });

    it('a null element is skipped and the actions around it still run', () => {
      const treeId = seedRawActions([null, { type: 'set_state', key: 'flag', value: 'ON' }]);

      expect(useDialogueStore.getState().runtime.displayedText).toBe('DONE');
      expect(rawTree(treeId).variables.flag).toBe('ON');
    });
  });

  describe('a choice node whose choices are not choices', () => {
    const CHOICE_TREE = {
      startNodeId: 'ch',
      variables: {},
      nodes: [
        { id: 'ch', type: 'choice', text: 'Pick', choices: 'nope' },
        TEXT('gone', 'GONE'),
      ],
    };

    it('processCurrentNode offers nothing instead of throwing on .filter', () => {
      const treeId = importRaw(CHOICE_TREE);

      expect(() => useDialogueStore.getState().startDialogue(treeId)).not.toThrow();
      expect(useDialogueStore.getState().runtime.currentChoices).toEqual([]);
    });

    it('selectChoice is a no-op instead of throwing on .find', () => {
      const treeId = importRaw(CHOICE_TREE);
      useDialogueStore.getState().startDialogue(treeId);

      expect(() => useDialogueStore.getState().selectChoice('whatever')).not.toThrow();
      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('ch');
    });

    it('duplicateTree copies the node instead of throwing on .map', () => {
      const treeId = importRaw(CHOICE_TREE);

      const copyId = useDialogueStore.getState().duplicateTree(treeId);
      expect(copyId).not.toBeNull();
      expect(rawTree(copyId as string).nodes).toHaveLength(2);
    });

    it('removeNode prunes edges around the node instead of throwing on .map', () => {
      const treeId = importRaw(CHOICE_TREE);

      expect(() => useDialogueStore.getState().removeNode(treeId, 'gone')).not.toThrow();
      expect(rawTree(treeId).nodes).toHaveLength(1);
    });

    describe('the same node held outside the store', () => {
      // Seven sites outside this file hold a node they got from the same untrusted
      // JSON — the editor's five reads and the chat handler's one. `choicesOf` is
      // exported for them, and its parameter is deliberately `unknown`-shaped: typed
      // `ChoiceNode`, TypeScript would believe `choices` is already an array, which
      // both makes the guard read as dead code and makes the helper unusable at the
      // very sites that need it.
      it('a string choices field yields nothing rather than spreading to characters', () => {
        // The specific harm at the handler: `[...'ab']` is `['a','b']`, and the
        // `updateNode` that follows PERSISTS that back into the store — so the bad
        // shape survives the reload that would otherwise have cleared it.
        expect(choicesOf({ choices: 'ab' })).toEqual([]);
        expect([...choicesOf({ choices: 'ab' }), { id: 'c1' }]).toEqual([{ id: 'c1' }]);
      });

      it('every non-array spelling yields nothing, not a throw at the call site', () => {
        for (const choices of [undefined, null, 123, {}, { length: 2 }, 'nope']) {
          expect(choicesOf({ choices } as { choices?: unknown })).toEqual([]);
        }
      });

      it('a real choices array is returned as-is, not copied into emptiness', () => {
        const choices = [{ id: 'c1', text: 'Yes', nextNodeId: null }];

        expect(choicesOf({ choices })).toBe(choices);
      });

      // The other two payloads the inspector reads off the same untrusted node.
      // The store's own walk already guarded both where it consumes them; these
      // are that rule made reusable, because the inspector had no guard at all.
      it('a non-array actions field yields nothing, at every spelling', () => {
        for (const actions of [undefined, null, 123, {}, { length: 2 }, 'ab']) {
          expect(actionsOf({ actions } as { actions?: unknown })).toEqual([]);
        }
      });

      it('a real actions array is returned as-is', () => {
        const actions = [{ type: 'set_state', key: 'k', value: 1 }];

        expect(actionsOf({ actions } as { actions?: unknown })).toBe(actions);
      });

      it('a condition that is not a record reads as absent, not as a repaired one', () => {
        // `null` rather than an invented `{}`: a condition with no recognised
        // type evaluates as false, and handing the editor a filled-in form for a
        // shape the walk still refuses is the silent-failure this is against. An
        // ARRAY counts as absent too — `.type` on it is `undefined`.
        for (const condition of [undefined, null, 123, 'nope', []]) {
          expect(conditionOf({ condition } as { condition?: unknown })).toBeNull();
        }
      });

      it('a real condition is returned as-is', () => {
        const condition = { type: 'equals', variable: 'v', value: 1 };

        expect(conditionOf({ condition } as { condition?: unknown })).toBe(condition);
      });
    });
  });
});

// ===========================================================================
// The remaining prototype-walking reads, one call site at a time
// ===========================================================================

describe('every variable read is an own-property read, not just the ones on the happy path', () => {
  // `readVariable` is one function, so a test that covers any single call site
  // makes a revert of that ONE function fail — and thereby stands in for the
  // eight sites it does not touch. These pin the sites individually: each seeds an
  // inherited member under the exact name that site reads, so reverting that site
  // alone changes the answer.

  function withInherited(name: string, value: unknown, run: () => void): void {
    Object.defineProperty(Object.prototype, name, {
      value, writable: true, configurable: true,
    });
    try {
      run();
    } finally {
      delete (Object.prototype as unknown as Record<string, unknown>)[name];
    }
  }

  /** Route a condition to two text nodes so the verdict is readable. */
  function verdictOf(condition: Condition): string {
    const treeId = useDialogueStore.getState().addTree('Reads', 'Start');
    const { startNodeId } = rawTree(treeId);

    useDialogueStore.getState().addNode(treeId, {
      id: 'cond', type: 'condition', condition, onTrue: 'yes', onFalse: 'no',
    } as ConditionNode);
    useDialogueStore.getState().addNode(treeId, {
      id: 'yes', type: 'text', speaker: 'N', text: 'TRUE', next: null,
    } as never);
    useDialogueStore.getState().addNode(treeId, {
      id: 'no', type: 'text', speaker: 'N', text: 'FALSE', next: null,
    } as never);
    useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond' } as never);

    useDialogueStore.getState().startDialogue(treeId);
    useDialogueStore.getState().advanceDialogue();
    return useDialogueStore.getState().runtime.displayedText;
  }

  function runAction(action: ActionNode['actions'][number]): string {
    const treeId = useDialogueStore.getState().addTree('Reads', 'Start');
    const { startNodeId } = rawTree(treeId);

    useDialogueStore.getState().addNode(treeId, {
      id: 'act', type: 'action', actions: [action], next: 'end_1',
    } as ActionNode);
    useDialogueStore.getState().addNode(treeId, { id: 'end_1', type: 'end' } as EndNode);
    useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'act' } as never);

    useDialogueStore.getState().startDialogue(treeId);
    useDialogueStore.getState().advanceDialogue();
    return treeId;
  }

  it('has_item does not find an inherited inventory', () => {
    withInherited('items', ['sword'], () => {
      expect(verdictOf({ type: 'has_item', itemId: 'sword' })).toBe('FALSE');
    });
  });

  it('not_equals compares against unset, not against an inherited value', () => {
    withInherited('hp', 5, () => {
      expect(verdictOf({ type: 'not_equals', variable: 'hp', value: 5 })).toBe('TRUE');
    });
  });

  for (const [type, value] of [['greater', 5], ['less', 20]] as const) {
    it(`${type} does not compare against an inherited number`, () => {
      withInherited('score', 10, () => {
        expect(verdictOf({ type, variable: 'score', value })).toBe('FALSE');
      });
    });
  }

  it('remove_item does not splice an inherited array', () => {
    const shared = ['sword'];
    withInherited('items', shared, () => {
      const treeId = runAction({ type: 'remove_item', itemId: 'sword' });

      expect(shared).toEqual(['sword']);
      expect(Object.hasOwn(rawTree(treeId).variables, 'items')).toBe(false);
    });
  });

  it('trigger_event does not push into an inherited event log', () => {
    const shared: string[] = [];
    withInherited('_triggeredEvents', shared, () => {
      const treeId = runAction({ type: 'trigger_event', eventName: 'boss_defeated' });

      expect(shared).toEqual([]);
      expect(rawTree(treeId).variables._triggeredEvents).toEqual(['boss_defeated']);
    });
  });

  it('increment counts from zero, not from an inherited starting value', () => {
    // The ninth of nine call sites, and the one no mutation reverted until M52.
    // It is also the site where a prototype-walking read is *silent* rather than a
    // throw: the read returns a number, the write stores a number, and the only
    // evidence is that the author's counter started somewhere they never set.
    withInherited('score', 10, () => {
      const treeId = runAction({ type: 'increment', key: 'score', amount: 5 });

      // 5 = read was unset and the amount became the value.
      // 15 = the read walked the prototype chain and added to 10.
      expect(rawTree(treeId).variables.score).toBe(5);
    });
  });
});

describe('the last silent way into an unwalkable stored tree is closed', () => {
  /**
   * `importTree` refuses one and `loadFromLocalStorage` drops one, which leaves
   * `updateTree` as the only remaining writer that could put a tree the guards
   * cannot walk into the map. Its parameter is typed, but the chat handlers fill
   * it from model output, and a cast is all that stands between them.
   *
   * Deliberately closed at the WRITE boundary rather than by warning from
   * `getTree`: that is a pure selector called during render, so a warning there
   * would fire once per render in exactly the broken state. Closing it here keeps
   * the residual silent `if (!tree) return` correct, because the only reason left
   * for it is a genuinely absent id.
   */
  it('an update that would make the tree unreadable is refused, not stored', () => {
    const treeId = useDialogueStore.getState().addTree('Good', 'Start');
    const before = rawTree(treeId);

    useDialogueStore.getState().updateTree(treeId, {
      variables: null as unknown as DialogueTree['variables'],
    });

    // Not merely "still walkable" but unchanged: a partially applied update would
    // leave the author's other edits to that tree half-landed.
    expect(rawTree(treeId)).toEqual(before);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('unwalkable'));
  });

  it('an ordinary update still lands', () => {
    // Without this, the refusal above is equally satisfied by an `updateTree` that
    // does nothing at all.
    const treeId = useDialogueStore.getState().addTree('Good', 'Start');

    useDialogueStore.getState().updateTree(treeId, { name: 'Renamed' });

    expect(rawTree(treeId).name).toBe('Renamed');
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('unwalkable'));
  });

  it('dropping the tree a dialogue is running ends the dialogue too', () => {
    // Dropping the tree is right; leaving the runtime aimed at it is not. The
    // overlay renders whenever `isActive` and gates every content block on the
    // current node, so a runtime pointed at a dropped tree paints an empty box
    // that reads as a hang rather than as an ending.
    const treeId = useDialogueStore.getState().addTree('Good', 'Start');
    useDialogueStore.getState().startDialogue(treeId);
    expect(useDialogueStore.getState().runtime.isActive).toBe(true);

    // The same id, stored back without the `nodes` the walk needs — the shape an
    // earlier build or a hand-edited export leaves behind.
    localStorage.setItem(
      'forge_dialogue_trees',
      JSON.stringify({ [treeId]: { id: treeId, name: 'Good', startNodeId: 'Start' } }),
    );
    useDialogueStore.getState().loadFromLocalStorage();

    expect(Object.hasOwn(useDialogueStore.getState().dialogueTrees, treeId)).toBe(false);
    expect(useDialogueStore.getState().runtime.isActive).toBe(false);
    expect(useDialogueStore.getState().runtime.activeTreeId).toBeNull();
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('ended'));
  });

  it('a load that drops nothing the runtime needs leaves the dialogue alone', () => {
    // The negative half. Without it an unconditional teardown satisfies the test
    // above while closing every running dialogue on every load.
    const treeId = useDialogueStore.getState().addTree('Good', 'Start');
    const good = rawTree(treeId);
    useDialogueStore.getState().startDialogue(treeId);

    localStorage.setItem(
      'forge_dialogue_trees',
      JSON.stringify({ [treeId]: good, junk: null }),
    );
    useDialogueStore.getState().loadFromLocalStorage();

    expect(useDialogueStore.getState().runtime.isActive).toBe(true);
    expect(useDialogueStore.getState().runtime.activeTreeId).toBe(treeId);
    // Narrowed from "no toast at all" when the drop itself started reporting:
    // this load DOES drop `junk`, and saying so is correct. What must not happen
    // is the *ending* toast, which is what this test is about.
    expect(showError).not.toHaveBeenCalledWith(expect.stringContaining('ended'));
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('junk'));
  });

  it('a load that drops nothing says nothing', () => {
    const treeId = useDialogueStore.getState().addTree('Good', 'Start');
    const good = rawTree(treeId);

    localStorage.setItem('forge_dialogue_trees', JSON.stringify({ [treeId]: good }));
    useDialogueStore.getState().loadFromLocalStorage();

    expect(showError).not.toHaveBeenCalled();
  });
});

describe('a tree dropped on load is reported to the author, not just the console', () => {
  /**
   * Every other give-up path in this file names itself. This one did not: the
   * author's trees came back one short, the editor's empty state reads the same
   * whether a tree was never created or was removed here, and the only record was
   * a `console.warn` nobody building a conversation is watching. Load is the one
   * moment the loss is known.
   */
  it('names the dropped trees', () => {
    localStorage.setItem(
      'forge_dialogue_trees',
      JSON.stringify({ broken_a: { id: 'broken_a', name: 'A' }, broken_b: null }),
    );

    useDialogueStore.getState().loadFromLocalStorage();

    expect(useDialogueStore.getState().dialogueTrees).toEqual({});
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('broken_a'));
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('broken_b'));
  });

  it('keeps the trees that survived', () => {
    // The drop is not a reason to throw the good trees away, and the report is
    // not a reason to stop loading.
    const treeId = useDialogueStore.getState().addTree('Good', 'Start');
    const good = rawTree(treeId);
    localStorage.setItem(
      'forge_dialogue_trees',
      JSON.stringify({ [treeId]: good, broken: 7 }),
    );

    useDialogueStore.getState().loadFromLocalStorage();

    expect(getTree(useDialogueStore.getState().dialogueTrees, treeId)).toBeDefined();
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('broken'));
  });
});

describe('a sparse nodes array is not an array of nodes', () => {
  /**
   * `Array.prototype.every` SKIPS holes, so the walkability check read
   * `[ , , ].every(isPlainRecord)` as `true` and vouched for the tree — and then
   * `nodes.find`, which does NOT skip holes, threw on `undefined.id`. The guard
   * approved the exact input it exists to turn away.
   *
   * `some`, `filter` and `forEach` skip holes too, so no callback form closes
   * this; only an indexed read sees every slot.
   */
  it('is refused rather than walked', () => {
    const sparse: unknown[] = [{ id: 'a', type: 'end' }];
    sparse[3] = { id: 'b', type: 'end' };  // leaves holes at 1 and 2

    const tree = {
      id: 't', name: 'T', startNodeId: 'a', variables: {}, nodes: sparse,
    } as unknown as DialogueTree;

    expect(getTree({ t: tree }, 't')).toBeUndefined();
  });

  it('the same nodes without the holes are accepted', () => {
    // Without this, refusing every tree satisfies the test above.
    const tree = {
      id: 't',
      name: 'T',
      startNodeId: 'a',
      variables: {},
      nodes: [{ id: 'a', type: 'end' }, { id: 'b', type: 'end' }],
    } as unknown as DialogueTree;

    expect(getTree({ t: tree }, 't')).toBeDefined();
  });
});

describe('a refused import names what it was missing', () => {
  /**
   * The message used to recite all three requirements and leave the author to
   * work out which one their tree failed — on a tree they did not hand-write and
   * cannot see. One case per clause, because the clauses are a hand-maintained
   * mirror of the boolean check and drift silently.
   */
  const complaints: Array<[string, unknown, string]> = [
    ['no nodes', { variables: {}, startNodeId: 's' }, 'nodes'],
    ['no startNodeId', { nodes: [], variables: {} }, 'startNodeId'],
    ['a nodes field that is not an array', { nodes: {}, variables: {}, startNodeId: 's' }, 'nodes'],
    ['not an object at all', [], 'not an object'],
  ];

  it.each(complaints)('%s', (_label, payload, expected) => {
    expect(useDialogueStore.getState().importTree(JSON.stringify(payload))).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(expected));
  });

  // There is deliberately no row for an ELEMENT that is not an object. The
  // clause covers it (`!everyNodeIsRecord`), but no caller can reach that branch
  // of the MESSAGE: `importTree` repairs a non-record element away before the
  // guard runs, and `updateTree` accepts only `name` and `variables`, so a
  // caller-built `nodes` array never passes through a complaint. The check
  // itself is still very much live — `getTree` and `listTrees` call
  // `isWalkableTree` on whatever is already in the map — and that path is pinned
  // by 'the same tree injected past ingest is still refused by the read'.

  it('does not recite the requirements the tree met', () => {
    // The whole point of naming the failure: a tree that does carry a
    // `startNodeId` must not be told it needs one.
    useDialogueStore.getState().importTree(JSON.stringify({ variables: {}, startNodeId: 's' }));

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('nodes'));
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('startNodeId'));
  });

  it('the same message explains a refused update', () => {
    // `variables` is unreachable through `importTree` — `withVariableBag` repairs
    // a missing or non-record bag there, deliberately. `updateTree` is where a
    // bad bag can still arrive, and it recited the same three requirements.
    const treeId = useDialogueStore.getState().addTree('Good', 'Start');

    useDialogueStore.getState().updateTree(treeId, {
      variables: null as unknown as DialogueTree['variables'],
    });

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('`variables` object'));
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('startNodeId'));
  });
});
