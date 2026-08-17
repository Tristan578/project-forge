/**
 * Tests for DialogueTreeEditor — tree selection, creation, deletion,
 * node rendering, node expansion, add node menu.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { DialogueTreeEditor } from '../DialogueTreeEditor';
import { useDialogueStore } from '@/stores/dialogueStore';

// The real `getTree` — it is the prototype-chain guard itself, so stubbing it
// here would let the mock drift from the guard under test.
// The guards come from the REAL module, never hand-stubbed: `getTree`, `listTrees`
// and `choicesOf` ARE the boundary this panel relies on, so a local stub would let
// the mock drift and these tests would keep passing against a store that lost one.
vi.mock('@/stores/dialogueStore', async () => {
  const actual = await vi.importActual<typeof import('@/stores/dialogueStore')>(
    '@/stores/dialogueStore',
  );
  return {
    getTree: actual.getTree,
    listTrees: actual.listTrees,
    choicesOf: actual.choicesOf,
    actionsOf: actual.actionsOf,
    conditionOf: actual.conditionOf,
    useDialogueStore: vi.fn(() => ({})),
  };
});

const mockSelectTree = vi.fn();
const mockAddTree = vi.fn(() => 'tree-new');
const mockRemoveTree = vi.fn();
const mockDuplicateTree = vi.fn();
const mockUpdateTree = vi.fn();
const mockUpdateNode = vi.fn();
const mockRemoveNode = vi.fn();
const mockAddNode = vi.fn();
const mockSelectNode = vi.fn();
const mockLoadFromLocalStorage = vi.fn();

const textNode = { id: 'node-1', type: 'text' as const, speaker: 'NPC', text: 'Hello traveler, welcome to the village.', next: null };
const choiceNode = { id: 'node-2', type: 'choice' as const, choices: [{ id: 'ch-1', text: 'Accept', nextNodeId: null }, { id: 'ch-2', text: 'Decline', nextNodeId: null }] };
const endNode = { id: 'node-3', type: 'end' as const };

// `variables` is required by `DialogueTree`, and `getTree` refuses a tree that
// has no state bag — a condition or action node would read through it and throw.
// Omitting it here would not make a smaller fixture, it would make one the
// editor declines to render, failing every assertion for the wrong reason.
const mockTree = {
  id: 'tree-1',
  name: 'Main Quest',
  startNodeId: 'node-1',
  nodes: [textNode, choiceNode, endNode],
  variables: {},
};

function setupStore(overrides: {
  selectedTreeId?: string | null;
  selectedNodeId?: string | null;
  dialogueTrees?: Record<string, typeof mockTree>;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useDialogueStore).mockImplementation((selector: any) => {
    const state = {
      dialogueTrees: overrides.dialogueTrees ?? { 'tree-1': mockTree },
      // `in`, not `??`: `null` is the value that MEANS "no tree is selected", and
      // `?? 'tree-1'` swallowed it, so every caller passing it explicitly got the
      // default instead. That was invisible while "nothing selected" and "selected
      // but unreadable" shared one placeholder — the moment they diverged, the
      // no-selection test started asserting against the unreadable state.
      selectedTreeId: 'selectedTreeId' in overrides ? overrides.selectedTreeId : 'tree-1',
      selectedNodeId: overrides.selectedNodeId ?? null,
      selectTree: mockSelectTree,
      addTree: mockAddTree,
      removeTree: mockRemoveTree,
      duplicateTree: mockDuplicateTree,
      updateTree: mockUpdateTree,
      updateNode: mockUpdateNode,
      removeNode: mockRemoveNode,
      addNode: mockAddNode,
      selectNode: mockSelectNode,
      loadFromLocalStorage: mockLoadFromLocalStorage,
    };
    return selector(state);
  });
}

describe('DialogueTreeEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Basic rendering ───────────────────────────────────────────────────

  it('renders Dialogue Editor header', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(screen.getByText('Dialogue Editor')).toBeInTheDocument();
  });

  it('calls loadFromLocalStorage on mount', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(mockLoadFromLocalStorage).toHaveBeenCalled();
  });

  // ── No tree selected ──────────────────────────────────────────────────

  it('shows empty state when no tree selected', () => {
    setupStore({ selectedTreeId: null, dialogueTrees: {} });
    render(<DialogueTreeEditor />);
    expect(screen.getByText(/Select or create/)).toBeInTheDocument();
  });

  it('does not crash when the selected id names an inherited property', () => {
    // `selectedTreeId` is persisted, so it survives a reload that removed the tree
    // it named, and a generated tree can be stored under any key at all.
    // `dialogueTrees['constructor']` is a function — truthy, so the bare lookup
    // reached `tree.nodes.map(...)` and took down the editor panel. `getTree` gates
    // on `Object.hasOwn`, so the panel renders a placeholder instead.
    setupStore({ selectedTreeId: 'constructor', dialogueTrees: {} });
    expect(() => render(<DialogueTreeEditor />)).not.toThrow();
    expect(screen.getByText(/can't be opened/i)).toBeInTheDocument();
  });

  it('distinguishes a tree that will not open from no tree being selected', () => {
    // Two different states were sharing one placeholder, and the shared one was
    // wrong for both: an author who has just picked a tree from the selector was
    // told to select a tree. The selector lists only walkable trees, so reaching
    // this at all means the tree was refused or removed after it was picked, and
    // the panel has to say which of those it is.
    setupStore({ selectedTreeId: 'constructor', dialogueTrees: {} });
    render(<DialogueTreeEditor />);

    expect(screen.queryByText(/Select or create/)).toBeNull();
  });

  // ── Tree selector ─────────────────────────────────────────────────────

  it('lists the walkable trees and survives an unwalkable sibling', () => {
    // The selector renders one `<option>` per stored tree, reading `t.id` and
    // `t.name` off values that came from persisted JSON. A bare `Object.values`
    // throws on a `null` entry, and that throw takes down the very selector the
    // author would use to switch away from the broken tree. `listTrees` skips it,
    // so the good tree stays selectable.
    setupStore({
      dialogueTrees: {
        broken: null,
        'tree-1': mockTree,
      } as unknown as Record<string, typeof mockTree>,
    });
    expect(() => render(<DialogueTreeEditor />)).not.toThrow();

    const options = document.querySelectorAll('select option');
    expect(Array.from(options).map((o) => o.textContent)).toEqual([
      '-- Select Tree --',
      'Main Quest',
    ]);
  });

  it('renders tree selector dropdown', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    const select = document.querySelector('select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('tree-1');
  });

  it('shows tree name in dropdown', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(screen.getByText('Main Quest')).toBeInTheDocument();
  });

  it('selects tree on dropdown change', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    const select = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '' } });
    expect(mockSelectTree).toHaveBeenCalledWith(null);
  });

  it('creates new tree on + button click', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    fireEvent.click(screen.getByTitle('New Tree'));
    expect(mockAddTree).toHaveBeenCalledWith('New Dialogue');
    expect(mockSelectTree).toHaveBeenCalledWith('tree-new');
  });

  it('deletes tree on delete button click', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    fireEvent.click(screen.getByTitle('Delete Tree'));
    expect(mockRemoveTree).toHaveBeenCalledWith('tree-1');
    expect(mockSelectTree).toHaveBeenCalledWith(null);
  });

  it('duplicates tree on duplicate button click', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    fireEvent.click(screen.getByTitle('Duplicate'));
    expect(mockDuplicateTree).toHaveBeenCalledWith('tree-1');
  });

  // ── Tree name editor ──────────────────────────────────────────────────

  it('renders tree name input', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(screen.getByText('Tree Name')).toBeInTheDocument();
    const nameInputs = screen.getAllByDisplayValue('Main Quest');
    // One in select, one in text input
    expect(nameInputs.length).toBeGreaterThanOrEqual(1);
  });

  it('updates tree name on input change', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    // The text input is the one with type="text" (not the select)
    const textInput = document.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(textInput, { target: { value: 'Side Quest' } });
    expect(mockUpdateTree).toHaveBeenCalledWith('tree-1', { name: 'Side Quest' });
  });

  // ── Node list ─────────────────────────────────────────────────────────

  it('shows node count and start node', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(screen.getByText(/3 nodes/)).toBeInTheDocument();
  });

  it('renders text node with label', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    // Label wraps text in quotes
    expect(screen.getByText(/Hello traveler, welcome to the village/)).toBeInTheDocument();
  });

  it('renders choice node with choice count', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(screen.getByText('2 choices')).toBeInTheDocument();
  });

  it('renders end node', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(screen.getByText('End')).toBeInTheDocument();
  });

  it('shows START badge on start node', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(screen.getByText('START')).toBeInTheDocument();
  });

  it('selects node on click', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    fireEvent.click(screen.getByText(/Hello traveler, welcome to the village/));
    expect(mockSelectNode).toHaveBeenCalledWith('node-1');
  });

  it('removes node on delete button', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    // Each node has a delete button (Trash2 icon)
    const deleteButtons = document.querySelectorAll('[class*="hover\\:text-red-400"]');
    // First delete button is for the first node
    fireEvent.click(deleteButtons[0]);
    expect(mockRemoveNode).toHaveBeenCalledWith('tree-1', 'node-1');
  });

  // ── Malformed node payloads ───────────────────────────────────────────

  describe('a node whose payload is not what its type says', () => {
    /**
     * `getTree` vouches that a node is an object. It deliberately does NOT check
     * each node's type-specific payload — refusing a whole tree because one node
     * is malformed would take away the author's only view of the node they need
     * to fix.
     *
     * Which puts the weight here. The node's LABEL already renders
     * `(malformed actions)`, i.e. this panel invites the author to open exactly
     * the node whose detail pane then read `.actions.length` on a string. A
     * label that reports a problem and a pane that throws on it is worse than
     * either alone: it advertises the repair and then removes the screen.
     */
    const hostileTree = {
      id: 'tree-1',
      name: 'Hostile',
      startNodeId: 'bad-action',
      variables: {},
      nodes: [
        { id: 'bad-action', type: 'action', actions: 'not-an-array', next: null },
        { id: 'bad-cond', type: 'condition', condition: 'nope', onTrue: null, onFalse: null },
        { id: 'bad-text', type: 'text', speaker: 'NPC', text: { oops: true }, next: null },
      ],
    } as unknown as typeof mockTree;

    /** Nodes render collapsed; the detail pane is behind the chevron. */
    function expandNode(label: string | RegExp) {
      const header = screen.getByText(label).parentElement;
      fireEvent.click(header!.querySelector('button')!);
    }

    it('an action node whose actions are a string expands instead of throwing', () => {
      setupStore({ dialogueTrees: { 'tree-1': hostileTree } });
      render(<DialogueTreeEditor />);

      expect(() => expandNode('(malformed actions)')).not.toThrow();
      // Not "0 actions" as a lie about the data — the label above it already says
      // the field is malformed. This is the count of actions that will run.
      expect(screen.getByText('0 actions configured')).toBeInTheDocument();
    });

    it('a condition node whose condition is a string says so instead of throwing', () => {
      setupStore({ dialogueTrees: { 'tree-1': hostileTree } });
      render(<DialogueTreeEditor />);

      expect(() => expandNode('Condition')).not.toThrow();
      expect(screen.getByText(/condition is malformed/)).toBeInTheDocument();
      // The Variable field is withheld rather than shown empty: typing into it
      // would write a `variable` onto a shape the walk still refuses, so the
      // author would "fix" the node and see no change.
      expect(screen.queryByText('Variable')).not.toBeInTheDocument();
    });

    it('a well-formed condition node still gets its editable Variable field', () => {
      // Without this, withholding the field from EVERY condition node passes the
      // test above.
      const goodTree = {
        ...hostileTree,
        nodes: [{
          id: 'cond',
          type: 'condition',
          condition: { type: 'equals', variable: 'gold', value: 1 },
          onTrue: null,
          onFalse: null,
        }],
      } as unknown as typeof mockTree;
      setupStore({ dialogueTrees: { 'tree-1': goodTree } });
      render(<DialogueTreeEditor />);

      expandNode('Condition');

      expect(screen.getByText('Variable')).toBeInTheDocument();
      expect(screen.getByDisplayValue('gold')).toBeInTheDocument();
      expect(screen.queryByText(/condition is malformed/)).not.toBeInTheDocument();
    });

    it('a text node whose text is not a string gets an empty, editable field', () => {
      // React renders a non-string `value` as `[object Object]` — the author's own
      // copy, apparently — or drops the field to uncontrolled on `null`. An empty
      // box the next keystroke repairs is the honest state.
      setupStore({ dialogueTrees: { 'tree-1': hostileTree } });
      render(<DialogueTreeEditor />);

      expandNode('(malformed text)');

      const textarea = document.querySelector('textarea');
      expect(textarea).not.toBeNull();
      expect(textarea!.value).toBe('');
      fireEvent.change(textarea!, { target: { value: 'Repaired' } });
      expect(mockUpdateNode).toHaveBeenCalledWith('tree-1', 'bad-text', { text: 'Repaired' });
    });
  });

  // ── Add node menu ─────────────────────────────────────────────────────

  it('renders Add Node button', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(screen.getByText('Add Node')).toBeInTheDocument();
  });

  it('opens add node menu on click', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    fireEvent.click(screen.getByText('Add Node'));
    // CSS capitalize means DOM text is lowercase + " Node"
    expect(screen.getByText('text Node')).toBeInTheDocument();
    expect(screen.getByText('choice Node')).toBeInTheDocument();
    expect(screen.getByText('condition Node')).toBeInTheDocument();
    expect(screen.getByText('action Node')).toBeInTheDocument();
    expect(screen.getByText('end Node')).toBeInTheDocument();
  });

  it('adds text node from menu', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    fireEvent.click(screen.getByText('Add Node'));
    fireEvent.click(screen.getByText('text Node'));
    expect(mockAddNode).toHaveBeenCalledWith(
      'tree-1',
      expect.objectContaining({ type: 'text', speaker: 'NPC' }),
    );
    expect(mockSelectNode).toHaveBeenCalled();
  });

  it('adds end node from menu', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    fireEvent.click(screen.getByText('Add Node'));
    fireEvent.click(screen.getByText('end Node'));
    expect(mockAddNode).toHaveBeenCalledWith(
      'tree-1',
      expect.objectContaining({ type: 'end' }),
    );
  });
});
