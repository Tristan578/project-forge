/**
 * Tests for dialogueHandlers — create/delete/get dialogue trees,
 * add nodes, set choices, voice assets, and import/export.
 *
 * Note: securityDialogueHandlers.test.ts also tests this module
 * in depth. This file provides standalone coverage and exercises
 * the exported binding directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { dialogueHandlers } from '../dialogueHandlers';

// ---------------------------------------------------------------------------
// Mock the dialogue store
// ---------------------------------------------------------------------------

const mockAddTree = vi.fn();
const mockRemoveTree = vi.fn();
const mockAddNode = vi.fn();
const mockUpdateNode = vi.fn();
const mockExportTree = vi.fn();
const mockImportTree = vi.fn();

let mockDialogueTrees: Record<string, {
  id: string;
  name: string;
  nodes: Array<{
    id: string;
    type: string;
    speaker?: string;
    text?: string;
    next?: string | null;
    choices?: Array<{ id: string; text: string; nextNodeId: string | null }>;
  }>;
  startNodeId: string;
  variables: Record<string, unknown>;
}> = {};

// `getTree` is pulled from the REAL module rather than stubbed. The handlers'
// prototype-chain guard IS `getTree`, so a hand-written stub here would let the
// mock drift from the guard and these tests would pass against a store that no
// longer has one. `choicesOf` is pulled in for the same reason: it is the guard on
// a node's `choices`, which `getTree` never vouched for.
vi.mock('@/stores/dialogueStore', async () => ({
  getTree: (await vi.importActual<typeof import('@/stores/dialogueStore')>(
    '@/stores/dialogueStore',
  )).getTree,
  choicesOf: (await vi.importActual<typeof import('@/stores/dialogueStore')>(
    '@/stores/dialogueStore',
  )).choicesOf,
  useDialogueStore: {
    getState: () => ({
      dialogueTrees: mockDialogueTrees,
      addTree: (...args: unknown[]) => mockAddTree(...args),
      removeTree: (...args: unknown[]) => mockRemoveTree(...args),
      addNode: (...args: unknown[]) => mockAddNode(...args),
      updateNode: (...args: unknown[]) => mockUpdateNode(...args),
      exportTree: (...args: unknown[]) => mockExportTree(...args),
      importTree: (...args: unknown[]) => mockImportTree(...args),
    }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockDialogueTrees = {};
  mockAddTree.mockReturnValue('tree_default');
  mockExportTree.mockReturnValue('{}');
  mockImportTree.mockReturnValue('tree_imported');
});

// ===========================================================================
// create_dialogue_tree
// ===========================================================================

describe('create_dialogue_tree', () => {
  it('requires name to be non-empty string', async () => {
    const noName = await invokeHandler(dialogueHandlers, 'create_dialogue_tree', {});
    expect(noName.result.success).toBe(false);

    const emptyName = await invokeHandler(dialogueHandlers, 'create_dialogue_tree', { name: '' });
    expect(emptyName.result.success).toBe(false);
  });

  it('returns success with treeId from addTree', async () => {
    mockAddTree.mockReturnValue('tree_42');
    const { result } = await invokeHandler(dialogueHandlers, 'create_dialogue_tree', {
      name: 'Intro',
    });
    expect(result.success).toBe(true);
    const data = result.result as { treeId: string };
    expect(data.treeId).toBe('tree_42');
  });

  it('passes startNodeText to addTree', async () => {
    await invokeHandler(dialogueHandlers, 'create_dialogue_tree', {
      name: 'Quest',
      startNodeText: 'Greetings traveller!',
    });
    expect(mockAddTree).toHaveBeenCalledWith('Quest', 'Greetings traveller!');
  });

  it('passes undefined startNodeText when not provided', async () => {
    await invokeHandler(dialogueHandlers, 'create_dialogue_tree', { name: 'Side Quest' });
    expect(mockAddTree).toHaveBeenCalledWith('Side Quest', undefined);
  });

  it('result message references the tree name', async () => {
    const { result } = await invokeHandler(dialogueHandlers, 'create_dialogue_tree', {
      name: 'VillageElderTree',
    });
    const data = result.result as { message: string };
    expect(data.message).toContain('VillageElderTree');
  });
});

// ===========================================================================
// add_dialogue_node
// ===========================================================================

describe('add_dialogue_node', () => {
  it('requires treeId', async () => {
    const { result } = await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
      nodeType: 'text',
    });
    expect(result.success).toBe(false);
  });

  it('requires nodeType', async () => {
    const { result } = await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
      treeId: 'tree_1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown nodeType with descriptive error', async () => {
    const { result } = await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
      treeId: 'tree_1',
      nodeType: 'narration',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown node type');
    expect(result.error).toContain('narration');
  });

  it('generates unique nodeIds across calls', async () => {
    const calls = await Promise.all([
      invokeHandler(dialogueHandlers, 'add_dialogue_node', { treeId: 'tree_1', nodeType: 'end' }),
      invokeHandler(dialogueHandlers, 'add_dialogue_node', { treeId: 'tree_1', nodeType: 'end' }),
    ]);
    const id1 = (calls[0].result.result as { nodeId: string }).nodeId;
    const id2 = (calls[1].result.result as { nodeId: string }).nodeId;
    expect(id1).not.toBe(id2);
  });

  it('creates all five node types without error', async () => {
    const types = ['text', 'choice', 'condition', 'action', 'end'];
    for (const nodeType of types) {
      const { result } = await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
        treeId: 'tree_1',
        nodeType,
      });
      expect(result.success).toBe(true);
    }
  });

  it('text node defaults: speaker=NPC, text="", next=null', async () => {
    await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
      treeId: 'tree_1',
      nodeType: 'text',
    });
    const [, node] = mockAddNode.mock.calls[0] as [
      string,
      { type: string; speaker: string; text: string; next: null },
    ];
    expect(node.type).toBe('text');
    expect(node.speaker).toBe('NPC');
    expect(node.text).toBe('');
    expect(node.next).toBeNull();
  });

  it('choice node has empty choices array', async () => {
    await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
      treeId: 'tree_1',
      nodeType: 'choice',
    });
    const [, node] = mockAddNode.mock.calls[0] as [string, { choices: unknown[] }];
    expect(node.choices).toEqual([]);
  });

  it('condition node has default condition structure', async () => {
    await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
      treeId: 'tree_1',
      nodeType: 'condition',
    });
    const [, node] = mockAddNode.mock.calls[0] as [string, { condition: { type: string }; onTrue: null; onFalse: null }];
    expect(node.condition.type).toBe('equals');
    expect(node.onTrue).toBeNull();
    expect(node.onFalse).toBeNull();
  });

  it('action node has empty actions array and null next', async () => {
    await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
      treeId: 'tree_1',
      nodeType: 'action',
    });
    const [, node] = mockAddNode.mock.calls[0] as [string, { actions: unknown[]; next: null }];
    expect(node.actions).toEqual([]);
    expect(node.next).toBeNull();
  });

  it('connects from node if connectFromNodeId points to a text node with next field', async () => {
    const fromNodeId = 'node_from';
    mockDialogueTrees = {
      tree_1: {
        id: 'tree_1',
        name: 'Test',
        nodes: [{ id: fromNodeId, type: 'text', speaker: 'NPC', text: 'Hi', next: null }],
        startNodeId: fromNodeId,
        variables: {},
      },
    };
    await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
      treeId: 'tree_1',
      nodeType: 'text',
      connectFromNodeId: fromNodeId,
    });
    expect(mockUpdateNode).toHaveBeenCalledTimes(1);
    const [, connectedId, updates] = mockUpdateNode.mock.calls[0] as [string, string, { next: string }];
    expect(connectedId).toBe(fromNodeId);
    expect(updates.next).not.toBe('');
  });

  it('skips connection when fromNode has no next field (e.g. end node)', async () => {
    mockDialogueTrees = {
      tree_1: {
        id: 'tree_1',
        name: 'Test',
        nodes: [{ id: 'node_end', type: 'end' }],
        startNodeId: 'node_end',
        variables: {},
      },
    };
    await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
      treeId: 'tree_1',
      nodeType: 'text',
      connectFromNodeId: 'node_end',
    });
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// set_dialogue_choice
// ===========================================================================

describe('set_dialogue_choice', () => {
  it('requires treeId, nodeId, and choiceText', async () => {
    const cases = [
      { nodeId: 'n1', choiceText: 'Yes' },
      { treeId: 'tree_1', choiceText: 'Yes' },
      { treeId: 'tree_1', nodeId: 'n1' },
      { treeId: 'tree_1', nodeId: 'n1', choiceText: '' },
    ];
    for (const args of cases) {
      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_choice', args);
      expect(result.success).toBe(false);
    }
  });

  it('returns error when tree not found', async () => {
    const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_choice', {
      treeId: 'tree_missing',
      nodeId: 'n1',
      choiceText: 'Go',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Tree not found');
  });

  it('returns error when node is not a choice node', async () => {
    mockDialogueTrees = {
      tree_1: {
        id: 'tree_1',
        name: 'T',
        nodes: [{ id: 'n1', type: 'text', speaker: 'NPC', text: 'Hi', next: null }],
        startNodeId: 'n1',
        variables: {},
      },
    };
    const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_choice', {
      treeId: 'tree_1',
      nodeId: 'n1',
      choiceText: 'Attack',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Choice node not found');
  });

  it('appends choice and calls updateNode', async () => {
    mockDialogueTrees = {
      tree_1: {
        id: 'tree_1',
        name: 'T',
        nodes: [{ id: 'n1', type: 'choice', choices: [] }],
        startNodeId: 'n1',
        variables: {},
      },
    };
    const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_choice', {
      treeId: 'tree_1',
      nodeId: 'n1',
      choiceText: 'Attack',
      nextNodeId: 'n2',
    });
    expect(result.success).toBe(true);
    const data = result.result as { choiceId: string; message: string };
    expect(data.choiceId).not.toBe('');
    expect(data.message).toBe('Choice added');
    const [, , updates] = mockUpdateNode.mock.calls[0] as [
      string,
      string,
      { choices: Array<{ text: string; nextNodeId: string }> },
    ];
    expect(updates.choices[0].text).toBe('Attack');
    expect(updates.choices[0].nextNodeId).toBe('n2');
  });

  it('does not spread a non-array choices field into the update it persists', async () => {
    // `getTree` vouches for the tree, never for this node's `choices` — that field is
    // whatever the imported or generated JSON said. A bare `[...choiceNode.choices]`
    // turns `"ab"` into `['a','b']`, and the `updateNode` here WRITES that back, so
    // the malformed shape outlives the reload that would otherwise have cleared it.
    mockDialogueTrees = {
      tree_1: {
        id: 'tree_1',
        name: 'T',
        nodes: [{ id: 'n1', type: 'choice', choices: 'ab' as unknown as [] }],
        startNodeId: 'n1',
        variables: {},
      },
    };
    const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_choice', {
      treeId: 'tree_1',
      nodeId: 'n1',
      choiceText: 'Attack',
    });

    expect(result.success).toBe(true);
    const [, , updates] = mockUpdateNode.mock.calls[0] as [
      string,
      string,
      { choices: Array<{ text: string }> },
    ];
    expect(updates.choices).toHaveLength(1);
    expect(updates.choices[0].text).toBe('Attack');
  });
});

// ===========================================================================
// remove_dialogue_tree
// ===========================================================================

describe('remove_dialogue_tree', () => {
  it('requires non-empty treeId', async () => {
    const no = await invokeHandler(dialogueHandlers, 'remove_dialogue_tree', {});
    expect(no.result.success).toBe(false);
    const empty = await invokeHandler(dialogueHandlers, 'remove_dialogue_tree', { treeId: '' });
    expect(empty.result.success).toBe(false);
  });

  it('calls removeTree and returns success message', async () => {
    const { result } = await invokeHandler(dialogueHandlers, 'remove_dialogue_tree', {
      treeId: 'tree_99',
    });
    expect(result.success).toBe(true);
    expect(mockRemoveTree).toHaveBeenCalledWith('tree_99');
    const data = result.result as { message: string };
    expect(data.message).toBe('Dialogue tree removed');
  });
});

// ===========================================================================
// get_dialogue_tree
// ===========================================================================

describe('get_dialogue_tree', () => {
  it('returns error when tree not found', async () => {
    const { result } = await invokeHandler(dialogueHandlers, 'get_dialogue_tree', {
      treeId: 'nope',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Tree not found');
  });

  it('returns full tree when found', async () => {
    const tree = { id: 't1', name: 'Quest', nodes: [], startNodeId: 'n0', variables: { score: 0 } };
    mockDialogueTrees = { t1: tree };
    const { result } = await invokeHandler(dialogueHandlers, 'get_dialogue_tree', { treeId: 't1' });
    expect(result.success).toBe(true);
    expect(result.result).toEqual(tree);
  });
});

// ===========================================================================
// set_dialogue_node_voice
// ===========================================================================

describe('set_dialogue_node_voice', () => {
  it('requires treeId, nodeId, and voiceAssetId', async () => {
    const cases = [
      { nodeId: 'n1', voiceAssetId: 'v1' },
      { treeId: 't1', voiceAssetId: 'v1' },
      { treeId: 't1', nodeId: 'n1' },
      { treeId: 't1', nodeId: 'n1', voiceAssetId: '' },
    ];
    for (const args of cases) {
      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_node_voice', args);
      expect(result.success).toBe(false);
    }
  });

  it('calls updateNode with voiceAsset and returns success', async () => {
    const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_node_voice', {
      treeId: 't1',
      nodeId: 'n1',
      voiceAssetId: 'voice_wizard',
    });
    expect(result.success).toBe(true);
    expect(mockUpdateNode).toHaveBeenCalledWith('t1', 'n1', { voiceAsset: 'voice_wizard' });
    const data = result.result as { message: string };
    expect(data.message).toBe('Voice asset assigned');
  });
});

// ===========================================================================
// export_dialogue_tree
// ===========================================================================

describe('export_dialogue_tree', () => {
  it('requires treeId', async () => {
    const { result } = await invokeHandler(dialogueHandlers, 'export_dialogue_tree', {});
    expect(result.success).toBe(false);
  });

  it('returns error when exportTree returns null', async () => {
    mockExportTree.mockReturnValue(null);
    const { result } = await invokeHandler(dialogueHandlers, 'export_dialogue_tree', {
      treeId: 'missing',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Tree not found');
  });

  it('returns json string on success', async () => {
    const json = '{"id":"t1","nodes":[]}';
    mockExportTree.mockReturnValue(json);
    const { result } = await invokeHandler(dialogueHandlers, 'export_dialogue_tree', {
      treeId: 't1',
    });
    expect(result.success).toBe(true);
    const data = result.result as { json: string };
    expect(data.json).toBe(json);
    expect(mockExportTree).toHaveBeenCalledWith('t1');
  });
});

// ===========================================================================
// import_dialogue_tree
// ===========================================================================

describe('import_dialogue_tree', () => {
  it('requires non-empty jsonData', async () => {
    const no = await invokeHandler(dialogueHandlers, 'import_dialogue_tree', {});
    expect(no.result.success).toBe(false);
    const empty = await invokeHandler(dialogueHandlers, 'import_dialogue_tree', { jsonData: '' });
    expect(empty.result.success).toBe(false);
  });

  it('returns error when importTree returns null (parse failure)', async () => {
    mockImportTree.mockReturnValue(null);
    const { result } = await invokeHandler(dialogueHandlers, 'import_dialogue_tree', {
      jsonData: 'bad_json',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to import tree');
  });

  it('returns treeId and success message on valid import', async () => {
    mockImportTree.mockReturnValue('tree_imported_77');
    const { result } = await invokeHandler(dialogueHandlers, 'import_dialogue_tree', {
      jsonData: '{"id":"old"}',
    });
    expect(result.success).toBe(true);
    const data = result.result as { treeId: string; message: string };
    expect(data.treeId).toBe('tree_imported_77');
    expect(data.message).toBe('Dialogue tree imported');
    expect(mockImportTree).toHaveBeenCalledWith('{"id":"old"}');
  });
});

// ===========================================================================
// PF-1144 — an inherited key is not a tree
// ===========================================================================

describe('tree ids from tool arguments do not reach the prototype chain', () => {
  // `treeId` is `z.string().min(1)` with no character restriction, and these
  // handlers are driven by model output. A bare `dialogueTrees[treeId]` answers
  // `Object.prototype` for `"__proto__"` and a function for `"constructor"` —
  // both truthy, so the `if (!tree)` below each lookup passed them straight
  // through to `tree.nodes.find(...)`, which throws on a value with no `nodes`.
  const INHERITED = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf'];

  for (const treeId of INHERITED) {
    it(`get_dialogue_tree("${treeId}") reports not-found instead of handing back a builtin`, async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'get_dialogue_tree', { treeId });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Tree not found');
    });

    it(`set_dialogue_choice("${treeId}") reports not-found instead of throwing`, async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_choice', {
        treeId, nodeId: 'n1', choiceText: 'Yes',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Tree not found');
      expect(mockUpdateNode).not.toHaveBeenCalled();
    });

    it(`add_dialogue_node("${treeId}") skips the connect step instead of throwing`, async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
        treeId, nodeType: 'text', text: 'hi', connectFromNodeId: 'n0',
      });
      // The node write itself is the store's business; what must not happen is a
      // throw out of the connect step, or a connect against an inherited value.
      expect(result.success).toBe(true);
      expect(mockUpdateNode).not.toHaveBeenCalled();
    });
  }

  it('a real tree stored under the id "__proto__" is still reachable', async () => {
    // The guard rejects INHERITED keys, not the spelling — an own key wins.
    const tree = { id: '__proto__', name: 'Odd', nodes: [], startNodeId: 'n0', variables: {} };
    // Built with defineProperty because `{ __proto__: tree }` in a literal sets
    // the prototype rather than creating the own key this test is about.
    const bag = {} as typeof mockDialogueTrees;
    Object.defineProperty(bag, '__proto__', {
      value: tree, enumerable: true, writable: true, configurable: true,
    });
    mockDialogueTrees = bag;

    const { result } = await invokeHandler(dialogueHandlers, 'get_dialogue_tree', {
      treeId: '__proto__',
    });
    expect(result.success).toBe(true);
    // Identity, not deep equality: the point is that the OWN value came back,
    // and a `toEqual` would also pass against a lookalike built by the guard.
    expect(result.result).toBe(tree);
  });
});
