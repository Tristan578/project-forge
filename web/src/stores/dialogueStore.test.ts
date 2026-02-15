import { describe, it, expect, beforeEach } from 'vitest';
import { useDialogueStore } from './dialogueStore';
import type { TextNode, ChoiceNode, ConditionNode, ActionNode, EndNode } from './dialogueStore';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

global.localStorage = localStorageMock as Storage;

describe('dialogueStore', () => {
  beforeEach(() => {
    // Reset store
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
    // Clear localStorage
    localStorage.clear();
  });

  describe('tree CRUD', () => {
    it('addTree creates tree with start node', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];

      expect(tree).toBeDefined();
      expect(tree.name).toBe('Test Tree');
      expect(tree.nodes).toHaveLength(1);
      expect(tree.nodes[0].type).toBe('text');
      expect(tree.startNodeId).toBe(tree.nodes[0].id);
    });

    it('addTree with startNodeText sets text', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Custom start text');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNode = tree.nodes[0] as TextNode;

      expect(startNode.text).toBe('Custom start text');
    });

    it('removeTree deletes tree', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree');
      expect(useDialogueStore.getState().dialogueTrees[treeId]).toBeDefined();

      useDialogueStore.getState().removeTree(treeId);
      expect(useDialogueStore.getState().dialogueTrees[treeId]).toBeUndefined();
    });

    it('removeTree clears selection if deleting selected tree', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree');
      useDialogueStore.setState({ selectedTreeId: treeId });

      useDialogueStore.getState().removeTree(treeId);
      expect(useDialogueStore.getState().selectedTreeId).toBeNull();
    });

    it('updateTree merges changes', () => {
      const treeId = useDialogueStore.getState().addTree('Original Name');
      useDialogueStore.getState().updateTree(treeId, {
        name: 'Updated Name',
        variables: { testVar: 42 },
      });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(tree.name).toBe('Updated Name');
      expect(tree.variables.testVar).toBe(42);
    });

    it('duplicateTree creates copy', () => {
      const treeId = useDialogueStore.getState().addTree('Original Tree');
      const newTreeId = useDialogueStore.getState().duplicateTree(treeId);

      expect(newTreeId).not.toBeNull();
      const newTree = useDialogueStore.getState().dialogueTrees[newTreeId!];
      expect(newTree.name).toBe('Original Tree (Copy)');
      expect(newTree.nodes).toHaveLength(1);
      expect(newTree.id).not.toBe(treeId);
    });

    it('duplicateTree with invalid tree returns null', () => {
      const result = useDialogueStore.getState().duplicateTree('invalid_id');
      expect(result).toBeNull();
    });

    it('tree IDs are unique', () => {
      const id1 = useDialogueStore.getState().addTree('Tree 1');
      const id2 = useDialogueStore.getState().addTree('Tree 2');
      const id3 = useDialogueStore.getState().addTree('Tree 3');

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });
  });

  describe('node CRUD', () => {
    it('addNode adds to tree', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree');
      const newNode: TextNode = {
        id: 'node_test',
        type: 'text',
        speaker: 'Alice',
        text: 'Hello!',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, newNode);
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(tree.nodes).toHaveLength(2);
      expect(tree.nodes[1]).toEqual(newNode);
    });

    it('addNode to invalid tree does nothing', () => {
      const newNode: TextNode = {
        id: 'node_test',
        type: 'text',
        speaker: 'Alice',
        text: 'Hello!',
        next: null,
      };

      useDialogueStore.getState().addNode('invalid_id', newNode);
      expect(Object.keys(useDialogueStore.getState().dialogueTrees)).toHaveLength(0);
    });

    it('updateNode modifies node', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const nodeId = tree.nodes[0].id;

      useDialogueStore.getState().updateNode(treeId, nodeId, {
        speaker: 'Bob',
        text: 'Updated text',
      });

      const updatedTree = useDialogueStore.getState().dialogueTrees[treeId];
      const updatedNode = updatedTree.nodes[0] as TextNode;
      expect(updatedNode.speaker).toBe('Bob');
      expect(updatedNode.text).toBe('Updated text');
    });

    it('removeNode removes and cleans refs', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      // Add a second node that references the first
      const node2: TextNode = {
        id: 'node_2',
        type: 'text',
        speaker: 'Alice',
        text: 'Second node',
        next: startNodeId,
      };
      useDialogueStore.getState().addNode(treeId, node2);

      // Update start node to point to node2
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'node_2' });

      // Remove node2
      useDialogueStore.getState().removeNode(treeId, 'node_2');

      const updatedTree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(updatedTree.nodes).toHaveLength(1);
      const startNode = updatedTree.nodes[0] as TextNode;
      expect(startNode.next).toBeNull(); // Reference cleaned up
    });

    it('removeNode prevents deleting start node', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      useDialogueStore.getState().removeNode(treeId, startNodeId);

      const updatedTree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(updatedTree.nodes).toHaveLength(1); // Start node still there
    });

    it('removeNode clears selection if deleting selected node', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree');
      const nodeId = 'node_test';
      const newNode: TextNode = {
        id: nodeId,
        type: 'text',
        speaker: 'Alice',
        text: 'Hello!',
        next: null,
      };
      useDialogueStore.getState().addNode(treeId, newNode);
      useDialogueStore.setState({ selectedNodeId: nodeId });

      useDialogueStore.getState().removeNode(treeId, nodeId);
      expect(useDialogueStore.getState().selectedNodeId).toBeNull();
    });
  });

  describe('runtime', () => {
    it('startDialogue activates runtime', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Welcome!');
      useDialogueStore.getState().startDialogue(treeId);

      const { runtime } = useDialogueStore.getState();
      expect(runtime.isActive).toBe(true);
      expect(runtime.activeTreeId).toBe(treeId);
      expect(runtime.currentNodeId).not.toBeNull();
      expect(runtime.displayedText).toBe('Welcome!');
    });

    it('startDialogue with invalid tree does nothing', () => {
      useDialogueStore.getState().startDialogue('invalid_id');
      const { runtime } = useDialogueStore.getState();
      expect(runtime.isActive).toBe(false);
    });

    it('advanceDialogue moves to next text node', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'First node');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      // Add second node
      const node2: TextNode = {
        id: 'node_2',
        type: 'text',
        speaker: 'Bob',
        text: 'Second node',
        next: null,
      };
      useDialogueStore.getState().addNode(treeId, node2);

      // Link start node to node2
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'node_2' });

      // Start dialogue
      useDialogueStore.getState().startDialogue(treeId);
      expect(useDialogueStore.getState().runtime.currentNodeId).toBe(startNodeId);

      // Advance
      useDialogueStore.getState().advanceDialogue();
      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('node_2');
      expect(useDialogueStore.getState().runtime.displayedText).toBe('Second node');
    });

    it('advanceDialogue on end node ends dialogue', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'First node');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      // Add end node
      const endNode: EndNode = {
        id: 'end_node',
        type: 'end',
      };
      useDialogueStore.getState().addNode(treeId, endNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'end_node' });

      // Start and advance to end
      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
    });

    it('advanceDialogue with no next ends dialogue', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Only node');
      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.isActive).toBe(false);
    });

    it('selectChoice routes to next node', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Start');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      // Add choice node
      const choiceNode: ChoiceNode = {
        id: 'choice_node',
        type: 'choice',
        text: 'What do you say?',
        choices: [
          { id: 'choice_1', text: 'Hello', nextNodeId: 'node_hello' },
          { id: 'choice_2', text: 'Goodbye', nextNodeId: 'node_goodbye' },
        ],
      };

      const helloNode: TextNode = {
        id: 'node_hello',
        type: 'text',
        speaker: 'Alice',
        text: 'Hello to you too!',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, choiceNode);
      useDialogueStore.getState().addNode(treeId, helloNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'choice_node' });

      // Start dialogue and advance to choice
      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      const { runtime } = useDialogueStore.getState();
      expect(runtime.currentNodeId).toBe('choice_node');
      expect(runtime.currentChoices).toHaveLength(2);

      // Select choice
      useDialogueStore.getState().selectChoice('choice_1');
      const updatedRuntime = useDialogueStore.getState().runtime;
      expect(updatedRuntime.currentNodeId).toBe('node_hello');
      expect(updatedRuntime.displayedText).toBe('Hello to you too!');
    });

    it('skipTypewriter shows full text', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Long text');
      useDialogueStore.getState().startDialogue(treeId);

      // Simulate typewriter in progress
      useDialogueStore.setState(state => ({
        runtime: { ...state.runtime, displayedText: 'Long', typewriterComplete: false },
      }));

      useDialogueStore.getState().skipTypewriter();
      const { runtime } = useDialogueStore.getState();
      expect(runtime.displayedText).toBe('Long text');
      expect(runtime.typewriterComplete).toBe(true);
    });

    it('endDialogue resets runtime', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree');
      useDialogueStore.getState().startDialogue(treeId);
      expect(useDialogueStore.getState().runtime.isActive).toBe(true);

      useDialogueStore.getState().endDialogue();
      const { runtime } = useDialogueStore.getState();
      expect(runtime.isActive).toBe(false);
      expect(runtime.activeTreeId).toBeNull();
      expect(runtime.currentNodeId).toBeNull();
      expect(runtime.displayedText).toBe('');
      expect(runtime.currentChoices).toHaveLength(0);
      expect(runtime.history).toHaveLength(0);
    });
  });

  describe('condition evaluation', () => {
    it('equals condition works', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Start');
      useDialogueStore.getState().updateTree(treeId, { variables: { test: 'value' } });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const conditionNode: ConditionNode = {
        id: 'cond_node',
        type: 'condition',
        condition: { type: 'equals', variable: 'test', value: 'value' },
        onTrue: 'node_true',
        onFalse: 'node_false',
      };

      const trueNode: TextNode = {
        id: 'node_true',
        type: 'text',
        speaker: 'System',
        text: 'Condition true',
        next: null,
      };

      const falseNode: TextNode = {
        id: 'node_false',
        type: 'text',
        speaker: 'System',
        text: 'Condition false',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, conditionNode);
      useDialogueStore.getState().addNode(treeId, trueNode);
      useDialogueStore.getState().addNode(treeId, falseNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond_node' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('node_true');
    });

    it('not_equals condition works', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Start');
      useDialogueStore.getState().updateTree(treeId, { variables: { test: 'value' } });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const conditionNode: ConditionNode = {
        id: 'cond_node',
        type: 'condition',
        condition: { type: 'not_equals', variable: 'test', value: 'other' },
        onTrue: 'node_true',
        onFalse: 'node_false',
      };

      const trueNode: TextNode = {
        id: 'node_true',
        type: 'text',
        speaker: 'System',
        text: 'Not equals works',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, conditionNode);
      useDialogueStore.getState().addNode(treeId, trueNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond_node' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('node_true');
    });

    it('greater/less conditions work', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Start');
      useDialogueStore.getState().updateTree(treeId, { variables: { count: 10 } });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      // Test greater
      const greaterNode: ConditionNode = {
        id: 'greater_node',
        type: 'condition',
        condition: { type: 'greater', variable: 'count', value: 5 },
        onTrue: 'node_true',
        onFalse: null,
      };

      const trueNode: TextNode = {
        id: 'node_true',
        type: 'text',
        speaker: 'System',
        text: 'Greater works',
        next: 'less_node',
      };

      // Test less
      const lessNode: ConditionNode = {
        id: 'less_node',
        type: 'condition',
        condition: { type: 'less', variable: 'count', value: 20 },
        onTrue: 'node_final',
        onFalse: null,
      };

      const finalNode: TextNode = {
        id: 'node_final',
        type: 'text',
        speaker: 'System',
        text: 'Less works',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, greaterNode);
      useDialogueStore.getState().addNode(treeId, trueNode);
      useDialogueStore.getState().addNode(treeId, lessNode);
      useDialogueStore.getState().addNode(treeId, finalNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'greater_node' });

      useDialogueStore.getState().startDialogue(treeId);
      // After starting, we're on the start node. Advance once to get to greaterNode, which auto-routes to node_true
      useDialogueStore.getState().advanceDialogue();
      // Now at node_true, advance again to get to lessNode, which auto-routes to node_final
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('node_final');
    });

    it('has_item condition works', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Start');
      useDialogueStore.getState().updateTree(treeId, { variables: { items: ['key', 'sword'] } });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const conditionNode: ConditionNode = {
        id: 'cond_node',
        type: 'condition',
        condition: { type: 'has_item', itemId: 'key' },
        onTrue: 'node_true',
        onFalse: 'node_false',
      };

      const trueNode: TextNode = {
        id: 'node_true',
        type: 'text',
        speaker: 'System',
        text: 'Has key',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, conditionNode);
      useDialogueStore.getState().addNode(treeId, trueNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond_node' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('node_true');
    });

    it('and condition requires all true', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Start');
      useDialogueStore.getState().updateTree(treeId, {
        variables: { a: true, b: true, c: false },
      });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const conditionNode: ConditionNode = {
        id: 'cond_node',
        type: 'condition',
        condition: {
          type: 'and',
          conditions: [
            { type: 'equals', variable: 'a', value: true },
            { type: 'equals', variable: 'b', value: true },
          ],
        },
        onTrue: 'node_true',
        onFalse: 'node_false',
      };

      const trueNode: TextNode = {
        id: 'node_true',
        type: 'text',
        speaker: 'System',
        text: 'And works',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, conditionNode);
      useDialogueStore.getState().addNode(treeId, trueNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond_node' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('node_true');
    });

    it('or condition requires any true', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Start');
      useDialogueStore.getState().updateTree(treeId, {
        variables: { a: false, b: true, c: false },
      });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const conditionNode: ConditionNode = {
        id: 'cond_node',
        type: 'condition',
        condition: {
          type: 'or',
          conditions: [
            { type: 'equals', variable: 'a', value: true },
            { type: 'equals', variable: 'b', value: true },
            { type: 'equals', variable: 'c', value: true },
          ],
        },
        onTrue: 'node_true',
        onFalse: 'node_false',
      };

      const trueNode: TextNode = {
        id: 'node_true',
        type: 'text',
        speaker: 'System',
        text: 'Or works',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, conditionNode);
      useDialogueStore.getState().addNode(treeId, trueNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'cond_node' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('node_true');
    });
  });

  describe('action execution', () => {
    it('set_state action updates variables', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Start');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const actionNode: ActionNode = {
        id: 'action_node',
        type: 'action',
        actions: [{ type: 'set_state', key: 'testKey', value: 'testValue' }],
        next: 'node_after',
      };

      const afterNode: TextNode = {
        id: 'node_after',
        type: 'text',
        speaker: 'System',
        text: 'After action',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, actionNode);
      useDialogueStore.getState().addNode(treeId, afterNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'action_node' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      const updatedTree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(updatedTree.variables.testKey).toBe('testValue');
      expect(useDialogueStore.getState().runtime.currentNodeId).toBe('node_after');
    });

    it('add_item action works', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Start');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const actionNode: ActionNode = {
        id: 'action_node',
        type: 'action',
        actions: [{ type: 'add_item', itemId: 'sword' }],
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, actionNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'action_node' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      const updatedTree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(updatedTree.variables.items).toEqual(['sword']);
    });

    it('remove_item action works', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Start');
      useDialogueStore.getState().updateTree(treeId, {
        variables: { items: ['key', 'sword', 'shield'] },
      });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const actionNode: ActionNode = {
        id: 'action_node',
        type: 'action',
        actions: [{ type: 'remove_item', itemId: 'sword' }],
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, actionNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'action_node' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      const updatedTree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(updatedTree.variables.items).toEqual(['key', 'shield']);
    });

    it('increment action works', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Start');
      useDialogueStore.getState().updateTree(treeId, { variables: { score: 10 } });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const actionNode: ActionNode = {
        id: 'action_node',
        type: 'action',
        actions: [{ type: 'increment', key: 'score', amount: 5 }],
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, actionNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'action_node' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      const updatedTree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(updatedTree.variables.score).toBe(15);
    });

    it('increment action initializes to amount if not number', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Start');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const actionNode: ActionNode = {
        id: 'action_node',
        type: 'action',
        actions: [{ type: 'increment', key: 'newScore', amount: 5 }],
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, actionNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'action_node' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      const updatedTree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(updatedTree.variables.newScore).toBe(5);
    });

    it('trigger_event action stores event', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Start');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const actionNode: ActionNode = {
        id: 'action_node',
        type: 'action',
        actions: [{ type: 'trigger_event', eventName: 'boss_defeated' }],
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, actionNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'action_node' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      const updatedTree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(updatedTree.variables._triggeredEvents).toEqual(['boss_defeated']);
    });
  });

  describe('persistence', () => {
    it('saveToLocalStorage persists trees', () => {
      const treeId = useDialogueStore.getState().addTree('Persistent Tree');
      // addTree already calls saveToLocalStorage
      const stored = localStorage.getItem('forge_dialogue_trees');
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed[treeId]).toBeDefined();
      expect(parsed[treeId].name).toBe('Persistent Tree');
    });

    it('loadFromLocalStorage restores trees', () => {
      // Create tree and save
      const treeId = useDialogueStore.getState().addTree('Test Tree');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];

      // Clear store
      useDialogueStore.setState({ dialogueTrees: {} });
      expect(Object.keys(useDialogueStore.getState().dialogueTrees)).toHaveLength(0);

      // Load from storage
      useDialogueStore.getState().loadFromLocalStorage();
      const loadedTree = useDialogueStore.getState().dialogueTrees[treeId];
      expect(loadedTree).toEqual(tree);
    });
  });

  describe('import/export', () => {
    it('exportTree returns JSON', () => {
      const treeId = useDialogueStore.getState().addTree('Export Test');
      const json = useDialogueStore.getState().exportTree(treeId);

      expect(json).not.toBeNull();
      const parsed = JSON.parse(json!);
      expect(parsed.name).toBe('Export Test');
      expect(parsed.nodes).toHaveLength(1);
    });

    it('exportTree with invalid tree returns null', () => {
      const result = useDialogueStore.getState().exportTree('invalid_id');
      expect(result).toBeNull();
    });

    it('importTree creates tree from JSON', () => {
      const treeId = useDialogueStore.getState().addTree('Original');
      const json = useDialogueStore.getState().exportTree(treeId);

      const newTreeId = useDialogueStore.getState().importTree(json!);
      expect(newTreeId).not.toBeNull();
      expect(newTreeId).not.toBe(treeId);

      const importedTree = useDialogueStore.getState().dialogueTrees[newTreeId!];
      expect(importedTree.name).toBe('Original (Imported)');
      expect(importedTree.nodes).toHaveLength(1);
    });

    it('importTree with invalid JSON returns null', () => {
      const result = useDialogueStore.getState().importTree('invalid json');
      expect(result).toBeNull();
    });
  });

  describe('editor selection', () => {
    it('selectTree sets selected tree and clears node', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree');
      useDialogueStore.setState({ selectedNodeId: 'some_node' });

      useDialogueStore.getState().selectTree(treeId);
      expect(useDialogueStore.getState().selectedTreeId).toBe(treeId);
      expect(useDialogueStore.getState().selectedNodeId).toBeNull();
    });

    it('selectNode sets selected node', () => {
      useDialogueStore.getState().selectNode('node_123');
      expect(useDialogueStore.getState().selectedNodeId).toBe('node_123');
    });
  });

  describe('choice filtering', () => {
    it('filters choices by condition', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'Start');
      useDialogueStore.getState().updateTree(treeId, { variables: { level: 5 } });

      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const choiceNode: ChoiceNode = {
        id: 'choice_node',
        type: 'choice',
        text: 'Choose action',
        choices: [
          { id: 'choice_1', text: 'Easy path', nextNodeId: 'node_easy' },
          {
            id: 'choice_2',
            text: 'Hard path',
            nextNodeId: 'node_hard',
            condition: { type: 'greater', variable: 'level', value: 3 },
          },
          {
            id: 'choice_3',
            text: 'Expert path',
            nextNodeId: 'node_expert',
            condition: { type: 'greater', variable: 'level', value: 10 },
          },
        ],
      };

      useDialogueStore.getState().addNode(treeId, choiceNode);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'choice_node' });

      useDialogueStore.getState().startDialogue(treeId);
      useDialogueStore.getState().advanceDialogue();

      const { runtime } = useDialogueStore.getState();
      // Should have easy path (no condition) and hard path (level > 3)
      // Should NOT have expert path (level > 10)
      expect(runtime.currentChoices).toHaveLength(2);
      expect(runtime.currentChoices[0].id).toBe('choice_1');
      expect(runtime.currentChoices[1].id).toBe('choice_2');
    });
  });

  describe('dialogue history', () => {
    it('tracks history of displayed text', () => {
      const treeId = useDialogueStore.getState().addTree('Test Tree', 'First line');
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      const startNodeId = tree.startNodeId;

      const node2: TextNode = {
        id: 'node_2',
        type: 'text',
        speaker: 'Bob',
        text: 'Second line',
        next: null,
      };

      useDialogueStore.getState().addNode(treeId, node2);
      useDialogueStore.getState().updateNode(treeId, startNodeId, { next: 'node_2' });

      useDialogueStore.getState().startDialogue(treeId);
      expect(useDialogueStore.getState().runtime.history).toHaveLength(1);
      expect(useDialogueStore.getState().runtime.history[0].text).toBe('First line');

      useDialogueStore.getState().advanceDialogue();
      expect(useDialogueStore.getState().runtime.history).toHaveLength(2);
      expect(useDialogueStore.getState().runtime.history[1].speaker).toBe('Bob');
      expect(useDialogueStore.getState().runtime.history[1].text).toBe('Second line');
    });
  });
});
