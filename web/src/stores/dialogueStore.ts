import { create } from 'zustand';

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

function evaluateCondition(condition: Condition, variables: Record<string, unknown>): boolean {
  switch (condition.type) {
    case 'equals':
      return variables[condition.variable] === condition.value;
    case 'not_equals':
      return variables[condition.variable] !== condition.value;
    case 'greater':
      return typeof variables[condition.variable] === 'number' &&
             variables[condition.variable] as number > condition.value;
    case 'less':
      return typeof variables[condition.variable] === 'number' &&
             variables[condition.variable] as number < condition.value;
    case 'has_item': {
      const items = variables.items;
      return Array.isArray(items) && items.includes(condition.itemId);
    }
    case 'and':
      return condition.conditions.every(c => evaluateCondition(c, variables));
    case 'or':
      return condition.conditions.some(c => evaluateCondition(c, variables));
    default:
      return false;
  }
}

function executeActions(actions: DialogueAction[], variables: Record<string, unknown>): void {
  for (const action of actions) {
    switch (action.type) {
      case 'set_state':
        variables[action.key] = action.value;
        break;
      case 'add_item': {
        if (!Array.isArray(variables.items)) {
          variables.items = [];
        }
        const items = variables.items as unknown[];
        if (!items.includes(action.itemId)) {
          items.push(action.itemId);
        }
        break;
      }
      case 'remove_item': {
        if (Array.isArray(variables.items)) {
          const items = variables.items as unknown[];
          const idx = items.indexOf(action.itemId);
          if (idx !== -1) {
            items.splice(idx, 1);
          }
        }
        break;
      }
      case 'increment': {
        const current = variables[action.key];
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
        if (!Array.isArray(variables._triggeredEvents)) {
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
      const tree = state.dialogueTrees[treeId];
      if (!tree) return state;

      return {
        dialogueTrees: {
          ...state.dialogueTrees,
          [treeId]: { ...tree, ...updates },
        },
      };
    });
    get().saveToLocalStorage();
  },

  duplicateTree: (treeId: string) => {
    const tree = get().dialogueTrees[treeId];
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
            choices: node.choices.map(c => ({
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
      const tree = state.dialogueTrees[treeId];
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
      const tree = state.dialogueTrees[treeId];
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
      const tree = state.dialogueTrees[treeId];
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
              choices: node.choices.map(c =>
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
    const tree = get().dialogueTrees[treeId];
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

    const tree = dialogueTrees[runtime.activeTreeId];
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

    const tree = dialogueTrees[runtime.activeTreeId];
    if (!tree) return;

    const currentNode = tree.nodes.find(n => n.id === runtime.currentNodeId);
    if (!currentNode || currentNode.type !== 'choice') return;

    const choice = currentNode.choices.find(c => c.id === choiceId);
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

    const tree = dialogueTrees[runtime.activeTreeId];
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
        const trees = JSON.parse(data) as Record<string, DialogueTree>;
        set({ dialogueTrees: trees });
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
    const tree = get().dialogueTrees[treeId];
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
      const tree = JSON.parse(jsonData) as DialogueTree;
      const newTreeId = generateId('tree');

      const newTree: DialogueTree = {
        ...tree,
        id: newTreeId,
        name: `${tree.name} (Imported)`,
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
    const { runtime, dialogueTrees } = get();
    if (!runtime.activeTreeId || !runtime.currentNodeId) return;

    const tree = dialogueTrees[runtime.activeTreeId];
    if (!tree) return;

    const currentNode = tree.nodes.find(n => n.id === runtime.currentNodeId);
    if (!currentNode) return;

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
        break;
      }

      case 'choice': {
        // Filter choices by condition
        const availableChoices = currentNode.choices.filter(c => {
          if (!c.condition) return true;
          return evaluateCondition(c.condition, tree.variables);
        });

        set(state => ({
          runtime: {
            ...state.runtime,
            currentChoices: availableChoices,
          },
        }));
        break;
      }

      case 'condition': {
        // Evaluate and route
        const result = evaluateCondition(currentNode.condition, tree.variables);
        const nextNodeId = result ? currentNode.onTrue : currentNode.onFalse;

        if (nextNodeId) {
          set(state => ({
            runtime: {
              ...state.runtime,
              currentNodeId: nextNodeId,
            },
          }));
          get().processCurrentNode(); // Recurse
        } else {
          get().endDialogue();
        }
        break;
      }

      case 'action': {
        // Execute actions and route
        executeActions(currentNode.actions, tree.variables);

        if (currentNode.next) {
          set(state => ({
            runtime: {
              ...state.runtime,
              currentNodeId: currentNode.next,
            },
          }));
          get().processCurrentNode(); // Recurse
        } else {
          get().endDialogue();
        }
        break;
      }

      case 'end': {
        get().endDialogue();
        break;
      }
    }
  },
}));

