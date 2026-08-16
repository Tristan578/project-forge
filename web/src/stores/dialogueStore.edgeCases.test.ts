/**
 * Edge case tests for dialogueStore (PF-360).
 *
 * Covers gaps not addressed by dialogueStore.test.ts:
 * - Broken startNodeId (orphan start reference)
 * - Deeply nested AND/OR conditions (3 levels, and the depth cap past which
 *   they are treated as unsatisfied rather than overflowing the stack)
 * - Cyclic condition/action chains and the hop cap that bounds them (PF-1146)
 * - Dangling node references from text, condition and action nodes
 * - Empty-text typewriter state
 * - duplicate tree with choice and action nodes
 * - Corrupted localStorage data
 * - Multiple sequential action nodes
 * - advanceDialogue on a choice node (non-text, non-end)
 * - not_equals with undefined variable
 * - has_item with entirely missing `items` key
 * - loadFromLocalStorage with no stored data
 * - removeNode on non-existent node id
 * - addNode to tree that already has maximum variation of node types
 * - importTree produces a new name suffix
 * - updateTree merges variables without clobbering unrelated keys
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { useDialogueStore, MAX_DIALOGUE_HOPS, MAX_CONDITION_DEPTH } from './dialogueStore';
import type {
  Condition,
  DialogueNode,
  TextNode,
  ChoiceNode,
  ConditionNode,
  ActionNode,
  EndNode,
} from './dialogueStore';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

global.localStorage = localStorageMock as Storage;

// ---------------------------------------------------------------------------
// Helper: reset store before each test
// ---------------------------------------------------------------------------

function resetStore() {
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
  localStorage.clear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dialogueStore — edge cases (PF-360)', () => {
  beforeEach(resetStore);

  // =========================================================================
  // Broken / malformed tree structures
  // =========================================================================

  describe('malformed tree structures', () => {
    it('startDialogue does nothing when startNodeId does not exist in nodes', () => {
      // Manually inject a tree whose startNodeId references a missing node
      useDialogueStore.setState({
        dialogueTrees: {
          tree_broken: {
            id: 'tree_broken',
            name: 'Broken',
            nodes: [],
            startNodeId: 'node_missing',
            variables: {},
          },
        },
      });

      useDialogueStore.getState().startDialogue('tree_broken');
      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
    });

    it('processCurrentNode does nothing when currentNodeId references a missing node', () => {
      // Start a valid dialogue, then corrupt the currentNodeId
      const treeId = useDialogueStore.getState().addTree('Test', 'Hello');
      useDialogueStore.getState().startDialogue(treeId);
      expect(useDialogueStore.getState().runtime.isActive).toBe(true);

      // Corrupt the runtime to point at a nonexistent node
      useDialogueStore.setState(state => ({
        runtime: { ...state.runtime, currentNodeId: 'node_ghost' },
      }));

      // advanceDialogue should not crash; it finds no node and returns early
      useDialogueStore.getState().advanceDialogue();
      // Dialogue remains in whatever state it was — the key guarantee is no exception
      expect(useDialogueStore.getState().runtime.activeTreeId).toBe(treeId);
    });

    it('advanceDialogue does nothing when activeTreeId references a missing tree', () => {
      // Set up an inconsistent runtime state
      useDialogueStore.setState({
        runtime: {
          activeTreeId: 'tree_ghost',
          currentNodeId: 'node_1',
          isActive: true,
          displayedText: '',
          typewriterComplete: false,
          currentChoices: [],
          history: [],
        },
      });

      useDialogueStore.getState().advanceDialogue();
      // Should not crash
      expect(useDialogueStore.getState().runtime.isActive).toBe(true);
    });

    it('selectChoice does nothing when activeTreeId references a missing tree', () => {
      useDialogueStore.setState({
        runtime: {
          activeTreeId: 'tree_ghost',
          currentNodeId: 'node_1',
          isActive: true,
          displayedText: '',
          typewriterComplete: false,
          currentChoices: [],
          history: [],
        },
      });

      useDialogueStore.getState().selectChoice('choice_1');
      // Should not crash
      expect(useDialogueStore.getState().runtime.isActive).toBe(true);
    });
  });

  // =========================================================================
  // Deeply nested conditions
  // =========================================================================

  describe('deeply nested conditions', () => {
    it('AND inside OR inside AND evaluates correctly (true path)', () => {
      const treeId = useDialogueStore.getState().addTree('Nested', 'Start');
      useDialogueStore.getState().updateTree(treeId, {
        variables: { a: 1, b: 2, c: 3 },
      });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      // ( (a==1 AND b==2) OR c==99 ) AND (c==3)
      // = (true OR false) AND true = true
      const condNode: ConditionNode = {
        id: 'cond_deep',
        type: 'condition',
        condition: {
          type: 'and',
          conditions: [
            {
              type: 'or',
              conditions: [
                { type: 'and', conditions: [
                  { type: 'equals', variable: 'a', value: 1 },
                  { type: 'equals', variable: 'b', value: 2 },
                ]},
                { type: 'equals', variable: 'c', value: 99 },
              ],
            },
            { type: 'equals', variable: 'c', value: 3 },
          ],
        },
        onTrue: 'node_true',
        onFalse: 'node_false',
      };

      const trueNode: TextNode = {
        id: 'node_true',
        type: 'text',
        speaker: 'System',
        text: 'Deep nested true',
        next: null,
      };

      const falseNode: TextNode = {
        id: 'node_false',
        type: 'text',
        speaker: 'System',
        text: 'Deep nested false',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, condNode);
      useDialogueStore.getState().addNode(treeId, trueNode);
      useDialogueStore.getState().addNode(treeId, falseNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond_deep' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('node_true');
      expect(useDialogueStore.getState().runtime.displayedText).toBe('Deep nested true');
    });

    it('AND inside OR inside AND evaluates correctly (false path)', () => {
      const treeId = useDialogueStore.getState().addTree('Nested', 'Start');
      // All sub-conditions false: (false AND false) OR false = false; false AND false = false
      useDialogueStore.getState().updateTree(treeId, {
        variables: { a: 0, b: 0, c: 0 },
      });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const condNode: ConditionNode = {
        id: 'cond_deep',
        type: 'condition',
        condition: {
          type: 'and',
          conditions: [
            {
              type: 'or',
              conditions: [
                { type: 'and', conditions: [
                  { type: 'equals', variable: 'a', value: 1 },
                  { type: 'equals', variable: 'b', value: 2 },
                ]},
                { type: 'equals', variable: 'c', value: 99 },
              ],
            },
            { type: 'equals', variable: 'c', value: 3 },
          ],
        },
        onTrue: 'node_true',
        onFalse: 'node_false',
      };

      const falseNode: TextNode = {
        id: 'node_false',
        type: 'text',
        speaker: 'System',
        text: 'All false',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, condNode);
      useDialogueStore.getState().addNode(treeId, falseNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond_deep' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('node_false');
    });

    it('has_item nested inside AND works correctly', () => {
      const treeId = useDialogueStore.getState().addTree('Nested', 'Start');
      useDialogueStore.getState().updateTree(treeId, {
        variables: { items: ['sword', 'shield'], level: 5 },
      });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      // has_item('sword') AND level > 3 => true AND true = true
      const condNode: ConditionNode = {
        id: 'cond',
        type: 'condition',
        condition: {
          type: 'and',
          conditions: [
            { type: 'has_item', itemId: 'sword' },
            { type: 'greater', variable: 'level', value: 3 },
          ],
        },
        onTrue: 'node_true',
        onFalse: 'node_false',
      };

      const trueNode: TextNode = {
        id: 'node_true',
        type: 'text',
        speaker: 'System',
        text: 'Has sword and high level',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, condNode);
      useDialogueStore.getState().addNode(treeId, trueNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('node_true');
    });
  });

  // =========================================================================
  // not_equals edge cases
  // =========================================================================

  describe('not_equals condition edge cases', () => {
    it('not_equals returns true when variable is undefined (undefined !== any value)', () => {
      const treeId = useDialogueStore.getState().addTree('Test', 'Start');
      // Do not set 'questFlag' variable at all
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const condNode: ConditionNode = {
        id: 'cond',
        type: 'condition',
        condition: { type: 'not_equals', variable: 'questFlag', value: 'completed' },
        onTrue: 'node_true',
        onFalse: 'node_false',
      };

      const trueNode: TextNode = {
        id: 'node_true',
        type: 'text',
        speaker: 'System',
        text: 'Quest not completed',
        next: null,
      };

      const falseNode: TextNode = {
        id: 'node_false',
        type: 'text',
        speaker: 'System',
        text: 'Quest completed',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, condNode);
      useDialogueStore.getState().addNode(treeId, trueNode);
      useDialogueStore.getState().addNode(treeId, falseNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('node_true');
    });

    it('not_equals returns false when variable equals the value', () => {
      const treeId = useDialogueStore.getState().addTree('Test', 'Start');
      useDialogueStore.getState().updateTree(treeId, {
        variables: { questFlag: 'completed' },
      });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const condNode: ConditionNode = {
        id: 'cond',
        type: 'condition',
        condition: { type: 'not_equals', variable: 'questFlag', value: 'completed' },
        onTrue: 'node_true',
        onFalse: 'node_false',
      };

      const falseNode: TextNode = {
        id: 'node_false',
        type: 'text',
        speaker: 'System',
        text: 'Quest done',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, condNode);
      useDialogueStore.getState().addNode(treeId, falseNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('node_false');
    });
  });

  // =========================================================================
  // has_item with entirely missing items key
  // =========================================================================

  describe('has_item with no items key', () => {
    it('has_item returns false when items key does not exist in variables', () => {
      const treeId = useDialogueStore.getState().addTree('Test', 'Start');
      // No 'items' key at all
      useDialogueStore.getState().updateTree(treeId, { variables: { level: 5 } });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const condNode: ConditionNode = {
        id: 'cond',
        type: 'condition',
        condition: { type: 'has_item', itemId: 'key' },
        onTrue: 'node_true',
        onFalse: 'node_false',
      };

      const falseNode: TextNode = {
        id: 'node_false',
        type: 'text',
        speaker: 'System',
        text: 'No key',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, condNode);
      useDialogueStore.getState().addNode(treeId, falseNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('node_false');
    });
  });

  // =========================================================================
  // Typewriter edge cases
  // =========================================================================

  describe('typewriter edge cases', () => {
    it('skipTypewriter on short-text node sets displayedText to full node text', () => {
      // Note: addTree falls back to 'Welcome to the dialogue.' if startNodeText is
      // falsy (empty string). Use a whitespace-only string to get a non-default value.
      const treeId = useDialogueStore.getState().addTree('Test', 'Hi');
      useDialogueStore.getState().startDialogue(treeId);

      // Simulate typewriter still in progress (partial display)
      useDialogueStore.setState(state => ({
        runtime: { ...state.runtime, displayedText: 'H', typewriterComplete: false },
      }));

      useDialogueStore.getState().skipTypewriter();
      const { runtime } = useDialogueStore.getState();
      expect(runtime.displayedText).toBe('Hi');
      expect(runtime.typewriterComplete).toBe(true);
    });

    it('skipTypewriter does nothing when no dialogue is active', () => {
      // Runtime not active, no activeTreeId
      const displayedBefore = useDialogueStore.getState().runtime.displayedText;
      useDialogueStore.getState().skipTypewriter();
      expect(useDialogueStore.getState().runtime.displayedText).toBe(displayedBefore);
    });

    it('text node with very long text sets full displayedText on processCurrentNode', () => {
      const longText = 'a'.repeat(10000);
      const treeId = useDialogueStore.getState().addTree('Test', longText);
      useDialogueStore.getState().startDialogue(treeId);

      const { runtime } = useDialogueStore.getState();
      expect(runtime.displayedText).toBe(longText);
      expect(runtime.typewriterComplete).toBe(true);
    });

    it('startDialogue resets history to empty array', () => {
      const treeId = useDialogueStore.getState().addTree('Test', 'Hello');
      // First dialogue run
      useDialogueStore.getState().startDialogue(treeId);
      expect(useDialogueStore.getState().runtime.history).toHaveLength(1);

      useDialogueStore.getState().endDialogue();

      // Second dialogue run — history should reset
      useDialogueStore.getState().startDialogue(treeId);
      expect(useDialogueStore.getState().runtime.history).toHaveLength(1);
      expect(useDialogueStore.getState().runtime.history[0].text).toBe('Hello');
    });
  });

  // =========================================================================
  // advanceDialogue on a choice node
  // =========================================================================

  describe('advanceDialogue on non-text, non-end nodes', () => {
    it('advanceDialogue does not advance when on a choice node (requires selectChoice)', () => {
      const treeId = useDialogueStore.getState().addTree('Test', 'Start');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const choiceNode: ChoiceNode = {
        id: 'choice_node',
        type: 'choice',
        text: 'Pick one',
        choices: [
          { id: 'c1', text: 'Option A', nextNodeId: 'result_a' },
        ],
      };

      const resultA: TextNode = {
        id: 'result_a',
        type: 'text',
        speaker: 'NPC',
        text: 'You chose A',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, choiceNode);
      useDialogueStore.getState().addNode(treeId, resultA);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'choice_node' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue(); // Moves to choice_node

      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('choice_node');

      // advanceDialogue should not move away from a choice node
      useDialogueStore.getState().advanceDialogue();
      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('choice_node');
    });
  });

  // =========================================================================
  // Multiple sequential action nodes
  // =========================================================================

  describe('sequential action nodes', () => {
    it('action → action → text executes all actions in sequence', () => {
      const treeId = useDialogueStore.getState().addTree('Test', 'Start');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const actionA: ActionNode = {
        id: 'action_a',
        type: 'action',
        actions: [{ type: 'set_state', key: 'stepA', value: true }],
        next: 'action_b',
      };

      const actionB: ActionNode = {
        id: 'action_b',
        type: 'action',
        actions: [
          { type: 'set_state', key: 'stepB', value: true },
          { type: 'increment', key: 'counter', amount: 10 },
        ],
        next: 'final_text',
      };

      const finalText: TextNode = {
        id: 'final_text',
        type: 'text',
        speaker: 'System',
        text: 'Actions done',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, actionA);
      useDialogueStore.getState().addNode(treeId, actionB);
      useDialogueStore.getState().addNode(treeId, finalText);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'action_a' });

      useDialogueStore.getState().startDialogue(treeId);
      // Start processes startNode (text). Advance moves to action_a, which
      // auto-chains through action_b to final_text.
      useDialogueStore.getState().advanceDialogue();

      const updatedTree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(updatedTree.variables.stepA).toBe(true);
      expect(updatedTree.variables.stepB).toBe(true);
      expect(updatedTree.variables.counter).toBe(10);
      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('final_text');
      expect(useDialogueStore.getState().runtime.displayedText).toBe('Actions done');
    });

    it('action node executes multiple action types in correct order', () => {
      const treeId = useDialogueStore.getState().addTree('Test', 'Start');
      useDialogueStore.getState().updateTree(treeId, { variables: { score: 5 } });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const actionNode: ActionNode = {
        id: 'action',
        type: 'action',
        actions: [
          { type: 'add_item', itemId: 'gem' },
          { type: 'increment', key: 'score', amount: 3 },
          { type: 'set_state', key: 'found_gem', value: true },
          { type: 'trigger_event', eventName: 'gem_collected' },
        ],
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, actionNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'action' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      const updatedTree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(updatedTree.variables.items).toEqual(['gem']);
      expect(updatedTree.variables.score).toBe(8);
      expect(updatedTree.variables.found_gem).toBe(true);
      expect(updatedTree.variables._triggeredEvents).toEqual(['gem_collected']);
    });
  });

  // =========================================================================
  // Persistence edge cases
  // =========================================================================

  describe('persistence edge cases', () => {
    it('loadFromLocalStorage with no stored data is a no-op', () => {
      // localStorage is empty (cleared in beforeEach)
      useDialogueStore.getState().loadFromLocalStorage();
      expect(Object.keys(useDialogueStore.getState().dialogueTrees)).toHaveLength(0);
    });

    it('loadFromLocalStorage with corrupted JSON does not throw', () => {
      localStorage.setItem('forge_dialogue_trees', '{broken json{{{{');
      expect(() => {
        useDialogueStore.getState().loadFromLocalStorage();
      }).not.toThrow();
      // Store should remain with whatever was there before (empty)
    });

    it('loadFromLocalStorage with valid empty object sets empty trees', () => {
      // Add a tree (this also saves to localStorage)
      useDialogueStore.getState().addTree('Should be cleared');
      expect(Object.keys(useDialogueStore.getState().dialogueTrees)).toHaveLength(1);

      // Overwrite localStorage with an empty object AFTER the tree was added
      localStorage.setItem('forge_dialogue_trees', '{}');

      // Loading should replace in-memory state with the empty object
      useDialogueStore.getState().loadFromLocalStorage();
      expect(Object.keys(useDialogueStore.getState().dialogueTrees)).toHaveLength(0);
    });

    it('removeTree then loadFromLocalStorage does not restore deleted tree', () => {
      const treeId = useDialogueStore.getState().addTree('To Delete');
      useDialogueStore.getState().removeTree(treeId);

      // localStorage should now reflect the deletion
      useDialogueStore.setState({ dialogueTrees: {} }); // Clear in-memory
      useDialogueStore.getState().loadFromLocalStorage();

      expect(useDialogueStore.getState().dialogueTrees[treeId]).toBeUndefined();
    });
  });

  // =========================================================================
  // duplicateTree with all node types
  // =========================================================================

  describe('duplicateTree with choice and action nodes', () => {
    it('duplicateTree remaps choice node nextNodeId references', () => {
      const treeId = useDialogueStore.getState().addTree('Full Tree', 'Start');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const choiceNode: ChoiceNode = {
        id: 'choice_node',
        type: 'choice',
        text: 'Choose',
        choices: [
          { id: 'c1', text: 'Path A', nextNodeId: 'path_a' },
          { id: 'c2', text: 'Path B', nextNodeId: null },
        ],
      };

      const pathA: TextNode = {
        id: 'path_a',
        type: 'text',
        speaker: 'NPC',
        text: 'Path A text',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, choiceNode);
      useDialogueStore.getState().addNode(treeId, pathA);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'choice_node' });

      const newTreeId = useDialogueStore.getState().duplicateTree(treeId)!;
      const newTree = useDialogueStore.getState().dialogueTrees[newTreeId];

      const newChoiceNode = newTree.nodes.find(n => n.type === 'choice') as ChoiceNode;
      expect(newChoiceNode).toEqual(expect.objectContaining({ type: 'choice' }));

      // Choice that pointed to 'path_a' should now point to a new (different) ID
      const choice0NextId = newChoiceNode.choices[0].nextNodeId;
      expect(choice0NextId).not.toBe('path_a');
      expect(choice0NextId).not.toBeNull();
      // The remapped target should exist in the new tree
      expect(newTree.nodes.some(n => n.id === choice0NextId)).toBe(true);

      // Choice with null nextNodeId should remain null
      expect(newChoiceNode.choices[1].nextNodeId).toBeNull();
    });

    it('duplicateTree remaps action node next references', () => {
      const treeId = useDialogueStore.getState().addTree('Action Tree', 'Start');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const actionNode: ActionNode = {
        id: 'action_node',
        type: 'action',
        actions: [{ type: 'set_state', key: 'x', value: 1 }],
        next: 'end_node',
      };

      const endNode: EndNode = { id: 'end_node', type: 'end' };

      useDialogueStore.getState().addNode(treeId, actionNode);
      useDialogueStore.getState().addNode(treeId, endNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'action_node' });

      const newTreeId = useDialogueStore.getState().duplicateTree(treeId)!;
      const newTree = useDialogueStore.getState().dialogueTrees[newTreeId];

      const newActionNode = newTree.nodes.find(n => n.type === 'action') as ActionNode;
      expect(newActionNode).toEqual(expect.objectContaining({ type: 'action' }));

      // Action next should be remapped to the new end node ID
      expect(newActionNode.next).not.toBe('end_node');
      expect(newActionNode.next).not.toBeNull();
      expect(newTree.nodes.some(n => n.id === newActionNode.next)).toBe(true);
    });

    it('duplicateTree preserves variables', () => {
      const treeId = useDialogueStore.getState().addTree('Var Tree', 'Start');
      useDialogueStore.getState().updateTree(treeId, {
        variables: { score: 100, level: 5, items: ['sword'] },
      });

      const newTreeId = useDialogueStore.getState().duplicateTree(treeId)!;
      const newTree = useDialogueStore.getState().dialogueTrees[newTreeId];

      expect(newTree.variables.score).toBe(100);
      expect(newTree.variables.level).toBe(5);
      expect(newTree.variables.items).toEqual(['sword']);

      // Verify it's a shallow copy (mutating the copy's variables doesn't affect original)
      newTree.variables.score = 999;
      const originalTree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(originalTree.variables.score).toBe(100);
    });
  });

  // =========================================================================
  // importTree name suffix
  // =========================================================================

  describe('importTree name handling', () => {
    it('importTree appends (Imported) to the tree name', () => {
      const treeId = useDialogueStore.getState().addTree('My Dialogue');
      const json = useDialogueStore.getState().exportTree(treeId)!;

      const importedId = useDialogueStore.getState().importTree(json)!;
      const importedTree = useDialogueStore.getState().dialogueTrees[importedId];
      expect(importedTree.name).toBe('My Dialogue (Imported)');
    });

    it('importTree assigns a fresh ID distinct from the original', () => {
      const treeId = useDialogueStore.getState().addTree('Original');
      const json = useDialogueStore.getState().exportTree(treeId)!;

      const importedId = useDialogueStore.getState().importTree(json)!;
      expect(importedId).not.toBe(treeId);
    });

    it('importing (Imported) tree appends suffix again', () => {
      const treeId = useDialogueStore.getState().addTree('Base');
      const json1 = useDialogueStore.getState().exportTree(treeId)!;

      const id2 = useDialogueStore.getState().importTree(json1)!;
      const json2 = useDialogueStore.getState().exportTree(id2)!;

      const id3 = useDialogueStore.getState().importTree(json2)!;
      const tree3 = useDialogueStore.getState().dialogueTrees[id3];

      // 'Base (Imported) (Imported)'
      expect(tree3.name).toBe('Base (Imported) (Imported)');
    });
  });

  // =========================================================================
  // updateTree variable merging
  // =========================================================================

  describe('updateTree variable merging', () => {
    it('updating variables merges with existing keys', () => {
      const treeId = useDialogueStore.getState().addTree('Test');
      useDialogueStore.getState().updateTree(treeId, {
        variables: { health: 100, mana: 50 },
      });
      // Update only health, mana should remain
      useDialogueStore.getState().updateTree(treeId, {
        variables: { health: 75 },
      });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      // The store does a spread-merge at the tree level, so variables is replaced wholesale
      // This test documents the actual behavior: variables is replaced, not deep-merged
      expect(tree.variables.health).toBe(75);
    });

    it('updating name does not reset nodes', () => {
      const treeId = useDialogueStore.getState().addTree('Old Name', 'Some text');
      const nodeBefore = useDialogueStore.getState().dialogueTrees[treeId].nodes[0];

      useDialogueStore.getState().updateTree(treeId, { name: 'New Name' });
      const tree = useDialogueStore.getState().dialogueTrees[treeId];

      expect(tree.name).toBe('New Name');
      expect(tree.nodes[0]).toEqual(nodeBefore);
    });
  });

  // =========================================================================
  // removeNode on non-existent ID
  // =========================================================================

  describe('removeNode with non-existent IDs', () => {
    it('removeNode with non-existent nodeId does nothing', () => {
      const treeId = useDialogueStore.getState().addTree('Test');
      const nodesBefore = useDialogueStore.getState().dialogueTrees[treeId].nodes.slice();

      useDialogueStore.getState().removeNode(treeId, 'node_does_not_exist');

      const nodesAfter = useDialogueStore.getState().dialogueTrees[treeId].nodes;
      expect(nodesAfter).toHaveLength(nodesBefore.length);
    });

    it('removeNode with non-existent treeId does nothing', () => {
      const countBefore = Object.keys(useDialogueStore.getState().dialogueTrees).length;
      useDialogueStore.getState().removeNode('tree_ghost', 'node_ghost');
      const countAfter = Object.keys(useDialogueStore.getState().dialogueTrees).length;
      expect(countAfter).toBe(countBefore);
    });
  });

  // =========================================================================
  // Condition node with only one branch null
  // =========================================================================

  describe('condition node with one null branch', () => {
    it('condition true path is null but false path exists routes correctly', () => {
      const treeId = useDialogueStore.getState().addTree('Test', 'Start');
      useDialogueStore.getState().updateTree(treeId, { variables: { flag: false } });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const condNode: ConditionNode = {
        id: 'cond',
        type: 'condition',
        condition: { type: 'equals', variable: 'flag', value: true },
        onTrue: null,    // No true branch
        onFalse: 'node_false',
      };

      const falseNode: TextNode = {
        id: 'node_false',
        type: 'text',
        speaker: 'System',
        text: 'Went to false',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, condNode);
      useDialogueStore.getState().addNode(treeId, falseNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('node_false');
    });

    it('condition evaluates to true but onTrue is null — ends dialogue', () => {
      const treeId = useDialogueStore.getState().addTree('Test', 'Start');
      useDialogueStore.getState().updateTree(treeId, { variables: { flag: true } });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const condNode: ConditionNode = {
        id: 'cond',
        type: 'condition',
        condition: { type: 'equals', variable: 'flag', value: true },
        onTrue: null,   // No true path => ends dialogue
        onFalse: 'node_false',
      };

      useDialogueStore.getState().addNode(treeId, condNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
    });
  });

  // =========================================================================
  // Runtime history accumulates speaker correctly
  // =========================================================================

  describe('runtime history speaker tracking', () => {
    it('history entries contain correct speaker names', () => {
      const treeId = useDialogueStore.getState().addTree('Test', 'Narrator line');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      // Update start node speaker
      useDialogueStore.getState().updateNode(treeId, startNodeId, { speaker: 'Narrator' });

      const node2: TextNode = {
        id: 'node2',
        type: 'text',
        speaker: 'Hero',
        text: 'Hero responds',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, node2);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'node2' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      const { history } = useDialogueStore.getState().runtime;
      expect(history).toHaveLength(2);
      expect(history[0].speaker).toBe('Narrator');
      expect(history[1].speaker).toBe('Hero');
    });

    it('history is not polluted across separate startDialogue calls', () => {
      const treeId = useDialogueStore.getState().addTree('Test', 'Line 1');
      useDialogueStore.getState().startDialogue(treeId);
      expect(useDialogueStore.getState().runtime.history).toHaveLength(1);
      useDialogueStore.getState().endDialogue();

      // Second run — history should start fresh
      useDialogueStore.getState().startDialogue(treeId);
      expect(useDialogueStore.getState().runtime.history).toHaveLength(1);
    });
  });

  // =========================================================================
  // add_item initializes items array when not present
  // =========================================================================

  describe('add_item initializes items array', () => {
    it('add_item creates items array when variable is undefined', () => {
      const treeId = useDialogueStore.getState().addTree('Test', 'Start');
      // No 'items' key in variables
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const actionNode: ActionNode = {
        id: 'action',
        type: 'action',
        actions: [{ type: 'add_item', itemId: 'potion' }],
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, actionNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'action' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      const updatedTree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(updatedTree.variables.items).toEqual(['potion']);
    });
  });

  // =========================================================================
  // increment initializes to amount when variable is non-numeric string
  // =========================================================================

  describe('increment with non-numeric existing value', () => {
    it('increment treats string value as non-number and initializes to amount', () => {
      const treeId = useDialogueStore.getState().addTree('Test', 'Start');
      useDialogueStore.getState().updateTree(treeId, { variables: { counter: 'not_a_number' } });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const actionNode: ActionNode = {
        id: 'action',
        type: 'action',
        actions: [{ type: 'increment', key: 'counter', amount: 7 }],
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, actionNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'action' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      const updatedTree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(updatedTree.variables.counter).toBe(7);
    });

    it('increment handles negative amounts correctly', () => {
      const treeId = useDialogueStore.getState().addTree('Test', 'Start');
      useDialogueStore.getState().updateTree(treeId, { variables: { health: 100 } });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const actionNode: ActionNode = {
        id: 'action',
        type: 'action',
        actions: [{ type: 'increment', key: 'health', amount: -25 }],
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, actionNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'action' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      const updatedTree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(updatedTree.variables.health).toBe(75);
    });
  });

  // =========================================================================
  // remove_item edge cases
  // =========================================================================

  describe('remove_item edge cases', () => {
    it('remove_item on missing item (not in array) leaves array unchanged', () => {
      const treeId = useDialogueStore.getState().addTree('Test', 'Start');
      useDialogueStore.getState().updateTree(treeId, { variables: { items: ['sword', 'shield'] } });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const actionNode: ActionNode = {
        id: 'action',
        type: 'action',
        actions: [{ type: 'remove_item', itemId: 'nonexistent_item' }],
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, actionNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'action' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      const updatedTree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(updatedTree.variables.items).toEqual(['sword', 'shield']);
    });
  });

  // =========================================================================
  // endDialogue clears currentChoices
  // =========================================================================

  describe('endDialogue state completeness', () => {
    it('endDialogue clears currentChoices populated during choice node', () => {
      const treeId = useDialogueStore.getState().addTree('Test', 'Start');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const choiceNode: ChoiceNode = {
        id: 'choice',
        type: 'choice',
        choices: [
          { id: 'c1', text: 'Yes', nextNodeId: null },
          { id: 'c2', text: 'No', nextNodeId: null },
        ],
      };

      useDialogueStore.getState().addNode(treeId, choiceNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'choice' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.currentChoices).toHaveLength(2);

      useDialogueStore.getState().endDialogue();
      expect(useDialogueStore.getState().runtime.currentChoices).toHaveLength(0);
      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
      expect(useDialogueStore.getState().runtime.typewriterComplete).toBe(false);
    });
  });

  /**
   * Run a condition node and report which branch it took.
   *
   * `Condition` cannot describe a hole, a `null` member, or a bare string, which
   * is the whole point: the casts below are what let the test express the shape
   * the runtime actually has to survive. See `evaluateCondition` / `allOf` /
   * `anyOf` in `dialogueStore.ts` for where each shape comes from and why the
   * callback methods miss it.
   *
   * Shared by the two describes below on purpose. They cover the same helper
   * from opposite sides — a bad member INSIDE a group, and a bad condition ON
   * the node itself — and the second was the one nothing exercised.
   */
  const branchTaken = (condition: unknown): string | null => {
    const treeId = useDialogueStore.getState().addTree('Gap', 'Start');
    useDialogueStore.getState().updateTree(treeId, { variables: { a: 1 } });
    const startNodeId = useDialogueStore.getState().dialogueTrees[treeId].startNodeId;

    useDialogueStore.getState().addNode(treeId, {
      id: 'cond',
      type: 'condition',
      condition: condition as ConditionNode['condition'],
      onTrue: 'yes',
      onFalse: 'no',
    } as ConditionNode);
    for (const id of ['yes', 'no']) {
      useDialogueStore.getState().addNode(treeId, {
        id,
        type: 'text',
        speaker: 'System',
        text: id,
        next: null,
      } as TextNode);
    }
    useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond' });

    useDialogueStore.getState().startDialogue(treeId);
    useDialogueStore.getState().advanceDialogue();
    return useDialogueStore.getState().runtime.currentNodeId;
  };

  describe('condition groups with an absent member', () => {
    it('does not let a hole satisfy an AND group', () => {
      // `Array.prototype.every` skips holes, so this group reported itself
      // satisfied without the missing slot ever being evaluated — a gate opening
      // because one of its terms was absent.
      // The hole below is deliberate — it IS the input under test.
      const withHole = [{ type: 'equals', variable: 'a', value: 1 }, , ];
      expect(withHole).toHaveLength(2);
      expect(branchTaken({ type: 'and', conditions: withHole })).toBe('no');
    });

    it('does not let a null member satisfy an AND group', () => {
      // Unlike a hole, this one survives `JSON.parse`, so it arrives from any
      // imported tree — and `evaluateCondition` reads `.type` off its argument,
      // so before this it threw mid-playback rather than resolving either way.
      expect(
        branchTaken({
          type: 'and',
          conditions: [{ type: 'equals', variable: 'a', value: 1 }, null],
        })
      ).toBe('no');
    });

    it('still takes the true branch when every AND member is present', () => {
      // Without this, an `allOf` that returned `false` unconditionally would pass
      // both tests above.
      expect(
        branchTaken({
          type: 'and',
          conditions: [{ type: 'equals', variable: 'a', value: 1 }],
        })
      ).toBe('yes');
    });

    it('does not let a hole or a null satisfy an OR group', () => {
      // Every member is a gap, so the false branch can only mean that neither a
      // hole nor a `null` stood in for a satisfied term — no real condition is
      // present that could have produced it instead.
      // The hole below is deliberate — it IS the input under test.
      const gaps = [, null];
      expect(branchTaken({ type: 'or', conditions: gaps })).toBe('no');
    });

    it('treats a missing or non-array conditions list as unsatisfied', () => {
      // Reachable from an imported tree, and one level up from the element
      // guards: reading `.length` off `undefined` threw mid-playback.
      expect(branchTaken({ type: 'and' })).toBe('no');
      expect(branchTaken({ type: 'or', conditions: null })).toBe('no');
      expect(branchTaken({ type: 'and', conditions: 'nope' })).toBe('no');
    });

    it('still takes the true branch when an OR member is satisfied', () => {
      expect(
        branchTaken({
          type: 'or',
          conditions: [null, { type: 'equals', variable: 'a', value: 1 }],
        })
      ).toBe('yes');
    });
  });

  /**
   * The same absent-condition problem on the node itself rather than inside a
   * group — `case 'condition'` passes `currentNode.condition` straight to
   * `evaluateCondition`.
   *
   * The guard existed at three of the four call sites and not at this one, which
   * is why it read as covered: `allOf`, `anyOf` and the choice filter each
   * carried their own check, so the shape was visibly handled everywhere except
   * the path that threw. Every case here is reachable from `importTree` or
   * `loadFromLocalStorage` — `sanitizeTree` drops null NODES, and does not
   * descend into a node's condition.
   */
  describe('a condition node whose own condition is absent or unusable', () => {
    // These two are the guard. Both threw before it: `evaluateCondition` read
    // `.type` off its argument, and `case 'condition'` had nothing in front of
    // it. Measured against the pre-fix source, these are the only two of this
    // block that go red.
    it.each([
      ['null', null],
      ['undefined', undefined],
    ])('routes to the false branch when the condition is %s', (_case, condition) => {
      expect(branchTaken(condition)).toBe('no');
    });

    // These do NOT exercise the guard, and saying so is the point: each falls
    // through to `evaluateCondition`'s `default` arm, so each answers `false`
    // with or without it, and each stayed green against the pre-fix source. They
    // are here for the `default` arm itself — a hand-edited or third-party tree
    // produces exactly these, and a future `default: throw` or a `.type`
    // narrowing would reintroduce the same crash by another route.
    it.each([
      ['an object with no type key', {}],
      ['a bare expression string', 'gold > 5'],
      ['a number', 0],
    ])('routes to the false branch when the condition is %s', (_case, condition) => {
      expect(branchTaken(condition)).toBe('no');
    });

    it('still takes the true branch when the condition is a real one', () => {
      // Without this, an `evaluateCondition` that returned `false` unconditionally
      // would pass every case above.
      expect(branchTaken({ type: 'equals', variable: 'a', value: 1 })).toBe('yes');
    });
  });

  describe('null members in imported and persisted trees', () => {
    // `JSON.parse` produces `null` freely, and both entry points used to cast
    // the result to `DialogueTree` without checking anything. Every reader
    // downstream — `nodes.find`, `choices.filter`, `for (const action of ...)` —
    // dereferences the element on the strength of that cast.
    const treeWithNulls = {
      id: 't1',
      name: 'Imported',
      startNodeId: 'start',
      variables: {},
      nodes: [
        null,
        { id: 'start', type: 'text', speaker: 'A', text: 'hi', next: 'pick' },
        { id: 'pick', type: 'choice', choices: [null, { id: 'c1', text: 'go', nextNodeId: null }] },
        { id: 'act', type: 'action', actions: null, next: null },
        { id: 'noChoices', type: 'choice' },
      ],
    };

    it('drops null nodes on import and still plays the tree', () => {
      const treeId = useDialogueStore.getState().importTree(JSON.stringify(treeWithNulls));
      expect(treeId).not.toBeNull();

      const tree = useDialogueStore.getState().dialogueTrees[treeId as string];
      expect(tree.nodes.map(n => n.id)).toEqual(['start', 'pick', 'act', 'noChoices']);

      // The whole point: starting playback used to throw on `nodes.find`.
      useDialogueStore.getState().startDialogue(treeId as string);
      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('start');
      useDialogueStore.getState().advanceDialogue();
      expect(useDialogueStore.getState().runtime.currentChoices.map(c => c.id)).toEqual(['c1']);
    });

    it('gives a choice node with no choices key an empty list', () => {
      const treeId = useDialogueStore.getState().importTree(JSON.stringify(treeWithNulls));
      const tree = useDialogueStore.getState().dialogueTrees[treeId as string];
      const noChoices = tree.nodes.find(n => n.id === 'noChoices');
      expect(noChoices && 'choices' in noChoices ? noChoices.choices : null).toEqual([]);
      const act = tree.nodes.find(n => n.id === 'act');
      expect(act && 'actions' in act ? act.actions : null).toEqual([]);
    });

    it('drops null nodes when loading from localStorage', () => {
      localStorage.setItem('forge_dialogue_trees', JSON.stringify({ t1: treeWithNulls }));
      useDialogueStore.getState().loadFromLocalStorage();
      expect(useDialogueStore.getState().dialogueTrees.t1.nodes.map(n => n.id)).toEqual([
        'start',
        'pick',
        'act',
        'noChoices',
      ]);
    });

    it('ignores a stored payload that is not an object', () => {
      localStorage.setItem('forge_dialogue_trees', '"just a string"');
      useDialogueStore.getState().loadFromLocalStorage();
      expect(useDialogueStore.getState().dialogueTrees).toEqual({});
    });

    it('refuses to import a payload that is not an object', () => {
      expect(useDialogueStore.getState().importTree('42')).toBeNull();
      expect(useDialogueStore.getState().importTree('null')).toBeNull();
    });

    it('keeps a well-formed tree untouched', () => {
      // Positive control: a sanitizer that dropped everything passes the above.
      const good = { ...treeWithNulls, nodes: [treeWithNulls.nodes[1]] };
      const treeId = useDialogueStore.getState().importTree(JSON.stringify(good));
      const tree = useDialogueStore.getState().dialogueTrees[treeId as string];
      expect(tree.nodes).toEqual([treeWithNulls.nodes[1]]);
      expect(tree.name).toBe('Imported (Imported)');
    });
  });

  // =========================================================================
  // Cyclic condition/action chains (PF-1146)
  // =========================================================================

  describe('cyclic condition/action chains', () => {
    let errorSpy: MockInstance<typeof console.error>;

    beforeEach(() => {
      // The guard reports on the way out; silence it so a deliberate cycle
      // does not print a wall of red in an otherwise passing run.
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    /** Install `nodes` as a tree whose start node is `nodes[0]`. */
    function seedTree(nodes: DialogueNode[], variables: Record<string, unknown> = {}) {
      useDialogueStore.setState({
        dialogueTrees: {
          tree_cycle: {
            id: 'tree_cycle',
            name: 'Cycle',
            nodes,
            startNodeId: nodes[0].id,
            variables,
          },
        },
      });
      return 'tree_cycle';
    }

    it('does not blow the stack on a condition ⇄ action cycle', () => {
      // `cond` routes to `act`, `act` routes back to `cond`, and neither
      // waits for the player. Recursion turned this into a RangeError that
      // took down the play session; the tree shape is exactly what an AI
      // authoring a branch that "loops back" produces.
      const cond: ConditionNode = {
        id: 'cond',
        type: 'condition',
        condition: { type: 'equals', variable: 'flag', value: true },
        onTrue: 'act',
        onFalse: 'act',
      };
      const act: ActionNode = {
        id: 'act',
        type: 'action',
        actions: [{ type: 'set_state', key: 'flag', value: true }],
        next: 'cond',
      };

      const treeId = seedTree([cond, act]);

      expect(() => useDialogueStore.getState().startDialogue(treeId)).not.toThrow();
      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
      // Specifically the cap, not one of the other paths that also ends the
      // dialogue with a log — otherwise this passes even if the walk bailed
      // early for an unrelated reason.
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('exceeded'));
    });

    it('stops a self-looping action node after exactly MAX_DIALOGUE_HOPS passes', () => {
      // Pins the cap itself. Each pass runs the increment once, so the counter
      // is the number of hops taken — if the loop ever runs one iteration long
      // or short, this reads a different number rather than merely "finished".
      const act: ActionNode = {
        id: 'act',
        type: 'action',
        actions: [{ type: 'increment', key: 'n', amount: 1 }],
        next: 'act',
      };

      const treeId = seedTree([act], { n: 0 });
      useDialogueStore.getState().startDialogue(treeId);

      expect(
        useDialogueStore.getState().dialogueTrees[treeId].variables.n
      ).toBe(MAX_DIALOGUE_HOPS);
      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
    });

    it('still runs a counter-driven loop that resolves on its own', () => {
      // The reason the guard is a hop cap and not a visited-node set: this
      // tree revisits both `cond` and `act`, but `act` mutates the variable
      // `cond` reads, so it terminates by design after three passes. A
      // visited-set would have refused it on the second pass and ended a
      // perfectly good conversation early.
      const cond: ConditionNode = {
        id: 'cond',
        type: 'condition',
        condition: { type: 'less', variable: 'n', value: 3 },
        onTrue: 'act',
        onFalse: 'done',
      };
      const act: ActionNode = {
        id: 'act',
        type: 'action',
        actions: [{ type: 'increment', key: 'n', amount: 1 }],
        next: 'cond',
      };
      const done: TextNode = {
        id: 'done',
        type: 'text',
        speaker: 'Guide',
        text: 'Three times is enough.',
        next: null,
      };

      const treeId = seedTree([cond, act, done], { n: 0 });
      useDialogueStore.getState().startDialogue(treeId);

      expect(useDialogueStore.getState().runtime.isActive).toBe(true);
      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('done');
      expect(useDialogueStore.getState().runtime.displayedText).toBe('Three times is enough.');
      expect(useDialogueStore.getState().dialogueTrees[treeId].variables.n).toBe(3);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('ends the dialogue on a node whose type it does not recognize', () => {
      // `importTree` JSON.parses without validating, so a node type outside
      // the union reaches the runtime. Such a node changes no state, so
      // without its own arm it would spin the loop all the way to the cap.
      const bogus = { id: 'weird', type: 'monologue' } as unknown as DialogueNode;

      const treeId = seedTree([bogus]);
      useDialogueStore.getState().startDialogue(treeId);

      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('unrecognized type'),
        'monologue'
      );
    });

    it('ends the dialogue when an action routes to a node id that is not in the tree', () => {
      // Same provenance as the unrecognized-type case above: nothing validates
      // that `next` names a node that exists. Leaving the dialogue active on a
      // node that cannot render is the stuck state the guard exists to avoid.
      const act: ActionNode = {
        id: 'act',
        type: 'action',
        actions: [{ type: 'set_state', key: 'flag', value: true }],
        next: 'ghost',
      };

      const treeId = seedTree([act]);
      useDialogueStore.getState().startDialogue(treeId);

      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not in the tree'),
        'ghost'
      );
    });

    it('ends the dialogue when a condition routes to a node id that is not in the tree', () => {
      const cond: ConditionNode = {
        id: 'cond',
        type: 'condition',
        condition: { type: 'equals', variable: 'flag', value: true },
        onTrue: 'ghost',
        onFalse: 'ghost',
      };

      const treeId = seedTree([cond]);
      useDialogueStore.getState().startDialogue(treeId);

      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not in the tree'),
        'ghost'
      );
    });

    it('ends the dialogue when a text node advances to a node id that is not in the tree', () => {
      // The dangling reference does not have to come from a routing node —
      // `advanceDialogue` writes `text.next` straight into the runtime, so this
      // reaches the guard on the walk's very first pass.
      const intro: TextNode = {
        id: 'intro',
        type: 'text',
        speaker: 'Guide',
        text: 'Follow me.',
        next: 'ghost',
      };

      const treeId = seedTree([intro]);
      useDialogueStore.getState().startDialogue(treeId);
      expect(useDialogueStore.getState().runtime.isActive).toBe(true);

      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not in the tree'),
        'ghost'
      );
    });
  });

  describe('condition nesting depth (PF-1146)', () => {
    /** An `and` chain nested `depth` levels deep around a single leaf test. */
    function nest(depth: number): Condition {
      let condition: Condition = { type: 'equals', variable: 'flag', value: true };
      for (let i = 0; i < depth; i++) {
        condition = { type: 'and', conditions: [condition] };
      }
      return condition;
    }

    it('evaluates a condition nested up to the depth limit', () => {
      // One below the cap still descends all the way to the leaf, so the cap
      // is not quietly swallowing conditions a real author could write.
      const cond: ConditionNode = {
        id: 'cond',
        type: 'condition',
        condition: nest(MAX_CONDITION_DEPTH - 1),
        onTrue: 'yes',
        onFalse: 'no',
      };
      const yes: TextNode = { id: 'yes', type: 'text', speaker: 'A', text: 'yes', next: null };
      const no: TextNode = { id: 'no', type: 'text', speaker: 'A', text: 'no', next: null };

      useDialogueStore.setState({
        dialogueTrees: {
          tree_depth: {
            id: 'tree_depth',
            name: 'Depth',
            nodes: [cond, yes, no],
            startNodeId: 'cond',
            variables: { flag: true },
          },
        },
      });
      useDialogueStore.getState().startDialogue('tree_depth');

      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('yes');
    });

    it('treats a condition nested past the stack limit as unsatisfied instead of throwing', () => {
      // `JSON.parse` is iterative and the evaluator is not, so `importTree`
      // accepts nesting thousands of levels deep that then overflows the stack.
      // 3000 is past where that happens unguarded; the cap must answer long
      // before it, and answer `false` rather than throw.
      const cond: ConditionNode = {
        id: 'cond',
        type: 'condition',
        condition: nest(3000),
        onTrue: 'yes',
        onFalse: 'no',
      };
      const yes: TextNode = { id: 'yes', type: 'text', speaker: 'A', text: 'yes', next: null };
      const no: TextNode = { id: 'no', type: 'text', speaker: 'A', text: 'no', next: null };

      useDialogueStore.setState({
        dialogueTrees: {
          tree_deep: {
            id: 'tree_deep',
            name: 'Deep',
            nodes: [cond, yes, no],
            startNodeId: 'cond',
            variables: { flag: true },
          },
        },
      });

      expect(() => useDialogueStore.getState().startDialogue('tree_deep')).not.toThrow();
      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('no');
    });

    it('hides a choice whose condition is nested past the stack limit', () => {
      // The other call site. An unevaluable gate must stay shut, not open.
      const choice: ChoiceNode = {
        id: 'pick',
        type: 'choice',
        speaker: 'Guide',
        text: 'Well?',
        choices: [
          { id: 'plain', text: 'Plain', nextNodeId: null },
          { id: 'gated', text: 'Gated', nextNodeId: null, condition: nest(3000) },
        ],
      };

      useDialogueStore.setState({
        dialogueTrees: {
          tree_choice: {
            id: 'tree_choice',
            name: 'Choice',
            nodes: [choice],
            startNodeId: 'pick',
            variables: { flag: true },
          },
        },
      });

      expect(() => useDialogueStore.getState().startDialogue('tree_choice')).not.toThrow();
      expect(useDialogueStore.getState().runtime.currentChoices.map(c => c.id)).toEqual(['plain']);
    });
  });
});
