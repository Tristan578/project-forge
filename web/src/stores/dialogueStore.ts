import { create } from 'zustand';
import { showError } from '@/lib/toast';

const DIALOGUE_STORAGE_KEY = 'forge_dialogue_trees';

// ============================================================================
// Types
// ============================================================================

export interface DialogueTree {
  id: string;
  name: string;
  nodes: DialogueNode[];
  startNodeId: string;
  variables: Record<string, unknown>;
}

export type DialogueNode = TextNode | ChoiceNode | ConditionNode | ActionNode | EndNode;

interface BaseNode {
  id: string;
  position?: { x: number; y: number };
}

export interface TextNode extends BaseNode {
  type: 'text';
  speaker: string;
  text: string;
  portrait?: string;
  voiceAsset?: string;
  next: string | null;
}

export interface ChoiceNode extends BaseNode {
  type: 'choice';
  speaker?: string;
  text?: string;
  choices: DialogueChoice[];
}

export interface DialogueChoice {
  id: string;
  text: string;
  nextNodeId: string | null;
  condition?: Condition;
}

export interface ConditionNode extends BaseNode {
  type: 'condition';
  condition: Condition;
  onTrue: string | null;
  onFalse: string | null;
}

export interface ActionNode extends BaseNode {
  type: 'action';
  actions: DialogueAction[];
  next: string | null;
}

export interface EndNode extends BaseNode {
  type: 'end';
}

export type Condition =
  | { type: 'equals'; variable: string; value: unknown }
  | { type: 'not_equals'; variable: string; value: unknown }
  | { type: 'greater'; variable: string; value: number }
  | { type: 'less'; variable: string; value: number }
  | { type: 'has_item'; itemId: string }
  | { type: 'and'; conditions: Condition[] }
  | { type: 'or'; conditions: Condition[] };

export type DialogueAction =
  | { type: 'set_state'; key: string; value: unknown }
  | { type: 'add_item'; itemId: string }
  | { type: 'remove_item'; itemId: string }
  | { type: 'increment'; key: string; amount: number }
  | { type: 'trigger_event'; eventName: string };

export interface DialogueRuntimeState {
  activeTreeId: string | null;
  currentNodeId: string | null;
  isActive: boolean;
  displayedText: string;
  typewriterComplete: boolean;
  currentChoices: DialogueChoice[];
  history: DialogueHistoryEntry[];
}

export interface DialogueHistoryEntry {
  speaker: string;
  text: string;
}

// ============================================================================
// Store Interface
// ============================================================================

interface DialogueStore {
  // Data - loaded from localStorage
  dialogueTrees: Record<string, DialogueTree>;

  // Runtime
  runtime: DialogueRuntimeState;

  // Editor
  selectedTreeId: string | null;
  selectedNodeId: string | null;

  // Tree CRUD
  addTree: (name: string, startNodeText?: string) => string;
  removeTree: (treeId: string) => void;
  updateTree: (treeId: string, updates: Partial<Pick<DialogueTree, 'name' | 'variables'>>) => void;
  duplicateTree: (treeId: string) => string | null;

  // Node CRUD
  addNode: (treeId: string, node: DialogueNode) => void;
  updateNode: (treeId: string, nodeId: string, updates: Partial<DialogueNode>) => void;
  removeNode: (treeId: string, nodeId: string) => void;

  // Runtime actions
  startDialogue: (treeId: string) => void;
  advanceDialogue: () => void;
  selectChoice: (choiceId: string) => void;
  skipTypewriter: () => void;
  endDialogue: () => void;

  // Editor
  selectTree: (treeId: string | null) => void;
  selectNode: (nodeId: string | null) => void;

  // Persistence
  loadFromLocalStorage: () => void;
  saveToLocalStorage: () => void;

  // Import/Export
  exportTree: (treeId: string) => string | null;
  importTree: (jsonData: string) => string | null;

  // Internal helper
  processCurrentNode: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  return `${prefix}_${timestamp}_${random}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * How many nodes one `processCurrentNode` walk may visit before it gives up and
 * ends the dialogue.
 *
 * Only `condition` and `action` nodes route onward; every `text`, `choice` and
 * `end` node ends the walk. So the budget is spent on a run of consecutive
 * routing nodes, plus the one terminal node that stops it — a walk can cross at
 * most `MAX_DIALOGUE_HOPS - 1` routing nodes and still reach something the
 * player sees. No authored conversation comes near that; the cap exists solely
 * to stop a cyclic tree from looping forever (PF-1146).
 *
 * Exported so tests assert against this value rather than a second copy of it.
 */
export const MAX_DIALOGUE_HOPS = 1000;

/**
 * How deeply `evaluateCondition` will descend through nested `and`/`or` groups
 * before treating the condition as unsatisfied.
 *
 * The evaluator recurses, and `JSON.parse` does not: V8 parses object nesting
 * iteratively, so `importTree` accepts a condition thousands of levels deep
 * that then overflows the stack when it is evaluated. That `RangeError` escapes
 * `processCurrentNode` and takes down the play session — the same failure
 * `MAX_DIALOGUE_HOPS` exists to prevent, reached through the other recursion in
 * this file (PF-1146).
 *
 * 64 is far past any authored condition and two orders of magnitude below where
 * the stack actually gives out.
 */
export const MAX_CONDITION_DEPTH = 64;

/**
 * A tree that cannot be walked is not a tree. `importTree` and
 * `loadFromLocalStorage` both cast arbitrary JSON to `DialogueTree` with no
 * runtime shape check, so every field below is a value some model or file
 * chose — checking the id alone leaves `tree.nodes.find` and
 * `variables[key]` one frame away from throwing on the same hostile input.
 *
 * `nodes` is walked element-wise because `[null]` survives `Array.isArray` and
 * throws inside the very first `.find`. That is O(n) on a lookup whose callers
 * are already O(n) over the same array.
 *
 * `startNodeId` is where every walk begins and is rendered as a string by the
 * editor (`startNodeId.slice(...)`), so a tree without one is not walkable either
 * — approving it would hand the editor a tree that crashes its own panel.
 *
 * What this deliberately does NOT check is the type-specific payload of each
 * node: a `choice` node's `choices`, a `text` node's `text`. Those are read in
 * more places than a boundary can enumerate, and refusing a whole tree because
 * one node is malformed would take away the author's only view of the node they
 * need to fix. They are guarded where they are read instead — `choicesOf` below,
 * and the editor's own node label.
 */
function isWalkableTree(value: unknown): value is DialogueTree {
  return isPlainRecord(value)
    && Array.isArray(value.nodes)
    && everyNodeIsRecord(value.nodes)
    && isPlainRecord(value.variables)
    && typeof value.startNodeId === 'string';
}

/**
 * `Array.prototype.every` SKIPS holes, so `new Array(3).every(isPlainRecord)` is
 * `true` and a sparse `nodes` array clears the walkability check above — after
 * which `nodes.find`, which does NOT skip holes, throws on `undefined.id`. The
 * guard would have vouched for the exact tree it exists to turn away.
 *
 * `some`, `filter` and `forEach` skip holes too, so there is no callback form
 * that closes this; indexing explicitly is the only shape that sees every slot.
 * `JSON.parse` cannot produce a hole, but `addTree` and `updateTree` take a
 * caller-built array, and both feed this same check.
 */
function everyNodeIsRecord(nodes: unknown[]): boolean {
  for (let i = 0; i < nodes.length; i += 1) {
    if (!isPlainRecord(nodes[i])) return false;
  }
  return true;
}

/**
 * Name what a rejected tree is missing, rather than reciting every requirement.
 *
 * `isWalkableTree` is a boolean, so the message next to it had to list all three
 * fields and leave the author to work out which one their tree failed. The
 * clauses below are in the same order as the checks they mirror; keeping them in
 * step is the cost of the better message, and the tests pin one case per clause.
 */
function walkabilityComplaint(value: unknown): string {
  if (!isPlainRecord(value)) return 'it is not an object';
  const missing: string[] = [];
  if (!Array.isArray(value.nodes) || !everyNodeIsRecord(value.nodes)) {
    missing.push('a `nodes` array of objects');
  }
  if (!isPlainRecord(value.variables)) missing.push('a `variables` object');
  if (typeof value.startNodeId !== 'string') missing.push('a string `startNodeId`');
  return missing.length > 0 ? `it needs ${missing.join(' and ')}` : 'it cannot be walked';
}

/**
 * Give an ingested tree the state bag the runtime needs.
 *
 * `isWalkableTree` refuses a tree whose `variables` is not a record, because
 * every condition and action reads through it and `Object.hasOwn(null, k)`
 * throws. But omitting an empty bag is a benign thing for a model or a
 * hand-written `.json` to do, and refusing the whole tree for it would mean the
 * import reports success and the tree then never runs, with nothing said. So the
 * bag is repaired once, at the boundary where untrusted JSON enters, and the
 * guard downstream stays strict about what it will walk.
 *
 * Only `variables` is repaired. A missing or unwalkable `nodes` array is not
 * defaulted to `[]` — that would turn a broken tree into a silently empty one.
 */
function withVariableBag(tree: unknown): unknown {
  if (!isPlainRecord(tree) || isPlainRecord(tree.variables)) return tree;
  return { ...tree, variables: {} };
}

/**
 * Look a tree up by id without walking the prototype chain, and answer only with
 * a tree that can actually be walked.
 *
 * A bare `dialogueTrees[id]` answers `Object.prototype` for the id `"__proto__"`
 * and a function for `"constructor"` — both truthy, so the `if (!tree) return`
 * that follows every one of these lookups passes an id naming no tree straight
 * through to `tree.nodes.find(...)`, which throws on `undefined`. The ids are
 * reachable: dialogue trees are LLM-authored (the chat handlers write model
 * output into this store verbatim) and can also arrive from localStorage or an
 * imported `.json` — which is the same reason the shape is checked below.
 */
export function getTree(
  trees: Record<string, DialogueTree>,
  treeId: string,
): DialogueTree | undefined {
  // The container is checked too. `loadFromLocalStorage` normalizes a non-record
  // blob away, but this function does not receive the store's map — it receives
  // whatever its caller passed, from eight call sites that read it through a
  // Zustand selector, and `Object.hasOwn(null, id)` throws rather than returning
  // false. A guard that crashes on the input it exists to reject is not a guard,
  // so the two checks are deliberately independent rather than one relying on
  // the other having run.
  if (!isPlainRecord(trees) || !Object.hasOwn(trees, treeId)) return undefined;
  const tree = trees[treeId];
  return isWalkableTree(tree) ? tree : undefined;
}

/**
 * The iteration counterpart of `getTree`.
 *
 * `getTree` guards a read by id; it says nothing about a read of the whole map,
 * and four call sites did exactly that — `Object.values(dialogueTrees)` and then
 * `tree.nodes`, `tree.id` or `tree.name`. Those bypass the guard entirely, so one
 * unwalkable entry throws out of a React render or, in the chat context builder,
 * silently deletes the entire Dialogue Trees section from what the model gets to see.
 *
 * A bad entry is skipped rather than repaired: an author with one corrupt tree
 * keeps every other tree in the panel.
 */
export function listTrees(trees: Record<string, DialogueTree>): DialogueTree[] {
  if (!isPlainRecord(trees)) return [];
  return Object.values(trees).filter(isWalkableTree);
}

/**
 * `getTree` vouches for the tree, not for what each node carries: a node is a
 * plain object, but `choices` on it is still whatever the JSON said. Every walk
 * over it goes through here so a `"choices": "nope"` node reads as a choice node
 * with nothing to choose instead of throwing `filter is not a function`.
 *
 * The parameter is deliberately NOT `ChoiceNode`. Typed as that, TypeScript
 * believes `node.choices` is already `DialogueChoice[]`, which makes the
 * `Array.isArray` below read as dead code and — worse — makes the helper
 * unusable at the seven sites outside this store that hold a node they got from
 * the same untrusted JSON. `unknown` is the honest type of a field that came
 * from a file.
 */
export function choicesOf(node: { choices?: unknown }): DialogueChoice[] {
  return Array.isArray(node.choices) ? node.choices : [];
}

/**
 * The same contract for the two other node payloads read outside this store.
 *
 * This is not a new rule — the store's own walk already refuses a non-array
 * `actions` (`executeActions`) and a non-record `condition` (`evaluateCondition`).
 * It is that rule made reusable, because the node inspector reads the identical
 * fields off the identical untrusted node and had no guard at all: it renders
 * `(malformed actions)` in the node's label, which invites the author to expand
 * exactly the node whose detail pane then threw on `.actions.length`. Throwing on
 * expand hides the only screen that could fix the tree.
 */
export function actionsOf(node: { actions?: unknown }): DialogueAction[] {
  return Array.isArray(node.actions) ? node.actions : [];
}

/**
 * `null` rather than a repaired object: a condition with no recognised `type`
 * evaluates as `false`, and inventing one here would let the editor write a shape
 * the walk still refuses while showing the author a filled-in form.
 *
 * Takes `object`, not the `{ condition?: unknown }` its two siblings take. That
 * shape is an all-optional weak type, and the one call site hands it a node that
 * has NOT been narrowed to `'condition'` yet — which is the whole point, since the
 * guard runs before the pane knows what it is looking at. `TextNode` shares no
 * property with a weak type, so TS rejects the call the guard exists to serve.
 */
export function conditionOf(node: object): Condition | null {
  const condition = (node as { condition?: unknown }).condition;
  return isPlainRecord(condition) ? (condition as unknown as Condition) : null;
}

/**
 * Variable names that must never be written through, because assigning them
 * mutates the object's shape rather than storing a value. `variables.__proto__ =
 * x` invokes the inherited setter and re-points the prototype, after which the
 * bag's inherited shape is whatever the tree author put there. The keys come from
 * `set_state` / `increment` actions, i.e. straight out of a generated tree.
 *
 * `constructor` and `prototype` are deliberately NOT here. On a plain object both
 * are ordinary writes that create an own property, and `readVariable` below reads
 * own properties only — so a variable named either one stores and reads back
 * exactly what the author wrote. Refusing them would make an ordinary name
 * silently unwritable, and (before `readVariable`) would have left an unset
 * `constructor` reading back as `Object`, which is strictly worse than storing it.
 */
const UNSAFE_VARIABLE_KEYS = new Set(['__proto__']);

/**
 * The key is typed `string`, but it is a value out of a parsed action, so its
 * runtime type is whatever the JSON said. That matters here and nowhere else in
 * this file, because a `Set<string>` compares by SameValueZero: `has(['__proto__'])`
 * is `false` for the one-element array, and the write below then runs
 * ToPropertyKey on it, which stringifies to exactly `"__proto__"` and invokes the
 * inherited setter the Set exists to stop. So the refusal is on the TYPE first —
 * a bigger Set could never close this, since every non-string spelling of the
 * same key is a different value.
 *
 * Refusing every non-string outright rather than coercing-then-checking is the
 * conservative half: a key that is not a string is not a name an author wrote,
 * so there is nothing to preserve by accepting it.
 */
function isUnsafeVariableKey(key: string): boolean {
  if (typeof key !== 'string') {
    console.warn(
      `[dialogue] refusing a variable name that is not a string (got ${typeof key})`,
    );
    return true;
  }
  if (!UNSAFE_VARIABLE_KEYS.has(key)) return false;
  console.warn(`[dialogue] refusing to write the reserved variable "${key}"`);
  return true;
}

/**
 * Read a variable the way an author means it: one that was never written is
 * unset, whatever it is called. A bare `variables[key]` walks the prototype
 * chain, so an unset variable named `toString` reads back as a function and one
 * named `constructor` as `Object` — and a condition on either then turns on a
 * name the author never set. Variable names come out of a generated tree, so
 * this is reachable without anyone choosing it deliberately.
 */
function readVariable(variables: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(variables, key) ? variables[key] : undefined;
}

/**
 * `and` / `or` over a nested condition list, written as indexed loops.
 *
 * `.every` and `.some` SKIP holes, so `[c1, , c2]` reported the whole AND-group
 * satisfied without the missing slot ever being evaluated — the fail-OPEN
 * direction for something whose only job is to gate. An indexed read is the only
 * form that sees every slot. Holes reach a condition list through `addNode` /
 * `updateNode`, which take a caller-built `ConditionNode`; `JSON.parse` cannot
 * produce a hole, but it readily produces a `null`, and `evaluateCondition`
 * dereferences its argument — which `evaluateCondition` now answers for itself,
 * so these loops no longer repeat the per-element check.
 *
 * The list itself is still checked here: an imported tree can carry
 * `"conditions": null` or omit the key, and reading `.length` off that throws
 * mid-playback — the same symptom, one level up, and one the head guard cannot
 * see. An unusable list is unsatisfied in both groups: it cannot open an `and`,
 * and it cannot satisfy an `or`.
 */
function allOf(
  conditions: Condition[],
  variables: Record<string, unknown>,
  depth: number
): boolean {
  if (!Array.isArray(conditions)) return false;
  for (let i = 0; i < conditions.length; i += 1) {
    if (!evaluateCondition(conditions[i], variables, depth)) return false;
  }
  return true;
}

function anyOf(
  conditions: Condition[],
  variables: Record<string, unknown>,
  depth: number
): boolean {
  if (!Array.isArray(conditions)) return false;
  for (let i = 0; i < conditions.length; i += 1) {
    if (evaluateCondition(conditions[i], variables, depth)) return true;
  }
  return false;
}

/**
 * Repair the members a corrupt file can carry, without inventing the structure
 * a tree is missing.
 *
 * The two ingest points meet two different kinds of damage, and they need
 * different answers. A `null` sitting in an otherwise-good `nodes` array, a
 * `choice` node with no `choices` key, an `action` node whose `actions` is
 * `null`, a `variables` bag that was never written: each is ONE member of a tree
 * whose shape is intact, and each is fatal to a reader that trusts the element
 * type it was declared — `tree.nodes.find(n => n.id === ...)` (five call sites),
 * `currentNode.choices.filter(c => c.condition)` and `for (const action of
 * actions)` all dereference with no guard. Refusing the whole tree over one of
 * them takes the author's content away to fix a member they could have been
 * shown instead, so those are repaired here and the author is told the count.
 *
 * A tree with no `nodes` array at all, or no `startNodeId`, or that is not an
 * object, is a different thing: there is nothing to repair without inventing it,
 * and defaulting `nodes` to `[]` would turn a broken tree into a silently empty
 * one that imports "successfully" and then never runs. Those are handed on
 * exactly as they arrived, so `isWalkableTree` refuses them and
 * `walkabilityComplaint` names what was missing.
 *
 * Repair therefore runs FIRST and the guard runs after it: the guard's verdict
 * is about the tree that would actually be stored, not about the bytes on disk.
 */
function repairIngestedTree(raw: unknown): unknown {
  const tree = withVariableBag(raw);
  if (!isPlainRecord(tree) || !Array.isArray(tree.nodes)) return tree;
  // `filter` drops holes as well as non-records — it is the one array method
  // whose hole-skipping is the behaviour wanted here.
  const nodes = tree.nodes.filter(isPlainRecord).map(repairNode);
  return { ...tree, nodes };
}

function repairNode(raw: Record<string, unknown>): Record<string, unknown> {
  const node = { ...raw };
  // A `choice` node with no `choices` key is as fatal as one with a null member:
  // `currentNode.choices.filter(...)` throws either way.
  if (node.type === 'choice') {
    node.choices = Array.isArray(node.choices) ? node.choices.filter(isPlainRecord) : [];
  }
  if (node.type === 'action') {
    node.actions = Array.isArray(node.actions) ? node.actions.filter(isPlainRecord) : [];
  }
  return node;
}

/**
 * How many `nodes` entries the repair above dropped, for the one message that
 * can report it.
 *
 * A node disappearing in silence is the same harm as a tree disappearing in
 * silence: the author's tree comes back one node short, and the editor's view of
 * it is identical to a tree that never had that node. Counting after the fact
 * keeps `repairIngestedTree` a pure function of its input.
 */
function droppedNodeCount(raw: unknown, repaired: unknown): number {
  if (!isPlainRecord(raw) || !Array.isArray(raw.nodes)) return 0;
  if (!isPlainRecord(repaired) || !Array.isArray(repaired.nodes)) return 0;
  return raw.nodes.length - repaired.nodes.length;
}

/**
 * An absent or unusable condition is unsatisfied.
 *
 * Every condition in the tree flows through here — a `condition` node's own
 * condition, a nested member of an `and`/`or` group, and a choice's `condition`
 * — so the guard belongs at this head rather than at each caller. It was at
 * three of the four call sites and not at the fourth (`case 'condition'`), which
 * is a shape that reads as covered in review: the guard is visible nearby, just
 * not on the path that throws.
 *
 * The declared `Condition` type is a promise the runtime does not keep.
 * `importTree` and `loadFromLocalStorage` both hand a raw `JSON.parse` result to
 * `set()`, and `repairIngestedTree` drops null NODES without descending into a
 * node's condition — so `null`, a missing key, and a hand-edited `"gold > 5"` all
 * arrive here. `null.type` throws mid-playback; the string does not, but it is
 * no more satisfiable, and both answer the same way.
 */
function evaluateCondition(
  condition: Condition | null | undefined,
  variables: Record<string, unknown>,
  depth = 0
): boolean {
  if (!isPlainRecord(condition)) return false;
  if (depth > MAX_CONDITION_DEPTH) {
    console.warn('[dialogue] condition nesting exceeded the depth limit — treating as false');
    return false;
  }
  // `condition` is whatever the tree's JSON put there. The `and`/`or` arms below
  // check that `conditions` is an array but cannot vouch for its elements, so
  // `{ type: 'and', conditions: [null] }` clears that check and arrives here.
  if (!isPlainRecord(condition)) return false;
  switch (condition.type) {
    case 'equals':
      return readVariable(variables, condition.variable) === condition.value;
    case 'not_equals':
      return readVariable(variables, condition.variable) !== condition.value;
    case 'greater':
      return typeof readVariable(variables, condition.variable) === 'number' &&
             readVariable(variables, condition.variable) as number > condition.value;
    case 'less':
      return typeof readVariable(variables, condition.variable) === 'number' &&
             readVariable(variables, condition.variable) as number < condition.value;
    case 'has_item': {
      const items = readVariable(variables, 'items');
      return Array.isArray(items) && items.includes(condition.itemId);
    }
    case 'and':
      if (depth >= MAX_CONDITION_DEPTH) return false;
      return allOf(condition.conditions, variables, depth + 1);
    case 'or':
      if (depth >= MAX_CONDITION_DEPTH) return false;
      return anyOf(condition.conditions, variables, depth + 1);
    default:
      // Also the over-depth answer, and for the same reason: a condition this
      // runtime cannot evaluate is not a condition it should treat as met.
      // Unsatisfied is the safe reading — it routes to `onFalse` and hides a
      // gated choice rather than opening one the author meant to keep shut.
      return false;
  }
}

function executeActions(actions: DialogueAction[], variables: Record<string, unknown>): void {
  // A non-array `actions` is not merely skipped work: `for…of` over a number
  // throws, and over a string it silently iterates characters.
  if (!Array.isArray(actions)) return;
  for (const action of actions) {
    if (!isPlainRecord(action)) continue;
    switch (action.type) {
      case 'set_state':
        if (isUnsafeVariableKey(action.key)) break;
        variables[action.key] = action.value;
        break;
      case 'add_item': {
        // `readVariable`, not `variables.items`: an inherited `items` array would
        // otherwise be pushed into, mutating state shared with every other bag.
        if (!Array.isArray(readVariable(variables, 'items'))) {
          variables.items = [];
        }
        const items = variables.items as unknown[];
        if (!items.includes(action.itemId)) {
          items.push(action.itemId);
        }
        break;
      }
      case 'remove_item': {
        if (Array.isArray(readVariable(variables, 'items'))) {
          const items = variables.items as unknown[];
          const idx = items.indexOf(action.itemId);
          if (idx !== -1) {
            items.splice(idx, 1);
          }
        }
        break;
      }
      case 'increment': {
        if (isUnsafeVariableKey(action.key)) break;
        const current = readVariable(variables, action.key);
        if (typeof current === 'number') {
          variables[action.key] = current + action.amount;
        } else {
          variables[action.key] = action.amount;
        }
        break;
      }
      case 'trigger_event':
        // Event triggering would be handled by external system
        // For now, just store the event name
        if (!Array.isArray(readVariable(variables, '_triggeredEvents'))) {
          variables._triggeredEvents = [];
        }
        (variables._triggeredEvents as string[]).push(action.eventName);
        break;
    }
  }
}

// ============================================================================
// Store
// ============================================================================

export const useDialogueStore = create<DialogueStore>((set, get) => ({
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

  // Tree CRUD
  addTree: (name: string, startNodeText?: string) => {
    const treeId = generateId('tree');
    const startNodeId = generateId('node');

    const startNode: TextNode = {
      id: startNodeId,
      type: 'text',
      speaker: 'Narrator',
      text: startNodeText || 'Welcome to the dialogue.',
      next: null,
      position: { x: 100, y: 100 },
    };

    const tree: DialogueTree = {
      id: treeId,
      name,
      nodes: [startNode],
      startNodeId,
      variables: {},
    };

    set(state => ({
      dialogueTrees: { ...state.dialogueTrees, [treeId]: tree },
    }));

    get().saveToLocalStorage();
    return treeId;
  },

  removeTree: (treeId: string) => {
    set(state => {
      const newTrees = { ...state.dialogueTrees };
      delete newTrees[treeId];
      return {
        dialogueTrees: newTrees,
        selectedTreeId: state.selectedTreeId === treeId ? null : state.selectedTreeId,
      };
    });
    get().saveToLocalStorage();
  },

  updateTree: (treeId: string, updates: Partial<Pick<DialogueTree, 'name' | 'variables'>>) => {
    set(state => {
      const tree = getTree(state.dialogueTrees, treeId);
      if (!tree) return state;

      const updated = { ...tree, ...updates };
      // `importTree` and `loadFromLocalStorage` now refuse an unwalkable tree,
      // which leaves this as the last way one could still enter the map. The
      // parameter is typed, but the chat handlers fill it from model output, and
      // a `variables` that is not a record makes the tree unreadable by every
      // guard downstream — stored, saved, and then silently dropped on the next
      // load, taking the author's other edits to that tree with it.
      if (!isWalkableTree(updated)) {
        console.warn(
          `[dialogue] refusing an update to tree "${treeId}" that would leave it unwalkable: `
          + `${walkabilityComplaint(updated)}`,
        );
        return state;
      }

      return {
        dialogueTrees: { ...state.dialogueTrees, [treeId]: updated },
      };
    });
    get().saveToLocalStorage();
  },

  duplicateTree: (treeId: string) => {
    const tree = getTree(get().dialogueTrees, treeId);
    if (!tree) return null;

    const newTreeId = generateId('tree');
    const idMap = new Map<string, string>();

    // Generate new IDs for all nodes
    tree.nodes.forEach(node => {
      idMap.set(node.id, generateId('node'));
    });

    // Clone nodes with new IDs and updated references
    const newNodes = tree.nodes.map(node => {
      const newId = idMap.get(node.id)!;
      const baseNode = { ...node, id: newId };

      switch (node.type) {
        case 'text':
          return { ...baseNode, next: node.next ? idMap.get(node.next) ?? null : null };
        case 'choice':
          return {
            ...baseNode,
            choices: choicesOf(node).map(c => ({
              ...c,
              nextNodeId: c.nextNodeId ? idMap.get(c.nextNodeId) ?? null : null,
            })),
          };
        case 'condition':
          return {
            ...baseNode,
            onTrue: node.onTrue ? idMap.get(node.onTrue) ?? null : null,
            onFalse: node.onFalse ? idMap.get(node.onFalse) ?? null : null,
          };
        case 'action':
          return { ...baseNode, next: node.next ? idMap.get(node.next) ?? null : null };
        case 'end':
          return baseNode;
        default:
          return baseNode;
      }
    });

    const newTree: DialogueTree = {
      id: newTreeId,
      name: `${tree.name} (Copy)`,
      nodes: newNodes as DialogueNode[],
      startNodeId: idMap.get(tree.startNodeId)!,
      variables: { ...tree.variables },
    };

    set(state => ({
      dialogueTrees: { ...state.dialogueTrees, [newTreeId]: newTree },
    }));

    get().saveToLocalStorage();
    return newTreeId;
  },

  // Node CRUD
  addNode: (treeId: string, node: DialogueNode) => {
    set(state => {
      const tree = getTree(state.dialogueTrees, treeId);
      if (!tree) return state;

      return {
        dialogueTrees: {
          ...state.dialogueTrees,
          [treeId]: {
            ...tree,
            nodes: [...tree.nodes, node],
          },
        },
      };
    });
    get().saveToLocalStorage();
  },

  updateNode: (treeId: string, nodeId: string, updates: Partial<DialogueNode>) => {
    set(state => {
      const tree = getTree(state.dialogueTrees, treeId);
      if (!tree) return state;

      const nodeIndex = tree.nodes.findIndex(n => n.id === nodeId);
      if (nodeIndex === -1) return state;

      const newNodes = [...tree.nodes];
      newNodes[nodeIndex] = { ...newNodes[nodeIndex], ...updates } as DialogueNode;

      return {
        dialogueTrees: {
          ...state.dialogueTrees,
          [treeId]: { ...tree, nodes: newNodes },
        },
      };
    });
    get().saveToLocalStorage();
  },

  removeNode: (treeId: string, nodeId: string) => {
    set(state => {
      const tree = getTree(state.dialogueTrees, treeId);
      if (!tree) return state;
      if (nodeId === tree.startNodeId) return state; // Can't delete start node

      // Remove the node
      const newNodes = tree.nodes.filter(n => n.id !== nodeId);

      // Clean up references to this node
      const cleanedNodes = newNodes.map(node => {
        switch (node.type) {
          case 'text':
            return node.next === nodeId ? { ...node, next: null } : node;
          case 'choice':
            return {
              ...node,
              choices: choicesOf(node).map(c =>
                c.nextNodeId === nodeId ? { ...c, nextNodeId: null } : c
              ),
            };
          case 'condition':
            return {
              ...node,
              onTrue: node.onTrue === nodeId ? null : node.onTrue,
              onFalse: node.onFalse === nodeId ? null : node.onFalse,
            };
          case 'action':
            return node.next === nodeId ? { ...node, next: null } : node;
          default:
            return node;
        }
      });

      return {
        dialogueTrees: {
          ...state.dialogueTrees,
          [treeId]: { ...tree, nodes: cleanedNodes },
        },
        selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      };
    });
    get().saveToLocalStorage();
  },

  // Runtime actions
  startDialogue: (treeId: string) => {
    const tree = getTree(get().dialogueTrees, treeId);
    if (!tree) return;

    const startNode = tree.nodes.find(n => n.id === tree.startNodeId);
    if (!startNode) return;

    set({
      runtime: {
        activeTreeId: treeId,
        currentNodeId: tree.startNodeId,
        isActive: true,
        displayedText: '',
        typewriterComplete: false,
        currentChoices: [],
        history: [],
      },
    });

    // Process the start node
    get().processCurrentNode();
  },

  advanceDialogue: () => {
    const { runtime, dialogueTrees } = get();
    if (!runtime.activeTreeId || !runtime.currentNodeId) return;

    const tree = getTree(dialogueTrees, runtime.activeTreeId);
    if (!tree) return;

    const currentNode = tree.nodes.find(n => n.id === runtime.currentNodeId);
    if (!currentNode) return;

    if (currentNode.type === 'text') {
      if (currentNode.next) {
        set(state => ({
          runtime: {
            ...state.runtime,
            currentNodeId: currentNode.next,
            displayedText: '',
            typewriterComplete: false,
          },
        }));
        get().processCurrentNode();
      } else {
        get().endDialogue();
      }
    } else if (currentNode.type === 'end') {
      get().endDialogue();
    }
  },

  selectChoice: (choiceId: string) => {
    const { runtime, dialogueTrees } = get();
    if (!runtime.activeTreeId || !runtime.currentNodeId) return;

    const tree = getTree(dialogueTrees, runtime.activeTreeId);
    if (!tree) return;

    const currentNode = tree.nodes.find(n => n.id === runtime.currentNodeId);
    if (!currentNode || currentNode.type !== 'choice') return;

    const choice = choicesOf(currentNode).find(c => c.id === choiceId);
    if (!choice || !choice.nextNodeId) return;

    set(state => ({
      runtime: {
        ...state.runtime,
        currentNodeId: choice.nextNodeId,
        displayedText: '',
        typewriterComplete: false,
        currentChoices: [],
      },
    }));

    get().processCurrentNode();
  },

  skipTypewriter: () => {
    const { runtime, dialogueTrees } = get();
    if (!runtime.activeTreeId || !runtime.currentNodeId) return;

    const tree = getTree(dialogueTrees, runtime.activeTreeId);
    if (!tree) return;

    const currentNode = tree.nodes.find(n => n.id === runtime.currentNodeId);
    if (!currentNode || currentNode.type !== 'text') return;

    set(state => ({
      runtime: {
        ...state.runtime,
        displayedText: currentNode.text,
        typewriterComplete: true,
      },
    }));
  },

  endDialogue: () => {
    set({
      runtime: {
        activeTreeId: null,
        currentNodeId: null,
        isActive: false,
        displayedText: '',
        typewriterComplete: false,
        currentChoices: [],
        history: [],
      },
    });
  },

  // Editor
  selectTree: (treeId: string | null) => {
    set({ selectedTreeId: treeId, selectedNodeId: null });
  },

  selectNode: (nodeId: string | null) => {
    set({ selectedNodeId: nodeId });
  },

  // Persistence
  loadFromLocalStorage: () => {
    try {
      const data = localStorage.getItem(DIALOGUE_STORAGE_KEY);
      if (data) {
        const parsed: unknown = JSON.parse(data);
        // A tree imported before `withVariableBag` existed was persisted without
        // its bag, so the repair has to run on load too or that tree stays
        // unusable forever.
        //
        // Repair first, then DROP what is still unwalkable. Keeping it was the
        // worse of the two options in both directions: `{"a": null}` in storage
        // put `null` in the map, and every whole-map read then threw during
        // render. Dropping one entry costs that tree; keeping it cost the panel.
        // The dropped ids are named because a tree vanishing silently is not
        // something an author can act on.
        //
        // A container that is not a record is replaced with an empty one rather
        // than assigned through. `JSON.parse('null')` is `null`, and `null` in this
        // field is not merely unwalkable — `Object.keys(null)` throws, and
        // `gameReviewer` calls exactly that to decide whether the game has
        // dialogue. There is nothing in a non-record container to preserve.
        const kept: Record<string, DialogueTree> = {};
        const dropped: string[] = [];
        let droppedNodes = 0;
        if (isPlainRecord(parsed)) {
          for (const [id, tree] of Object.entries(parsed)) {
            const repaired = repairIngestedTree(tree);
            if (isWalkableTree(repaired)) {
              kept[id] = repaired;
              droppedNodes += droppedNodeCount(tree, repaired);
            } else {
              dropped.push(id);
            }
          }
        } else {
          console.warn(
            `[dialogue] stored dialogue trees are not an object (got ${parsed === null ? 'null' : typeof parsed}); starting empty`,
          );
        }
        if (dropped.length > 0) {
          console.warn(
            `[dialogue] dropped ${dropped.length} stored tree(s) that cannot be walked: ${dropped.join(', ')}`,
          );
          // Dropping is right; dropping in silence is not. The author's trees
          // reappear one short with no explanation, and the editor's empty state
          // reads identically whether a tree was never created or was removed
          // here — so the one moment the loss is known is the only place it can
          // be reported.
          showError(
            `${dropped.length} saved dialogue tree(s) could not be loaded and were removed: `
            + `${dropped.join(', ')}.`,
          );
        }
        if (droppedNodes > 0) {
          // Not a `showError`: the tree still loads and still plays, so this is a
          // note for whoever is looking at the console over a corrupt file, not an
          // interruption for an author who has lost nothing they can see.
          console.warn(
            `[dialogue] dropped ${droppedNodes} stored node(s) that were not objects`,
          );
        }
        set({ dialogueTrees: kept });

        // Dropping the tree a dialogue is *currently running* leaves the runtime
        // pointed at something no longer in the map: `isActive` stays true, the
        // overlay keeps rendering, and every lookup inside it returns nothing —
        // an empty dialogue box that reads as a hang rather than as an ending.
        // Dropping the tree is right; leaving the runtime aimed at it is not.
        const { activeTreeId, isActive } = get().runtime;
        if (isActive && activeTreeId !== null && !Object.hasOwn(kept, activeTreeId)) {
          console.warn(
            `[dialogue] the running dialogue's tree "${activeTreeId}" was dropped on load — ending it`,
          );
          showError('The running conversation could not be loaded and has ended.');
          get().endDialogue();
        }
      }
    } catch (error) {
      console.error('Failed to load dialogue trees:', error);
    }
  },

  saveToLocalStorage: () => {
    try {
      const { dialogueTrees } = get();
      localStorage.setItem(DIALOGUE_STORAGE_KEY, JSON.stringify(dialogueTrees));
    } catch (error) {
      console.error('Failed to save dialogue trees:', error);
    }
  },

  // Import/Export
  exportTree: (treeId: string) => {
    const tree = getTree(get().dialogueTrees, treeId);
    if (!tree) return null;

    try {
      return JSON.stringify(tree, null, 2);
    } catch (error) {
      console.error('Failed to export tree:', error);
      return null;
    }
  },

  importTree: (jsonData: string) => {
    try {
      const raw: unknown = JSON.parse(jsonData);
      const parsed = repairIngestedTree(raw);

      // Refuse rather than store what the repair could not make walkable. An
      // import that returns a treeId for a tree `getTree` will then refuse
      // forever is the same "reports success, never runs" harm the variable-bag
      // repair exists to prevent — reproduced for `nodes`. Both callers already
      // handle `null` by telling the author the import failed, which is the
      // outcome they need.
      if (!isWalkableTree(parsed)) {
        console.error(
          `[dialogue] refusing to import a tree that cannot be walked: ${walkabilityComplaint(parsed)}`,
        );
        return null;
      }
      const droppedNodes = droppedNodeCount(raw, parsed);
      if (droppedNodes > 0) {
        console.warn(
          `[dialogue] dropped ${droppedNodes} imported node(s) that were not objects`,
        );
      }
      const tree = parsed;
      const newTreeId = generateId('tree');

      const newTree: DialogueTree = {
        ...tree,
        id: newTreeId,
        name: `${tree.name ?? 'Untitled'} (Imported)`,
      };

      set(state => ({
        dialogueTrees: { ...state.dialogueTrees, [newTreeId]: newTree },
      }));

      get().saveToLocalStorage();
      return newTreeId;
    } catch (error) {
      console.error('Failed to import tree:', error);
      return null;
    }
  },

  // Internal helper to process current node
  processCurrentNode: () => {
    // `condition` and `action` nodes route straight on to another node without
    // waiting for the player, so a tree that cycles through only those two
    // types never yields. This used to recurse, which meant such a cycle blew
    // the JS stack with a RangeError and took the whole play session with it —
    // and nothing upstream guarantees a tree is acyclic: they are authored by
    // the AI (`dialogueHandlers.ts`), imported from arbitrary JSON without
    // validation (`importTree`), or converted from Twine, Yarn and Ink, where
    // a "go back" link is ordinary authoring. Walk iteratively under a hop cap
    // instead.
    //
    // A hop cap rather than a visited-node set: `executeActions` mutates
    // `tree.variables` in place and `evaluateCondition` reads that same
    // object, so "increment a counter, loop back, stop once it reaches three"
    // is a legitimate authored pattern that terminates on its own. A
    // visited-set would refuse it the second time through.
    for (let hops = 0; hops < MAX_DIALOGUE_HOPS; hops++) {
      const { runtime, dialogueTrees } = get();

      if (!runtime.activeTreeId || !runtime.currentNodeId) return;

      const tree = getTree(dialogueTrees, runtime.activeTreeId);
      if (!tree) return;

      const currentNode = tree.nodes.find(n => n.id === runtime.currentNodeId);
      if (!currentNode) {
        // A `next`/`onTrue`/`onFalse`/`nextNodeId` naming a node that is not in
        // the tree — trivially producible by `importTree`, or by deleting a
        // node another one still points at. Returning here would leave the
        // dialogue active on a node that can never render: the overlay paints
        // an empty box with no text, no choices and no way on but Esc. That is
        // the same stuck state the `default` arm below exists to avoid, so it
        // gets the same treatment.
        console.error(
          'Dialogue routed to a node that is not in the tree; ending dialogue:',
          runtime.currentNodeId
        );
        get().endDialogue();
        return;
      }

      // Captured while the node is still the full union — inside `default` it
      // narrows to `never`, and reading through a cast there is how a guard for
      // malformed data ends up unable to name the malformed data.
      const { id: nodeId, type: nodeType } = currentNode;

      switch (currentNode.type) {
        case 'text': {
          // Add to history and set displayed text
          set(state => ({
            runtime: {
              ...state.runtime,
              displayedText: currentNode.text,
              typewriterComplete: true,
              history: [
                ...state.runtime.history,
                { speaker: currentNode.speaker, text: currentNode.text },
              ],
            },
          }));
          return;
        }

        case 'choice': {
          // Filter choices by condition
          const availableChoices = choicesOf(currentNode).filter(c => {
            if (!c.condition) return true;
            return evaluateCondition(c.condition, tree.variables);
          });

          set(state => ({
            runtime: {
              ...state.runtime,
              currentChoices: availableChoices,
            },
          }));
          return;
        }

        case 'condition': {
          // Evaluate and route
          const result = evaluateCondition(currentNode.condition, tree.variables);
          const nextNodeId = result ? currentNode.onTrue : currentNode.onFalse;

          if (!nextNodeId) {
            get().endDialogue();
            return;
          }
          set(state => ({
            runtime: {
              ...state.runtime,
              currentNodeId: nextNodeId,
            },
          }));
          continue;
        }

        case 'action': {
          // Execute actions and route
          executeActions(currentNode.actions, tree.variables);

          if (!currentNode.next) {
            get().endDialogue();
            return;
          }
          set(state => ({
            runtime: {
              ...state.runtime,
              currentNodeId: currentNode.next,
            },
          }));
          continue;
        }

        case 'end': {
          get().endDialogue();
          return;
        }

        default: {
          // Nothing validates `node.type` at write time — `importTree` and
          // `loadFromLocalStorage` both cast arbitrary JSON, and the chat
          // handlers write model output verbatim. Without this arm an unknown
          // type matches no case, leaves `currentNodeId` untouched, and the loop
          // re-enters with byte-identical state: a synchronous spin that wedges
          // the tab with no error and no Sentry event. `MAX_DIALOGUE_HOPS` bounds
          // it regardless; this ends it at the node that caused it, and says so.
          console.error(
            'Dialogue node has an unrecognized type; ending dialogue:',
            nodeType,
          );
          // The console line above is for Sentry; this one is for the author,
          // who is playtesting in the editor and not watching a devtools tab.
          // It names the node as well as the type — the console line cannot,
          // because it is the pair Sentry groups on.
          showError(
            `Dialogue stopped: node "${nodeId}" has an unrecognised type `
            + `"${String(nodeType)}".`,
          );
          get().endDialogue();
          return;
        }
      }
    }

    // The cap is a backstop for a cycle that never resolves, not a limit any
    // real conversation should approach. End the dialogue rather than leave
    // the player stuck on a node that will never render.
    console.error(
      `Dialogue exceeded ${MAX_DIALOGUE_HOPS} node transitions without reaching ` +
        'text, a choice, or an end — the tree most likely contains a cycle of ' +
        'condition/action nodes. Ending dialogue.'
    );
    // Console is not a channel an author playtesting in the editor watches.
    // `useScriptRunner` already toasts the sibling failure — a script that would
    // not terminate — and this is the same shape: a runtime hazard we detected
    // and gave up on. A dialogue that closes itself with nothing said is
    // indistinguishable from one that ended normally.
    showError(
      `Dialogue stopped: node "${get().runtime.currentNodeId}" never reaches anything `
      + 'to show. Check for a condition or action loop.',
    );
    get().endDialogue();
  },
}));

