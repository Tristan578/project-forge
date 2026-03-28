// @vitest-environment jsdom
/**
 * Tests for securityHandlers and dialogueHandlers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler, createMockStore } from './handlerTestUtils';
import { securityHandlers } from '../securityHandlers';
import { dialogueHandlers } from '../dialogueHandlers';

// ---------------------------------------------------------------------------
// Mock the security validator so we control return values
// ---------------------------------------------------------------------------

const mockGetSecurityStatus = vi.fn();
const mockValidateProjectSecurity = vi.fn();

vi.mock('@/lib/security/validator', () => ({
  getSecurityStatus: (...args: unknown[]) => mockGetSecurityStatus(...args),
  validateProjectSecurity: (...args: unknown[]) => mockValidateProjectSecurity(...args),
}));

// ---------------------------------------------------------------------------
// Mock the dialogueStore so tests don't touch localStorage
// ---------------------------------------------------------------------------

const mockAddTree = vi.fn();
const mockRemoveTree = vi.fn();
const mockAddNode = vi.fn();
const mockUpdateNode = vi.fn();
const mockExportTree = vi.fn();
const mockImportTree = vi.fn();

// The store state is mutable so individual tests can shape it
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

vi.mock('@/stores/dialogueStore', () => ({
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

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockDialogueTrees = {};

  // Sensible defaults for security mocks
  mockGetSecurityStatus.mockReturnValue({
    cspEnabled: true,
    corsEnabled: true,
    rateLimitEnabled: true,
    sandboxEnabled: true,
    maxRequestSize: '10KB',
  });

  mockValidateProjectSecurity.mockReturnValue({
    healthy: true,
    issues: [],
    stats: { totalEntities: 0, suspiciousNames: 0, oversizedScripts: 0 },
  });
});

// ===========================================================================
// SECURITY HANDLERS
// ===========================================================================

describe('securityHandlers', () => {
  // -------------------------------------------------------------------------
  // get_security_status
  // -------------------------------------------------------------------------
  describe('get_security_status', () => {
    it('returns success with status message and settings', async () => {
      const { result } = await invokeHandler(securityHandlers, 'get_security_status', {});

      expect(result.success).toBe(true);
      const data = result.result as { status: string; settings: unknown };
      expect(data.status).toBe('Security features enabled');
      expect(data.settings).toBeDefined();
    });

    it('calls getSecurityStatus once', async () => {
      await invokeHandler(securityHandlers, 'get_security_status', {});

      expect(mockGetSecurityStatus).toHaveBeenCalledTimes(1);
    });

    it('includes all security fields in settings', async () => {
      const status = {
        cspEnabled: true,
        corsEnabled: false,
        rateLimitEnabled: true,
        sandboxEnabled: true,
        maxRequestSize: '5KB',
      };
      mockGetSecurityStatus.mockReturnValue(status);

      const { result } = await invokeHandler(securityHandlers, 'get_security_status', {});

      const data = result.result as { settings: typeof status };
      expect(data.settings).toEqual(status);
      expect(data.settings.corsEnabled).toBe(false);
      expect(data.settings.maxRequestSize).toBe('5KB');
    });

    it('ignores any extra args passed (accepts empty record)', async () => {
      const { result } = await invokeHandler(securityHandlers, 'get_security_status', {
        unexpected: 'arg',
      });

      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // validate_project_security
  // -------------------------------------------------------------------------
  describe('validate_project_security', () => {
    it('returns healthy status when no issues found', async () => {
      const { result } = await invokeHandler(
        securityHandlers,
        'validate_project_security',
        {},
      );

      expect(result.success).toBe(true);
      const data = result.result as {
        status: string;
        healthy: boolean;
        issues: unknown[];
        stats: unknown;
      };
      expect(data.status).toBe('No issues found');
      expect(data.healthy).toBe(true);
      expect(data.issues).toHaveLength(0);
    });

    it('reports issue count when validation finds problems', async () => {
      mockValidateProjectSecurity.mockReturnValue({
        healthy: false,
        issues: [
          { severity: 'high', category: 'script_security', message: 'Unsafe dynamic code execution' },
          { severity: 'medium', category: 'entity_name', message: 'Suspicious name' },
        ],
        stats: { totalEntities: 3, suspiciousNames: 1, oversizedScripts: 0 },
      });

      const { result } = await invokeHandler(
        securityHandlers,
        'validate_project_security',
        {},
      );

      expect(result.success).toBe(true);
      const data = result.result as { status: string; healthy: boolean; issues: unknown[] };
      expect(data.status).toBe('Found 2 issue(s)');
      expect(data.healthy).toBe(false);
      expect(data.issues).toHaveLength(2);
    });

    it('passes scene graph nodes derived from store to validator', async () => {
      const store = createMockStore({
        sceneGraph: {
          nodes: {
            'e1': { entityId: 'e1', name: 'Player', components: ['cube'], children: [] },
            'e2': { entityId: 'e2', name: 'Enemy', components: ['sphere'], children: [] },
          },
          rootIds: ['e1', 'e2'],
        },
        allScripts: {},
      });

      await securityHandlers.validate_project_security({}, { store, dispatchCommand: vi.fn() });

      expect(mockValidateProjectSecurity).toHaveBeenCalledTimes(1);
      const [sceneArg] = mockValidateProjectSecurity.mock.calls[0] as [
        Array<{ id: string; name: string; type: string }>,
        unknown,
      ];
      expect(sceneArg).toHaveLength(2);
      const ids = sceneArg.map((n) => n.id);
      expect(ids).toContain('e1');
      expect(ids).toContain('e2');
    });

    it('maps first component to node type, falls back to unknown', async () => {
      const store = createMockStore({
        sceneGraph: {
          nodes: {
            'e1': { entityId: 'e1', name: 'Box', components: ['cube'], children: [] },
            'e2': { entityId: 'e2', name: 'Empty', components: [], children: [] },
          },
          rootIds: ['e1', 'e2'],
        },
        allScripts: {},
      });

      await securityHandlers.validate_project_security({}, { store, dispatchCommand: vi.fn() });

      const [sceneArg] = mockValidateProjectSecurity.mock.calls[0] as [
        Array<{ id: string; name: string; type: string }>,
        unknown,
      ];
      const box = sceneArg.find((n) => n.id === 'e1');
      const empty = sceneArg.find((n) => n.id === 'e2');
      expect(box?.type).toBe('cube');
      expect(empty?.type).toBe('unknown');
    });

    it('passes scripts from store to validator', async () => {
      const scripts = {
        's1': { source: 'console.log("hello")' },
        's2': { source: 'var x = 1;' },
      };
      const store = createMockStore({
        sceneGraph: { nodes: {}, rootIds: [] },
        allScripts: scripts,
      });

      await securityHandlers.validate_project_security({}, { store, dispatchCommand: vi.fn() });

      const [, scriptsArg] = mockValidateProjectSecurity.mock.calls[0] as [unknown, typeof scripts];
      expect(scriptsArg).toEqual(scripts);
    });

    it('includes stats in result', async () => {
      const stats = { totalEntities: 10, suspiciousNames: 2, oversizedScripts: 1 };
      mockValidateProjectSecurity.mockReturnValue({
        healthy: false,
        issues: [{ severity: 'medium', category: 'entity_name', message: 'Bad name' }],
        stats,
      });

      const { result } = await invokeHandler(
        securityHandlers,
        'validate_project_security',
        {},
      );

      const data = result.result as { stats: typeof stats };
      expect(data.stats).toEqual(stats);
    });

    it('handles empty scene graph gracefully', async () => {
      const store = createMockStore({
        sceneGraph: { nodes: {}, rootIds: [] },
        allScripts: {},
      });

      await securityHandlers.validate_project_security({}, { store, dispatchCommand: vi.fn() });

      const [sceneArg] = mockValidateProjectSecurity.mock.calls[0] as [Array<unknown>, unknown];
      expect(sceneArg).toHaveLength(0);
    });

    it('returns success:true even when validation finds issues', async () => {
      mockValidateProjectSecurity.mockReturnValue({
        healthy: false,
        issues: [{ severity: 'high', category: 'script_security', message: 'Dangerous pattern' }],
        stats: { totalEntities: 1, suspiciousNames: 0, oversizedScripts: 0 },
      });

      const { result } = await invokeHandler(
        securityHandlers,
        'validate_project_security',
        {},
      );

      // The handler always returns success:true — the issue data is in result.result
      expect(result.success).toBe(true);
    });
  });
});

// ===========================================================================
// DIALOGUE HANDLERS
// ===========================================================================

describe('dialogueHandlers', () => {
  // -------------------------------------------------------------------------
  // create_dialogue_tree
  // -------------------------------------------------------------------------
  describe('create_dialogue_tree', () => {
    it('returns error when name is missing', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'create_dialogue_tree', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('returns error when name is empty string', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'create_dialogue_tree', {
        name: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('creates tree and returns treeId on success', async () => {
      mockAddTree.mockReturnValue('tree_123');

      const { result } = await invokeHandler(dialogueHandlers, 'create_dialogue_tree', {
        name: 'Intro Scene',
      });

      expect(result.success).toBe(true);
      const data = result.result as { treeId: string; message: string };
      expect(data.treeId).toBe('tree_123');
      expect(data.message).toContain('Intro Scene');
    });

    it('calls addTree with name and undefined startNodeText when not provided', async () => {
      mockAddTree.mockReturnValue('tree_abc');

      await invokeHandler(dialogueHandlers, 'create_dialogue_tree', {
        name: 'Side Quest',
      });

      expect(mockAddTree).toHaveBeenCalledWith('Side Quest', undefined);
    });

    it('passes startNodeText to addTree when provided', async () => {
      mockAddTree.mockReturnValue('tree_xyz');

      await invokeHandler(dialogueHandlers, 'create_dialogue_tree', {
        name: 'Tutorial',
        startNodeText: 'Hello adventurer!',
      });

      expect(mockAddTree).toHaveBeenCalledWith('Tutorial', 'Hello adventurer!');
    });

    it('result message includes tree name', async () => {
      mockAddTree.mockReturnValue('tree_msg');

      const { result } = await invokeHandler(dialogueHandlers, 'create_dialogue_tree', {
        name: 'MyTree',
      });

      const data = result.result as { message: string };
      expect(data.message).toMatch(/MyTree/);
    });
  });

  // -------------------------------------------------------------------------
  // add_dialogue_node
  // -------------------------------------------------------------------------
  describe('add_dialogue_node', () => {
    it('returns error when treeId is missing', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
        nodeType: 'text',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('treeId');
    });

    it('returns error when nodeType is missing', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
        treeId: 'tree_1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('nodeType');
    });

    it('returns error for unknown nodeType', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
        treeId: 'tree_1',
        nodeType: 'invalid_type',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown node type');
      expect(result.error).toContain('invalid_type');
    });

    it('creates a text node with defaults', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
        treeId: 'tree_1',
        nodeType: 'text',
      });

      expect(result.success).toBe(true);
      const data = result.result as { nodeId: string; message: string };
      expect(data.nodeId).not.toBe('');
      expect(data.message).toContain('text');
      expect(mockAddNode).toHaveBeenCalledTimes(1);
      const [, node] = mockAddNode.mock.calls[0] as [
        string,
        { type: string; speaker: string; text: string; next: null },
      ];
      expect(node.type).toBe('text');
      expect(node.speaker).toBe('NPC');
      expect(node.text).toBe('');
      expect(node.next).toBeNull();
    });

    it('creates a text node with custom speaker and text', async () => {
      await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
        treeId: 'tree_1',
        nodeType: 'text',
        speaker: 'Wizard',
        text: 'You shall not pass!',
      });

      const [, node] = mockAddNode.mock.calls[0] as [string, { speaker: string; text: string }];
      expect(node.speaker).toBe('Wizard');
      expect(node.text).toBe('You shall not pass!');
    });

    it('creates a choice node with empty choices array', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
        treeId: 'tree_1',
        nodeType: 'choice',
        text: 'What do you want?',
      });

      expect(result.success).toBe(true);
      const [, node] = mockAddNode.mock.calls[0] as [string, { type: string; choices: unknown[] }];
      expect(node.type).toBe('choice');
      expect(node.choices).toEqual([]);
    });

    it('creates a condition node with default condition', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
        treeId: 'tree_1',
        nodeType: 'condition',
      });

      expect(result.success).toBe(true);
      const [, node] = mockAddNode.mock.calls[0] as [
        string,
        { type: string; condition: { type: string; variable: string }; onTrue: null; onFalse: null },
      ];
      expect(node.type).toBe('condition');
      expect(node.condition.type).toBe('equals');
      expect(node.onTrue).toBeNull();
      expect(node.onFalse).toBeNull();
    });

    it('creates an action node with empty actions array', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
        treeId: 'tree_1',
        nodeType: 'action',
      });

      expect(result.success).toBe(true);
      const [, node] = mockAddNode.mock.calls[0] as [
        string,
        { type: string; actions: unknown[]; next: null },
      ];
      expect(node.type).toBe('action');
      expect(node.actions).toEqual([]);
      expect(node.next).toBeNull();
    });

    it('creates an end node', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
        treeId: 'tree_1',
        nodeType: 'end',
      });

      expect(result.success).toBe(true);
      const [, node] = mockAddNode.mock.calls[0] as [string, { type: string }];
      expect(node.type).toBe('end');
    });

    it('connects to an existing node when connectFromNodeId is provided and node has next field', async () => {
      const existingNodeId = 'node_existing';
      mockDialogueTrees = {
        tree_1: {
          id: 'tree_1',
          name: 'Test',
          nodes: [
            { id: existingNodeId, type: 'text', speaker: 'NPC', text: 'Hello', next: null },
          ],
          startNodeId: existingNodeId,
          variables: {},
        },
      };

      const { result } = await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
        treeId: 'tree_1',
        nodeType: 'text',
        connectFromNodeId: existingNodeId,
      });

      expect(result.success).toBe(true);
      // updateNode should be called to wire up the connection
      expect(mockUpdateNode).toHaveBeenCalledTimes(1);
      const [, fromNodeId, updates] = mockUpdateNode.mock.calls[0] as [
        string,
        string,
        { next: string },
      ];
      expect(fromNodeId).toBe(existingNodeId);
      expect(updates.next).not.toBe('');
    });

    it('does not call updateNode when connectFromNodeId node has no next field', async () => {
      const endNodeId = 'node_end';
      mockDialogueTrees = {
        tree_1: {
          id: 'tree_1',
          name: 'Test',
          nodes: [{ id: endNodeId, type: 'end' }],
          startNodeId: endNodeId,
          variables: {},
        },
      };

      await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
        treeId: 'tree_1',
        nodeType: 'text',
        connectFromNodeId: endNodeId,
      });

      // end node has no 'next' field, so updateNode should NOT be called
      expect(mockUpdateNode).not.toHaveBeenCalled();
    });

    it('does not call updateNode when connectFromNodeId tree does not exist', async () => {
      await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
        treeId: 'tree_1',
        nodeType: 'text',
        connectFromNodeId: 'node_missing',
      });

      expect(mockUpdateNode).not.toHaveBeenCalled();
    });

    it('node IDs are unique across two calls', async () => {
      const call1 = await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
        treeId: 'tree_1',
        nodeType: 'end',
      });
      const call2 = await invokeHandler(dialogueHandlers, 'add_dialogue_node', {
        treeId: 'tree_1',
        nodeType: 'end',
      });

      const id1 = (call1.result.result as { nodeId: string }).nodeId;
      const id2 = (call2.result.result as { nodeId: string }).nodeId;
      expect(id1).not.toBe(id2);
    });
  });

  // -------------------------------------------------------------------------
  // set_dialogue_choice
  // -------------------------------------------------------------------------
  describe('set_dialogue_choice', () => {
    it('returns error when treeId is missing', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_choice', {
        nodeId: 'node_1',
        choiceText: 'Yes',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('treeId');
    });

    it('returns error when nodeId is missing', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_choice', {
        treeId: 'tree_1',
        choiceText: 'Yes',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('nodeId');
    });

    it('returns error when choiceText is missing', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_choice', {
        treeId: 'tree_1',
        nodeId: 'node_1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('choiceText');
    });

    it('returns error when choiceText is empty', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_choice', {
        treeId: 'tree_1',
        nodeId: 'node_1',
        choiceText: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('choiceText');
    });

    it('returns error when tree is not found', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_choice', {
        treeId: 'nonexistent_tree',
        nodeId: 'node_1',
        choiceText: 'Go left',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tree not found');
    });

    it('returns error when node is not found in tree', async () => {
      mockDialogueTrees = {
        tree_1: {
          id: 'tree_1',
          name: 'Test',
          nodes: [{ id: 'node_other', type: 'choice', choices: [] }],
          startNodeId: 'node_other',
          variables: {},
        },
      };

      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_choice', {
        treeId: 'tree_1',
        nodeId: 'node_missing',
        choiceText: 'Go left',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Choice node not found');
    });

    it('returns error when the target node is not a choice node', async () => {
      mockDialogueTrees = {
        tree_1: {
          id: 'tree_1',
          name: 'Test',
          nodes: [{ id: 'node_text', type: 'text', speaker: 'NPC', text: 'Hello', next: null }],
          startNodeId: 'node_text',
          variables: {},
        },
      };

      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_choice', {
        treeId: 'tree_1',
        nodeId: 'node_text',
        choiceText: 'Go left',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Choice node not found');
    });

    it('appends new choice to existing choices and calls updateNode', async () => {
      const existingChoice = { id: 'choice_old', text: 'Old choice', nextNodeId: null };
      mockDialogueTrees = {
        tree_1: {
          id: 'tree_1',
          name: 'Test',
          nodes: [{ id: 'node_choice', type: 'choice', choices: [existingChoice] }],
          startNodeId: 'node_choice',
          variables: {},
        },
      };

      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_choice', {
        treeId: 'tree_1',
        nodeId: 'node_choice',
        choiceText: 'Go right',
        nextNodeId: 'node_next',
      });

      expect(result.success).toBe(true);
      const data = result.result as { choiceId: string; message: string };
      expect(data.choiceId).not.toBe('');
      expect(data.message).toBe('Choice added');

      expect(mockUpdateNode).toHaveBeenCalledTimes(1);
      const [, , updates] = mockUpdateNode.mock.calls[0] as [
        string,
        string,
        { choices: Array<{ id: string; text: string; nextNodeId: string | null }> },
      ];
      expect(updates.choices).toHaveLength(2);
      expect(updates.choices[0]).toEqual(existingChoice);
      expect(updates.choices[1].text).toBe('Go right');
      expect(updates.choices[1].nextNodeId).toBe('node_next');
    });

    it('sets nextNodeId to null when nextNodeId is not provided', async () => {
      mockDialogueTrees = {
        tree_1: {
          id: 'tree_1',
          name: 'Test',
          nodes: [{ id: 'node_choice', type: 'choice', choices: [] }],
          startNodeId: 'node_choice',
          variables: {},
        },
      };

      await invokeHandler(dialogueHandlers, 'set_dialogue_choice', {
        treeId: 'tree_1',
        nodeId: 'node_choice',
        choiceText: 'Dead end',
      });

      const [, , updates] = mockUpdateNode.mock.calls[0] as [
        string,
        string,
        { choices: Array<{ nextNodeId: string | null }> },
      ];
      expect(updates.choices[0].nextNodeId).toBeNull();
    });

    it('choice IDs are unique across two separate calls', async () => {
      for (let i = 0; i < 2; i++) {
        mockDialogueTrees = {
          tree_1: {
            id: 'tree_1',
            name: 'Test',
            nodes: [{ id: 'node_choice', type: 'choice', choices: [] }],
            startNodeId: 'node_choice',
            variables: {},
          },
        };
        await invokeHandler(dialogueHandlers, 'set_dialogue_choice', {
          treeId: 'tree_1',
          nodeId: 'node_choice',
          choiceText: `Option ${i}`,
        });
      }

      const choices1 = (
        mockUpdateNode.mock.calls[0] as [
          string,
          string,
          { choices: Array<{ id: string }> },
        ]
      )[2].choices;
      const choices2 = (
        mockUpdateNode.mock.calls[1] as [
          string,
          string,
          { choices: Array<{ id: string }> },
        ]
      )[2].choices;
      expect(choices1[0].id).not.toBe(choices2[0].id);
    });
  });

  // -------------------------------------------------------------------------
  // remove_dialogue_tree
  // -------------------------------------------------------------------------
  describe('remove_dialogue_tree', () => {
    it('returns error when treeId is missing', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'remove_dialogue_tree', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('treeId');
    });

    it('returns error when treeId is empty string', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'remove_dialogue_tree', {
        treeId: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('treeId');
    });

    it('calls removeTree with the given treeId', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'remove_dialogue_tree', {
        treeId: 'tree_abc',
      });

      expect(result.success).toBe(true);
      expect(mockRemoveTree).toHaveBeenCalledWith('tree_abc');
    });

    it('returns success message confirming removal', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'remove_dialogue_tree', {
        treeId: 'tree_abc',
      });

      const data = result.result as { message: string };
      expect(data.message).toBe('Dialogue tree removed');
    });
  });

  // -------------------------------------------------------------------------
  // get_dialogue_tree
  // -------------------------------------------------------------------------
  describe('get_dialogue_tree', () => {
    it('returns error when treeId is missing', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'get_dialogue_tree', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('treeId');
    });

    it('returns error when tree is not found', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'get_dialogue_tree', {
        treeId: 'nonexistent',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tree not found');
    });

    it('returns the full tree object when found', async () => {
      const tree = {
        id: 'tree_1',
        name: 'My Tree',
        nodes: [],
        startNodeId: 'node_0',
        variables: {},
      };
      mockDialogueTrees = { tree_1: tree };

      const { result } = await invokeHandler(dialogueHandlers, 'get_dialogue_tree', {
        treeId: 'tree_1',
      });

      expect(result.success).toBe(true);
      expect(result.result).toEqual(tree);
    });

    it('returns full node list when tree has multiple nodes', async () => {
      const tree = {
        id: 'tree_full',
        name: 'Full Tree',
        nodes: [
          { id: 'n1', type: 'text', speaker: 'Hero', text: 'Hello', next: 'n2' },
          { id: 'n2', type: 'end' },
        ],
        startNodeId: 'n1',
        variables: { score: 0 },
      };
      mockDialogueTrees = { tree_full: tree };

      const { result } = await invokeHandler(dialogueHandlers, 'get_dialogue_tree', {
        treeId: 'tree_full',
      });

      expect(result.success).toBe(true);
      const returned = result.result as typeof tree;
      expect(returned.nodes).toHaveLength(2);
      expect(returned.variables).toEqual({ score: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // set_dialogue_node_voice
  // -------------------------------------------------------------------------
  describe('set_dialogue_node_voice', () => {
    it('returns error when treeId is missing', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_node_voice', {
        nodeId: 'node_1',
        voiceAssetId: 'voice_abc',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('treeId');
    });

    it('returns error when nodeId is missing', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_node_voice', {
        treeId: 'tree_1',
        voiceAssetId: 'voice_abc',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('nodeId');
    });

    it('returns error when voiceAssetId is missing', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_node_voice', {
        treeId: 'tree_1',
        nodeId: 'node_1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('voiceAssetId');
    });

    it('returns error when voiceAssetId is empty string', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_node_voice', {
        treeId: 'tree_1',
        nodeId: 'node_1',
        voiceAssetId: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('voiceAssetId');
    });

    it('calls updateNode with voiceAsset property and returns success', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_node_voice', {
        treeId: 'tree_1',
        nodeId: 'node_1',
        voiceAssetId: 'voice_hero_greeting',
      });

      expect(result.success).toBe(true);
      expect(mockUpdateNode).toHaveBeenCalledWith('tree_1', 'node_1', {
        voiceAsset: 'voice_hero_greeting',
      });
    });

    it('returns a success message confirming assignment', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'set_dialogue_node_voice', {
        treeId: 'tree_1',
        nodeId: 'node_1',
        voiceAssetId: 'voice_abc',
      });

      const data = result.result as { message: string };
      expect(data.message).toBe('Voice asset assigned');
    });
  });

  // -------------------------------------------------------------------------
  // export_dialogue_tree
  // -------------------------------------------------------------------------
  describe('export_dialogue_tree', () => {
    it('returns error when treeId is missing', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'export_dialogue_tree', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('treeId');
    });

    it('returns error when exportTree returns null (tree not found)', async () => {
      mockExportTree.mockReturnValue(null);

      const { result } = await invokeHandler(dialogueHandlers, 'export_dialogue_tree', {
        treeId: 'missing_tree',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tree not found');
    });

    it('returns json string from exportTree on success', async () => {
      const jsonData = '{"id":"tree_1","name":"Test","nodes":[]}';
      mockExportTree.mockReturnValue(jsonData);

      const { result } = await invokeHandler(dialogueHandlers, 'export_dialogue_tree', {
        treeId: 'tree_1',
      });

      expect(result.success).toBe(true);
      const data = result.result as { json: string };
      expect(data.json).toBe(jsonData);
    });

    it('calls exportTree with the given treeId', async () => {
      mockExportTree.mockReturnValue('{}');

      await invokeHandler(dialogueHandlers, 'export_dialogue_tree', {
        treeId: 'tree_export',
      });

      expect(mockExportTree).toHaveBeenCalledWith('tree_export');
    });
  });

  // -------------------------------------------------------------------------
  // import_dialogue_tree
  // -------------------------------------------------------------------------
  describe('import_dialogue_tree', () => {
    it('returns error when jsonData is missing', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'import_dialogue_tree', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('jsonData');
    });

    it('returns error when jsonData is empty string', async () => {
      const { result } = await invokeHandler(dialogueHandlers, 'import_dialogue_tree', {
        jsonData: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('jsonData');
    });

    it('returns error when importTree returns null (parse failure)', async () => {
      mockImportTree.mockReturnValue(null);

      const { result } = await invokeHandler(dialogueHandlers, 'import_dialogue_tree', {
        jsonData: '{"id":"t1","nodes":[]}',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to import tree');
    });

    it('returns treeId and success message on successful import', async () => {
      mockImportTree.mockReturnValue('tree_imported_99');

      const { result } = await invokeHandler(dialogueHandlers, 'import_dialogue_tree', {
        jsonData: '{"id":"old_id","name":"Quest"}',
      });

      expect(result.success).toBe(true);
      const data = result.result as { treeId: string; message: string };
      expect(data.treeId).toBe('tree_imported_99');
      expect(data.message).toBe('Dialogue tree imported');
    });

    it('calls importTree with the raw jsonData string', async () => {
      mockImportTree.mockReturnValue('tree_99');
      const jsonData = '{"id":"t1","name":"N"}';

      await invokeHandler(dialogueHandlers, 'import_dialogue_tree', { jsonData });

      expect(mockImportTree).toHaveBeenCalledWith(jsonData);
    });
  });
});
