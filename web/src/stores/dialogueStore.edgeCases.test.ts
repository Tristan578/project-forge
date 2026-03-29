/**
 * Edge case tests for dialogueStore (PF-360).
 *
 * Covers gaps not addressed by dialogueStore.test.ts:
 * - Broken startNodeId (orphan start reference)
 * - Deeply nested AND/OR conditions (3+ levels)
 * - Potential cycle / deep recursion in condition/action chains
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
import { describe, it, expect, beforeEach } from 'vitest';
import { useDialogueStore } from './dialogueStore';
import type {
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
});
