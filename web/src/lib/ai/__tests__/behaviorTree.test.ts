import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  type BehaviorNode,
  type BehaviorTree,
  type BehaviorNodeType,
  type BehaviorVariableType,
  BEHAVIOR_PRESETS,
  getPreset,
  validateNode,
  validateTree,
  isValidNodeType,
  isValidVariableType,
  behaviorTreeToScript,
  parseBehaviorTreeResponse,
  buildBehaviorTreePrompt,
  generateBehaviorTree,
  generateNodeId,
  resetNodeCounter,
  countNodes,
  getTreeDepth,
} from '../behaviorTree';

describe('behaviorTree', () => {
  beforeEach(() => {
    resetNodeCounter();
  });

  // ---- Type Validation ----

  describe('isValidNodeType', () => {
    it('accepts all valid node types', () => {
      const validTypes: BehaviorNodeType[] = [
        'sequence', 'selector', 'parallel', 'condition',
        'action', 'decorator', 'inverter', 'repeater',
      ];
      for (const t of validTypes) {
        expect(isValidNodeType(t)).toBe(true);
      }
    });

    it('rejects invalid node types', () => {
      expect(isValidNodeType('unknown')).toBe(false);
      expect(isValidNodeType('')).toBe(false);
      expect(isValidNodeType('node')).toBe(false);
    });
  });

  describe('isValidVariableType', () => {
    it('accepts all valid variable types', () => {
      const validTypes: BehaviorVariableType[] = ['number', 'boolean', 'string', 'vector3'];
      for (const t of validTypes) {
        expect(isValidVariableType(t)).toBe(true);
      }
    });

    it('rejects invalid variable types', () => {
      expect(isValidVariableType('int')).toBe(false);
      expect(isValidVariableType('float')).toBe(false);
      expect(isValidVariableType('object')).toBe(false);
    });
  });

  // ---- Node ID Generation ----

  describe('generateNodeId', () => {
    it('generates incrementing IDs', () => {
      const id1 = generateNodeId();
      const id2 = generateNodeId();
      expect(id1).toBe('bt_1');
      expect(id2).toBe('bt_2');
    });

    it('resets counter', () => {
      generateNodeId();
      generateNodeId();
      resetNodeCounter();
      expect(generateNodeId()).toBe('bt_1');
    });
  });

  // ---- Node Validation ----

  describe('validateNode', () => {
    it('validates a well-formed action node', () => {
      const node: BehaviorNode = { id: 'n1', type: 'action', name: 'do_thing' };
      expect(validateNode(node)).toEqual([]);
    });

    it('validates a well-formed condition node', () => {
      const node: BehaviorNode = { id: 'n1', type: 'condition', name: 'check_thing' };
      expect(validateNode(node)).toEqual([]);
    });

    it('errors on missing id', () => {
      const node = { id: '', type: 'action', name: 'test' } as BehaviorNode;
      const errors = validateNode(node);
      expect(errors).toContain('Node missing required "id" field');
    });

    it('errors on invalid node type', () => {
      const node = { id: 'n1', type: 'invalid' as BehaviorNodeType, name: 'test' };
      const errors = validateNode(node);
      expect(errors.some(e => e.includes('Invalid node type'))).toBe(true);
    });

    it('errors on missing name', () => {
      const node = { id: 'n1', type: 'action', name: '' } as BehaviorNode;
      const errors = validateNode(node);
      expect(errors).toContain('Node missing required "name" field');
    });

    it('errors on sequence with no children', () => {
      const node: BehaviorNode = { id: 'n1', type: 'sequence', name: 'seq' };
      const errors = validateNode(node);
      expect(errors.some(e => e.includes('must have at least one child'))).toBe(true);
    });

    it('errors on selector with empty children', () => {
      const node: BehaviorNode = { id: 'n1', type: 'selector', name: 'sel', children: [] };
      const errors = validateNode(node);
      expect(errors.some(e => e.includes('must have at least one child'))).toBe(true);
    });

    it('errors on inverter with no children', () => {
      const node: BehaviorNode = { id: 'n1', type: 'inverter', name: 'inv' };
      const errors = validateNode(node);
      expect(errors.some(e => e.includes('must have exactly one child'))).toBe(true);
    });

    it('errors on inverter with multiple children', () => {
      const node: BehaviorNode = {
        id: 'n1', type: 'inverter', name: 'inv',
        children: [
          { id: 'c1', type: 'action', name: 'a1' },
          { id: 'c2', type: 'action', name: 'a2' },
        ],
      };
      const errors = validateNode(node);
      expect(errors.some(e => e.includes('must have exactly one child'))).toBe(true);
    });

    it('errors on leaf node with children', () => {
      const node: BehaviorNode = {
        id: 'n1', type: 'action', name: 'act',
        children: [{ id: 'c1', type: 'action', name: 'sub' }],
      };
      const errors = validateNode(node);
      expect(errors.some(e => e.includes('should not have children'))).toBe(true);
    });

    it('errors on exceeding max depth', () => {
      // Build a chain of 12 nested sequences (exceeds MAX_TREE_DEPTH of 10)
      let current: BehaviorNode = { id: 'leaf', type: 'action', name: 'act' };
      for (let i = 0; i < 12; i++) {
        current = { id: `seq_${i}`, type: 'sequence', name: `seq_${i}`, children: [current] };
      }
      const errors = validateNode(current);
      expect(errors.some(e => e.includes('maximum depth'))).toBe(true);
    });

    it('validates nested structure recursively', () => {
      const node: BehaviorNode = {
        id: 'root', type: 'sequence', name: 'root',
        children: [
          { id: 'c1', type: 'action', name: 'a1' },
          { id: 'c2', type: 'condition', name: '' }, // invalid child
        ],
      };
      const errors = validateNode(node);
      expect(errors.some(e => e.includes('missing required "name"'))).toBe(true);
    });
  });

  // ---- Tree Validation ----

  describe('validateTree', () => {
    it('validates a well-formed tree', () => {
      const tree: BehaviorTree = {
        name: 'Test',
        description: 'Test tree',
        root: { id: 'r', type: 'action', name: 'do' },
        variables: [],
      };
      expect(validateTree(tree)).toEqual([]);
    });

    it('errors on missing tree name', () => {
      const tree = {
        name: '',
        description: '',
        root: { id: 'r', type: 'action', name: 'do' },
        variables: [],
      } as BehaviorTree;
      expect(validateTree(tree)).toContain('Tree missing required "name" field');
    });

    it('errors on missing root', () => {
      const tree = { name: 'T', description: '', root: null, variables: [] } as unknown as BehaviorTree;
      expect(validateTree(tree)).toContain('Tree missing required "root" node');
    });

    it('validates variables with invalid types', () => {
      const tree: BehaviorTree = {
        name: 'T',
        description: '',
        root: { id: 'r', type: 'action', name: 'do' },
        variables: [{ name: 'x', type: 'float' as BehaviorVariableType, defaultValue: 0 }],
      };
      const errors = validateTree(tree);
      expect(errors.some(e => e.includes('Invalid variable type'))).toBe(true);
    });

    it('validates variables with missing name', () => {
      const tree: BehaviorTree = {
        name: 'T',
        description: '',
        root: { id: 'r', type: 'action', name: 'do' },
        variables: [{ name: '', type: 'number', defaultValue: 0 }],
      };
      const errors = validateTree(tree);
      expect(errors.some(e => e.includes('Variable missing required "name"'))).toBe(true);
    });

    it('passes when all node IDs are unique (regression for PF-709)', () => {
      const tree: BehaviorTree = {
        name: 'T',
        description: '',
        root: {
          id: 'root',
          type: 'sequence',
          name: 'seq',
          children: [
            { id: 'c1', type: 'action', name: 'a1' },
            { id: 'c2', type: 'action', name: 'a2' },
          ],
        },
        variables: [],
      };
      expect(validateTree(tree)).toEqual([]);
    });

    it('errors on duplicate node IDs to prevent SyntaxError in generated scripts (regression for PF-709)', () => {
      const tree: BehaviorTree = {
        name: 'T',
        description: '',
        root: {
          id: 'dup',
          type: 'sequence',
          name: 'seq',
          children: [
            { id: 'dup', type: 'action', name: 'a1' }, // same ID as root
            { id: 'c2', type: 'action', name: 'a2' },
          ],
        },
        variables: [],
      };
      const errors = validateTree(tree);
      expect(errors.some(e => e.includes('Duplicate node ID') && e.includes('"dup"'))).toBe(true);
    });

    it('detects duplicate IDs in deeply nested trees', () => {
      const tree: BehaviorTree = {
        name: 'T',
        description: '',
        root: {
          id: 'root',
          type: 'sequence',
          name: 'seq',
          children: [
            {
              id: 'nested',
              type: 'inverter',
              name: 'inv',
              children: [{ id: 'leaf', type: 'action', name: 'a' }],
            },
            { id: 'leaf', type: 'action', name: 'b' }, // duplicate 'leaf'
          ],
        },
        variables: [],
      };
      const errors = validateTree(tree);
      expect(errors.some(e => e.includes('Duplicate node ID') && e.includes('"leaf"'))).toBe(true);
    });
  });

  // ---- Preset Trees ----

  describe('BEHAVIOR_PRESETS', () => {
    it('has 5 presets', () => {
      expect(Object.keys(BEHAVIOR_PRESETS)).toHaveLength(5);
    });

    it('has expected preset keys', () => {
      expect(Object.keys(BEHAVIOR_PRESETS).sort()).toEqual([
        'chase_player', 'collect_items', 'flee_when_low_health', 'guard_area', 'patrol',
      ]);
    });

    for (const [key, factory] of Object.entries(BEHAVIOR_PRESETS)) {
      describe(`preset: ${key}`, () => {
        it('produces a structurally valid tree', () => {
          resetNodeCounter();
          const tree = factory();
          const errors = validateTree(tree);
          expect(errors).toEqual([]);
        });

        it('has a non-empty name and description', () => {
          resetNodeCounter();
          const tree = factory();
          expect(tree.name.length).toBeGreaterThan(0);
          expect(tree.description.length).toBeGreaterThan(0);
        });

        it('has at least one variable', () => {
          resetNodeCounter();
          const tree = factory();
          expect(tree.variables.length).toBeGreaterThan(0);
        });

        it('generates valid script output', () => {
          resetNodeCounter();
          const tree = factory();
          const script = behaviorTreeToScript(tree);
          expect(script.length).toBeGreaterThan(100);
          expect(script).toContain('function onUpdate');
          expect(script).toContain('tickBehaviorTree');
        });
      });
    }
  });

  describe('getPreset', () => {
    it('returns a tree for valid key', () => {
      const tree = getPreset('patrol');
      expect(tree).not.toBeNull();
      expect(tree!.name).toBe('Patrol');
    });

    it('returns null for unknown key', () => {
      expect(getPreset('nonexistent')).toBeNull();
    });

    it('returns fresh copies', () => {
      const a = getPreset('patrol');
      const b = getPreset('patrol');
      expect(a).not.toBe(b);
      expect(a!.name).toBe(b!.name);
    });
  });

  // ---- Script Generation ----

  describe('behaviorTreeToScript', () => {
    it('generates script with variable declarations', () => {
      const tree: BehaviorTree = {
        name: 'Test',
        description: 'A test tree',
        root: { id: 'r', type: 'action', name: 'idle' },
        variables: [
          { name: 'speed', type: 'number', defaultValue: 5 },
          { name: 'active', type: 'boolean', defaultValue: true },
        ],
      };
      const script = behaviorTreeToScript(tree);
      expect(script).toContain('let speed = 5;');
      expect(script).toContain('let active = true;');
    });

    it('generates script with tree name in header', () => {
      const tree: BehaviorTree = {
        name: 'My Tree',
        description: 'desc',
        root: { id: 'r', type: 'action', name: 'idle' },
        variables: [],
      };
      const script = behaviorTreeToScript(tree);
      expect(script).toContain('Behavior Tree: My Tree');
    });

    it('generates action node code', () => {
      const tree: BehaviorTree = {
        name: 'T',
        description: '',
        root: { id: 'a1', type: 'action', name: 'idle' },
        variables: [],
      };
      const script = behaviorTreeToScript(tree);
      expect(script).toContain('actions["idle"]');
    });

    it('generates condition node code', () => {
      const tree: BehaviorTree = {
        name: 'T',
        description: '',
        root: { id: 'c1', type: 'condition', name: 'player_near', params: { range: 10 } },
        variables: [],
      };
      const script = behaviorTreeToScript(tree);
      expect(script).toContain('conditions["player_near"]');
      expect(script).toContain('"range":10');
    });

    it('generates sequence node code with bail-on-failure', () => {
      const tree: BehaviorTree = {
        name: 'T',
        description: '',
        root: {
          id: 'seq', type: 'sequence', name: 'seq',
          children: [
            { id: 'a1', type: 'action', name: 'first' },
            { id: 'a2', type: 'action', name: 'second' },
          ],
        },
        variables: [],
      };
      const script = behaviorTreeToScript(tree);
      expect(script).toContain('if (status_a1 !== "success")');
    });

    it('generates selector node code with succeed-on-success', () => {
      const tree: BehaviorTree = {
        name: 'T',
        description: '',
        root: {
          id: 'sel', type: 'selector', name: 'sel',
          children: [
            { id: 'a1', type: 'action', name: 'first' },
            { id: 'a2', type: 'action', name: 'second' },
          ],
        },
        variables: [],
      };
      const script = behaviorTreeToScript(tree);
      expect(script).toContain('if (status_a1 === "success")');
    });

    it('generates inverter node code', () => {
      const tree: BehaviorTree = {
        name: 'T',
        description: '',
        root: {
          id: 'inv', type: 'inverter', name: 'invert',
          children: [{ id: 'c1', type: 'condition', name: 'check' }],
        },
        variables: [],
      };
      const script = behaviorTreeToScript(tree);
      expect(script).toContain('=== "success" ? "failure" : "success"');
    });

    it('generates repeater node code', () => {
      const tree: BehaviorTree = {
        name: 'T',
        description: '',
        root: {
          id: 'rep', type: 'repeater', name: 'loop',
          children: [{ id: 'a1', type: 'action', name: 'act' }],
        },
        variables: [],
      };
      const script = behaviorTreeToScript(tree);
      expect(script).toContain('"running"');
    });

    it('generates parallel node code', () => {
      const tree: BehaviorTree = {
        name: 'T',
        description: '',
        root: {
          id: 'par', type: 'parallel', name: 'par',
          children: [
            { id: 'a1', type: 'action', name: 'first' },
            { id: 'a2', type: 'action', name: 'second' },
          ],
        },
        variables: [],
      };
      const script = behaviorTreeToScript(tree);
      expect(script).toContain('status_a1 === "success" && status_a2 === "success"');
    });

    it('handles vector3 variable defaults', () => {
      const tree: BehaviorTree = {
        name: 'T',
        description: '',
        root: { id: 'r', type: 'action', name: 'idle' },
        variables: [{ name: 'pos', type: 'vector3', defaultValue: { x: 1, y: 2, z: 3 } }],
      };
      const script = behaviorTreeToScript(tree);
      expect(script).toContain('let pos = {"x":1,"y":2,"z":3}');
    });

    it('throws on duplicate node IDs (PF-307)', () => {
      const tree: BehaviorTree = {
        name: 'Duplicate',
        description: 'Tree with duplicate IDs',
        root: {
          id: 'seq1',
          type: 'sequence',
          name: 'main',
          children: [
            { id: 'action1', type: 'action', name: 'idle' },
            { id: 'action1', type: 'action', name: 'walk' }, // duplicate
          ],
        },
        variables: [],
      };
      expect(() => behaviorTreeToScript(tree)).toThrow('Duplicate behavior tree node ID: "action1"');
    });

    it('succeeds with unique node IDs', () => {
      const tree: BehaviorTree = {
        name: 'Unique',
        description: 'Tree with unique IDs',
        root: {
          id: 'seq1',
          type: 'sequence',
          name: 'main',
          children: [
            { id: 'action1', type: 'action', name: 'idle' },
            { id: 'action2', type: 'action', name: 'walk' },
          ],
        },
        variables: [],
      };
      expect(() => behaviorTreeToScript(tree)).not.toThrow();
    });
  });

  // ---- AI Response Parsing ----

  describe('parseBehaviorTreeResponse', () => {
    it('parses valid JSON', () => {
      const json = JSON.stringify({
        name: 'Test',
        description: 'desc',
        root: { id: 'r', type: 'action', name: 'idle' },
        variables: [],
      });
      const tree = parseBehaviorTreeResponse(json);
      expect(tree).not.toBeNull();
      expect(tree!.name).toBe('Test');
    });

    it('parses JSON from markdown code block', () => {
      const raw = '```json\n' + JSON.stringify({
        name: 'Test',
        description: 'desc',
        root: { id: 'r', type: 'action', name: 'idle' },
        variables: [],
      }) + '\n```';
      const tree = parseBehaviorTreeResponse(raw);
      expect(tree).not.toBeNull();
      expect(tree!.name).toBe('Test');
    });

    it('parses JSON from bare code block', () => {
      const raw = '```\n' + JSON.stringify({
        name: 'Test',
        description: 'desc',
        root: { id: 'r', type: 'action', name: 'idle' },
      }) + '\n```';
      const tree = parseBehaviorTreeResponse(raw);
      expect(tree).not.toBeNull();
      expect(tree!.variables).toEqual([]);
    });

    it('returns null for invalid JSON', () => {
      expect(parseBehaviorTreeResponse('not json')).toBeNull();
    });

    it('returns null for missing name', () => {
      const json = JSON.stringify({
        description: 'desc',
        root: { id: 'r', type: 'action', name: 'idle' },
      });
      expect(parseBehaviorTreeResponse(json)).toBeNull();
    });

    it('returns null for missing root', () => {
      const json = JSON.stringify({ name: 'T', description: 'desc' });
      expect(parseBehaviorTreeResponse(json)).toBeNull();
    });
  });

  // ---- Prompt Builder ----

  describe('buildBehaviorTreePrompt', () => {
    it('includes the description', () => {
      const prompt = buildBehaviorTreePrompt('patrol between A and B');
      expect(prompt).toContain('patrol between A and B');
    });

    it('includes node type documentation', () => {
      const prompt = buildBehaviorTreePrompt('test');
      expect(prompt).toContain('sequence');
      expect(prompt).toContain('selector');
      expect(prompt).toContain('inverter');
    });
  });

  // ---- AI Generation (mocked) ----

  describe('generateBehaviorTree', () => {
    /** Helper: create a mock SSE ReadableStream from text lines */
    function mockSSEStream(lines: string[]): ReadableStream<Uint8Array> {
      const encoder = new TextEncoder();
      const chunks = lines.map((l) => encoder.encode(l + '\n'));
      let i = 0;
      return new ReadableStream({
        pull(controller) {
          if (i < chunks.length) controller.enqueue(chunks[i++]);
          else controller.close();
        },
      });
    }

    /** Create a mock Response compatible with fetchAI (needs headers + ok + body) */
    function mockOkResponse(lines: string[]): Response {
      return new Response(mockSSEStream(lines), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }

    it('throws on non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      ));
      // fetchAI mapError transforms "Internal server" messages to a friendly string
      await expect(generateBehaviorTree('test')).rejects.toThrow(/service error/i);
      vi.unstubAllGlobals();
    });

    it('throws on unparseable response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockOkResponse([
          'data: {"type":"text_delta","text":"not valid json"}',
          'data: {"type":"done"}',
        ]),
      ));
      await expect(generateBehaviorTree('test')).rejects.toThrow('Failed to parse');
      vi.unstubAllGlobals();
    });

    it('returns parsed tree on valid response', async () => {
      const treeData = {
        name: 'Generated',
        description: 'auto',
        root: { id: 'r', type: 'action', name: 'idle' },
        variables: [],
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockOkResponse([
          `data: {"type":"text_delta","text":"${JSON.stringify(treeData).replace(/"/g, '\\"')}"}`,
          'data: {"type":"done"}',
        ]),
      ));
      const tree = await generateBehaviorTree('idle NPC');
      expect(tree.name).toBe('Generated');
      vi.unstubAllGlobals();
    });
  });

  // ---- Utility Functions ----

  describe('countNodes', () => {
    it('counts single node', () => {
      expect(countNodes({ id: 'r', type: 'action', name: 'a' })).toBe(1);
    });

    it('counts nested nodes', () => {
      const tree: BehaviorNode = {
        id: 'root', type: 'sequence', name: 'seq',
        children: [
          { id: 'a1', type: 'action', name: 'a1' },
          {
            id: 'sel', type: 'selector', name: 'sel',
            children: [
              { id: 'a2', type: 'action', name: 'a2' },
              { id: 'a3', type: 'action', name: 'a3' },
            ],
          },
        ],
      };
      expect(countNodes(tree)).toBe(5);
    });
  });

  describe('getTreeDepth', () => {
    it('returns 1 for leaf', () => {
      expect(getTreeDepth({ id: 'r', type: 'action', name: 'a' })).toBe(1);
    });

    it('returns correct depth for nested tree', () => {
      const tree: BehaviorNode = {
        id: 'root', type: 'sequence', name: 'seq',
        children: [
          { id: 'a1', type: 'action', name: 'a1' },
          {
            id: 'inv', type: 'inverter', name: 'inv',
            children: [{ id: 'c1', type: 'condition', name: 'c1' }],
          },
        ],
      };
      expect(getTreeDepth(tree)).toBe(3);
    });
  });
});
