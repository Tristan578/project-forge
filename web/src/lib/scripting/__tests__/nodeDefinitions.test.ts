/**
 * Unit tests for visual script node definitions (nodeDefinitions.ts).
 *
 * Verifies structural integrity of the NODE_DEFINITIONS registry:
 *  - Every node has required fields: type, label, category, description, inputs, outputs, color
 *  - No duplicate node types in the registry
 *  - NODE_DEFINITION_MAP is keyed by node type
 *  - NODE_CATEGORIES covers all 10 expected categories
 *  - Each category references only nodes with the correct category field
 *  - Port definitions have required id, name, type fields
 *  - Known specific nodes from each category exist and have expected ports
 */

import { describe, it, expect } from 'vitest';
import {
  NODE_DEFINITIONS,
  NODE_DEFINITION_MAP,
  NODE_CATEGORIES,
} from '@/lib/scripting/nodeDefinitions';
import type { NodeDefinition } from '@/lib/scripting/visualScriptTypes';

// ── helpers ───────────────────────────────────────────────────────────────────

function isValidPortType(type: string): boolean {
  const valid = ['exec', 'float', 'int', 'bool', 'string', 'vec3', 'entity', 'any'];
  return valid.includes(type);
}

// ── structural integrity ───────────────────────────────────────────────────────

describe('NODE_DEFINITIONS: structural integrity', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(NODE_DEFINITIONS)).toBe(true);
    expect(NODE_DEFINITIONS.length).toBeGreaterThan(0);
  });

  it('contains at least 70 node definitions', () => {
    // The comment at top says 73 node types
    expect(NODE_DEFINITIONS.length).toBeGreaterThanOrEqual(70);
  });

  it('every node has a non-empty type string', () => {
    for (const node of NODE_DEFINITIONS) {
      expect(typeof node.type).toBe('string');
      expect(node.type.length).toBeGreaterThan(0);
    }
  });

  it('every node has a non-empty label string', () => {
    for (const node of NODE_DEFINITIONS) {
      expect(typeof node.label).toBe('string');
      expect(node.label.length).toBeGreaterThan(0);
    }
  });

  it('every node has a non-empty description string', () => {
    for (const node of NODE_DEFINITIONS) {
      expect(typeof node.description).toBe('string');
      expect(node.description.length).toBeGreaterThan(0);
    }
  });

  it('every node has a category string', () => {
    for (const node of NODE_DEFINITIONS) {
      expect(typeof node.category).toBe('string');
      expect(node.category.length).toBeGreaterThan(0);
    }
  });

  it('every node has a color hex string', () => {
    for (const node of NODE_DEFINITIONS) {
      expect(node.color).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    }
  });

  it('every node has inputs and outputs arrays', () => {
    for (const node of NODE_DEFINITIONS) {
      expect(Array.isArray(node.inputs)).toBe(true);
      expect(Array.isArray(node.outputs)).toBe(true);
    }
  });

  it('no duplicate node types exist', () => {
    const types = NODE_DEFINITIONS.map(n => n.type);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length);
  });
});

// ── port definitions ──────────────────────────────────────────────────────────

describe('NODE_DEFINITIONS: port definitions', () => {
  function getAllPorts(node: NodeDefinition) {
    return [...node.inputs, ...node.outputs];
  }

  it('every port has a non-empty id string', () => {
    for (const node of NODE_DEFINITIONS) {
      for (const port of getAllPorts(node)) {
        expect(typeof port.id).toBe('string');
        expect(port.id.length).toBeGreaterThan(0);
      }
    }
  });

  it('every port has a name string (can be empty for exec pins)', () => {
    for (const node of NODE_DEFINITIONS) {
      for (const port of getAllPorts(node)) {
        expect(typeof port.name).toBe('string');
      }
    }
  });

  it('every port has a valid type', () => {
    for (const node of NODE_DEFINITIONS) {
      for (const port of getAllPorts(node)) {
        expect(isValidPortType(port.type)).toBe(true);
      }
    }
  });

  it('no node has duplicate port ids within inputs or outputs', () => {
    for (const node of NODE_DEFINITIONS) {
      const inputIds = node.inputs.map(p => p.id);
      expect(new Set(inputIds).size).toBe(inputIds.length);
      const outputIds = node.outputs.map(p => p.id);
      expect(new Set(outputIds).size).toBe(outputIds.length);
    }
  });
});

// ── NODE_DEFINITION_MAP ────────────────────────────────────────────────────────

describe('NODE_DEFINITION_MAP: keyed access', () => {
  it('is a plain object', () => {
    expect(typeof NODE_DEFINITION_MAP).toBe('object');
    expect(NODE_DEFINITION_MAP).not.toBeNull();
  });

  it('contains the same number of entries as NODE_DEFINITIONS', () => {
    expect(Object.keys(NODE_DEFINITION_MAP).length).toBe(NODE_DEFINITIONS.length);
  });

  it('every entry key matches the node type field', () => {
    for (const [key, node] of Object.entries(NODE_DEFINITION_MAP)) {
      expect(key).toBe(node.type);
    }
  });

  it('can look up a known node by type', () => {
    expect(NODE_DEFINITION_MAP['OnStart']).not.toBeUndefined();
    expect(NODE_DEFINITION_MAP['OnStart'].label).toBe('On Start');
  });

  it('returns undefined for unknown types', () => {
    expect(NODE_DEFINITION_MAP['NonExistentNode']).toBeUndefined();
  });
});

// ── NODE_CATEGORIES ────────────────────────────────────────────────────────────

describe('NODE_CATEGORIES: category completeness', () => {
  const expectedCategories = [
    'events', 'flow', 'math', 'transform', 'physics',
    'input', 'audio', 'state', 'entity', 'ui',
  ];

  it('has exactly 10 categories', () => {
    expect(NODE_CATEGORIES.length).toBe(10);
  });

  it('covers all expected categories', () => {
    const categoryIds = NODE_CATEGORIES.map(c => c.category);
    for (const cat of expectedCategories) {
      expect(categoryIds).toContain(cat);
    }
  });

  it('every category has a non-empty label', () => {
    for (const cat of NODE_CATEGORIES) {
      expect(typeof cat.label).toBe('string');
      expect(cat.label.length).toBeGreaterThan(0);
    }
  });

  it('every category has a non-empty nodes array', () => {
    for (const cat of NODE_CATEGORIES) {
      expect(Array.isArray(cat.nodes)).toBe(true);
      expect(cat.nodes.length).toBeGreaterThan(0);
    }
  });

  it('all nodes in each category have matching category field', () => {
    for (const cat of NODE_CATEGORIES) {
      for (const node of cat.nodes) {
        expect(node.category).toBe(cat.category);
      }
    }
  });

  it('category node counts sum to total node count', () => {
    const total = NODE_CATEGORIES.reduce((sum, c) => sum + c.nodes.length, 0);
    expect(total).toBe(NODE_DEFINITIONS.length);
  });
});

// ── specific node spot-checks by category ─────────────────────────────────────

describe('NODE_DEFINITIONS: events category', () => {
  it('contains OnStart node with exec output', () => {
    const node = NODE_DEFINITION_MAP['OnStart'];
    expect(node).not.toBeNull();
    expect(node.category).toBe('events');
    expect(node.inputs).toHaveLength(0);
    expect(node.outputs.some(p => p.type === 'exec')).toBe(true);
  });

  it('contains OnUpdate node with delta time output', () => {
    const node = NODE_DEFINITION_MAP['OnUpdate'];
    expect(node).not.toBeNull();
    expect(node.outputs.some(p => p.id === 'dt' && p.type === 'float')).toBe(true);
  });

  it('contains OnKeyPress node with key input', () => {
    const node = NODE_DEFINITION_MAP['OnKeyPress'];
    expect(node).not.toBeNull();
    expect(node.inputs.some(p => p.id === 'key' && p.type === 'string')).toBe(true);
  });

  it('contains OnTimer node with delay and repeat inputs', () => {
    const node = NODE_DEFINITION_MAP['OnTimer'];
    expect(node).not.toBeNull();
    expect(node.inputs.some(p => p.id === 'delay')).toBe(true);
    expect(node.inputs.some(p => p.id === 'repeat' && p.type === 'bool')).toBe(true);
  });

  it('contains collision event nodes', () => {
    expect(NODE_DEFINITION_MAP['OnCollisionEnter']).not.toBeUndefined();
    expect(NODE_DEFINITION_MAP['OnCollisionExit']).not.toBeUndefined();
  });

  it('contains trigger event nodes', () => {
    expect(NODE_DEFINITION_MAP['OnTriggerEnter']).not.toBeUndefined();
    expect(NODE_DEFINITION_MAP['OnTriggerExit']).not.toBeUndefined();
  });
});

describe('NODE_DEFINITIONS: flow category', () => {
  it('contains Branch node with true/false outputs', () => {
    const node = NODE_DEFINITION_MAP['Branch'];
    expect(node).not.toBeNull();
    expect(node.category).toBe('flow');
    expect(node.outputs.some(p => p.id === 'exec_true')).toBe(true);
    expect(node.outputs.some(p => p.id === 'exec_false')).toBe(true);
  });

  it('contains ForLoop node with start/end inputs and index output', () => {
    const node = NODE_DEFINITION_MAP['ForLoop'];
    expect(node).not.toBeNull();
    expect(node.inputs.some(p => p.id === 'start' && p.type === 'int')).toBe(true);
    expect(node.inputs.some(p => p.id === 'end' && p.type === 'int')).toBe(true);
    expect(node.outputs.some(p => p.id === 'index' && p.type === 'int')).toBe(true);
  });

  it('contains WhileLoop node', () => {
    expect(NODE_DEFINITION_MAP['WhileLoop']).not.toBeUndefined();
  });
});

describe('NODE_DEFINITIONS: math category', () => {
  it('contains Add, Subtract, Multiply nodes', () => {
    expect(NODE_DEFINITION_MAP['Add']).not.toBeUndefined();
    expect(NODE_DEFINITION_MAP['Subtract']).not.toBeUndefined();
    expect(NODE_DEFINITION_MAP['Multiply']).not.toBeUndefined();
  });

  it('math nodes have a/b inputs and result output', () => {
    const node = NODE_DEFINITION_MAP['Add'];
    expect(node).not.toBeNull();
    expect(node.category).toBe('math');
    expect(node.inputs.some(p => p.id === 'a')).toBe(true);
    expect(node.inputs.some(p => p.id === 'b')).toBe(true);
    expect(node.outputs.some(p => p.id === 'result')).toBe(true);
  });
});

describe('NODE_DEFINITIONS: transform category', () => {
  it('has at least one transform category node', () => {
    const transformNodes = NODE_DEFINITIONS.filter(n => n.category === 'transform');
    expect(transformNodes.length).toBeGreaterThan(0);
  });
});

describe('NODE_DEFINITIONS: physics category', () => {
  it('has at least one physics category node', () => {
    const physicsNodes = NODE_DEFINITIONS.filter(n => n.category === 'physics');
    expect(physicsNodes.length).toBeGreaterThan(0);
  });
});

describe('NODE_DEFINITIONS: input category', () => {
  it('has at least one input category node', () => {
    const inputNodes = NODE_DEFINITIONS.filter(n => n.category === 'input');
    expect(inputNodes.length).toBeGreaterThan(0);
  });
});

describe('NODE_DEFINITIONS: audio category', () => {
  it('has at least one audio category node', () => {
    const audioNodes = NODE_DEFINITIONS.filter(n => n.category === 'audio');
    expect(audioNodes.length).toBeGreaterThan(0);
  });
});

describe('NODE_DEFINITIONS: state category', () => {
  it('has at least one state category node', () => {
    const stateNodes = NODE_DEFINITIONS.filter(n => n.category === 'state');
    expect(stateNodes.length).toBeGreaterThan(0);
  });
});

describe('NODE_DEFINITIONS: entity category', () => {
  it('has at least one entity category node', () => {
    const entityNodes = NODE_DEFINITIONS.filter(n => n.category === 'entity');
    expect(entityNodes.length).toBeGreaterThan(0);
  });
});

describe('NODE_DEFINITIONS: ui category', () => {
  it('contains ShowScreen and HideScreen nodes', () => {
    expect(NODE_DEFINITION_MAP['ShowScreen']).not.toBeUndefined();
    expect(NODE_DEFINITION_MAP['HideScreen']).not.toBeUndefined();
  });

  it('ShowScreen has screenName input and exec ports', () => {
    const node = NODE_DEFINITION_MAP['ShowScreen'];
    expect(node.inputs.some(p => p.id === 'exec_in' && p.type === 'exec')).toBe(true);
    expect(node.inputs.some(p => p.id === 'screenName' && p.type === 'string')).toBe(true);
    expect(node.outputs.some(p => p.id === 'exec_out' && p.type === 'exec')).toBe(true);
  });
});
