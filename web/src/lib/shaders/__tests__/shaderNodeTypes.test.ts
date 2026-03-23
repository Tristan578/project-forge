/**
 * Unit tests for shader node type definitions (shaderNodeTypes.ts).
 *
 * Verifies structural integrity of the SHADER_NODE_DEFINITIONS registry,
 * SHADER_PORT_COMPATIBILITY matrix, and SHADER_NODE_CATEGORIES palette.
 *
 * Tests:
 *  - Every node definition has required fields: type, category, label, description, inputs, outputs
 *  - All port ids, labels, and types are valid
 *  - No duplicate node keys in the registry
 *  - Known input/math/texture/color/vector/lighting/output nodes exist
 *  - Port compatibility matrix covers all ShaderDataTypes
 *  - SHADER_NODE_CATEGORIES covers all expected category ids
 */

import { describe, it, expect } from 'vitest';
import {
  SHADER_NODE_DEFINITIONS,
  SHADER_PORT_COMPATIBILITY,
  SHADER_NODE_CATEGORIES,
} from '@/lib/shaders/shaderNodeTypes';

// ── helpers ───────────────────────────────────────────────────────────────────

const VALID_SHADER_TYPES = ['float', 'vec2', 'vec3', 'vec4', 'color', 'texture2d', 'exec'] as const;

function isValidShaderType(type: string): boolean {
  return (VALID_SHADER_TYPES as readonly string[]).includes(type);
}

// ── SHADER_NODE_DEFINITIONS: structural integrity ──────────────────────────────

describe('SHADER_NODE_DEFINITIONS: basic structure', () => {
  it('is a non-empty object', () => {
    expect(typeof SHADER_NODE_DEFINITIONS).toBe('object');
    expect(SHADER_NODE_DEFINITIONS).not.toBeNull();
    expect(Object.keys(SHADER_NODE_DEFINITIONS).length).toBeGreaterThan(0);
  });

  it('contains at least 20 node definitions', () => {
    expect(Object.keys(SHADER_NODE_DEFINITIONS).length).toBeGreaterThanOrEqual(20);
  });

  it('every entry key matches the node type field', () => {
    for (const [key, node] of Object.entries(SHADER_NODE_DEFINITIONS)) {
      expect(key).toBe(node.type);
    }
  });

  it('every node has a non-empty type string', () => {
    for (const node of Object.values(SHADER_NODE_DEFINITIONS)) {
      expect(typeof node.type).toBe('string');
      expect(node.type.length).toBeGreaterThan(0);
    }
  });

  it('every node has a non-empty category string', () => {
    for (const node of Object.values(SHADER_NODE_DEFINITIONS)) {
      expect(typeof node.category).toBe('string');
      expect(node.category.length).toBeGreaterThan(0);
    }
  });

  it('every node has a non-empty label string', () => {
    for (const node of Object.values(SHADER_NODE_DEFINITIONS)) {
      expect(typeof node.label).toBe('string');
      expect(node.label.length).toBeGreaterThan(0);
    }
  });

  it('every node has a non-empty description string', () => {
    for (const node of Object.values(SHADER_NODE_DEFINITIONS)) {
      expect(typeof node.description).toBe('string');
      expect(node.description.length).toBeGreaterThan(0);
    }
  });

  it('every node has inputs and outputs arrays', () => {
    for (const node of Object.values(SHADER_NODE_DEFINITIONS)) {
      expect(Array.isArray(node.inputs)).toBe(true);
      expect(Array.isArray(node.outputs)).toBe(true);
    }
  });
});

// ── port definitions ──────────────────────────────────────────────────────────

describe('SHADER_NODE_DEFINITIONS: port definitions', () => {
  it('every input port has a non-empty id', () => {
    for (const node of Object.values(SHADER_NODE_DEFINITIONS)) {
      for (const port of node.inputs) {
        expect(typeof port.id).toBe('string');
        expect(port.id.length).toBeGreaterThan(0);
      }
    }
  });

  it('every input port has a label string', () => {
    for (const node of Object.values(SHADER_NODE_DEFINITIONS)) {
      for (const port of node.inputs) {
        expect(typeof port.label).toBe('string');
      }
    }
  });

  it('every input port has a valid ShaderDataType', () => {
    for (const node of Object.values(SHADER_NODE_DEFINITIONS)) {
      for (const port of node.inputs) {
        expect(isValidShaderType(port.type)).toBe(true);
      }
    }
  });

  it('every output port has a non-empty id', () => {
    for (const node of Object.values(SHADER_NODE_DEFINITIONS)) {
      for (const port of node.outputs) {
        expect(typeof port.id).toBe('string');
        expect(port.id.length).toBeGreaterThan(0);
      }
    }
  });

  it('every output port has a valid ShaderDataType', () => {
    for (const node of Object.values(SHADER_NODE_DEFINITIONS)) {
      for (const port of node.outputs) {
        expect(isValidShaderType(port.type)).toBe(true);
      }
    }
  });

  it('no duplicate port ids within a node inputs list', () => {
    for (const node of Object.values(SHADER_NODE_DEFINITIONS)) {
      const ids = node.inputs.map(p => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('no duplicate port ids within a node outputs list', () => {
    for (const node of Object.values(SHADER_NODE_DEFINITIONS)) {
      const ids = node.outputs.map(p => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

// ── input category nodes ───────────────────────────────────────────────────────

describe('SHADER_NODE_DEFINITIONS: input category', () => {
  it('contains vertex_position node with vec3 output', () => {
    const node = SHADER_NODE_DEFINITIONS['vertex_position'];
    expect(node).not.toBeNull();
    expect(node.category).toBe('input');
    expect(node.inputs).toHaveLength(0);
    expect(node.outputs.some(p => p.id === 'position' && p.type === 'vec3')).toBe(true);
  });

  it('contains vertex_normal node with vec3 output', () => {
    const node = SHADER_NODE_DEFINITIONS['vertex_normal'];
    expect(node).not.toBeNull();
    expect(node.outputs.some(p => p.type === 'vec3')).toBe(true);
  });

  it('contains vertex_uv node with vec2 output', () => {
    const node = SHADER_NODE_DEFINITIONS['vertex_uv'];
    expect(node).not.toBeNull();
    expect(node.outputs.some(p => p.id === 'uv' && p.type === 'vec2')).toBe(true);
  });

  it('contains time node with float output', () => {
    const node = SHADER_NODE_DEFINITIONS['time'];
    expect(node).not.toBeNull();
    expect(node.outputs.some(p => p.id === 'time' && p.type === 'float')).toBe(true);
  });

  it('contains camera_position node', () => {
    expect(SHADER_NODE_DEFINITIONS['camera_position']).toBeDefined();
  });
});

// ── math category nodes ────────────────────────────────────────────────────────

describe('SHADER_NODE_DEFINITIONS: math category', () => {
  const mathOps = ['add', 'subtract', 'multiply', 'divide'];

  it.each(mathOps)('contains %s node', (op) => {
    expect(SHADER_NODE_DEFINITIONS[op]).toBeDefined();
    expect(SHADER_NODE_DEFINITIONS[op].category).toBe('math');
  });

  it('add node has a/b inputs and result output', () => {
    const node = SHADER_NODE_DEFINITIONS['add'];
    expect(node.inputs.some(p => p.id === 'a')).toBe(true);
    expect(node.inputs.some(p => p.id === 'b')).toBe(true);
    expect(node.outputs.some(p => p.id === 'result')).toBe(true);
  });

  it('contains clamp node with value/min/max inputs', () => {
    const node = SHADER_NODE_DEFINITIONS['clamp'];
    expect(node).not.toBeNull();
    expect(node.inputs.some(p => p.id === 'value')).toBe(true);
    expect(node.inputs.some(p => p.id === 'min')).toBe(true);
    expect(node.inputs.some(p => p.id === 'max')).toBe(true);
  });

  it('contains lerp node with a/b/t inputs', () => {
    const node = SHADER_NODE_DEFINITIONS['lerp'];
    expect(node).not.toBeNull();
    expect(node.inputs.some(p => p.id === 'a')).toBe(true);
    expect(node.inputs.some(p => p.id === 'b')).toBe(true);
    expect(node.inputs.some(p => p.id === 't')).toBe(true);
  });

  it('contains sin and cos trig nodes', () => {
    expect(SHADER_NODE_DEFINITIONS['sin']).toBeDefined();
    expect(SHADER_NODE_DEFINITIONS['cos']).toBeDefined();
  });

  it('contains smoothstep node with edge0/edge1/value', () => {
    const node = SHADER_NODE_DEFINITIONS['smoothstep'];
    expect(node).not.toBeNull();
    expect(node.inputs.some(p => p.id === 'edge0')).toBe(true);
    expect(node.inputs.some(p => p.id === 'edge1')).toBe(true);
  });

  it('contains power node with base/exponent inputs', () => {
    const node = SHADER_NODE_DEFINITIONS['power'];
    expect(node).not.toBeNull();
    expect(node.inputs.some(p => p.id === 'base')).toBe(true);
    expect(node.inputs.some(p => p.id === 'exponent')).toBe(true);
  });
});

// ── texture category ───────────────────────────────────────────────────────────

describe('SHADER_NODE_DEFINITIONS: texture category', () => {
  it('contains texture_sample node', () => {
    const node = SHADER_NODE_DEFINITIONS['texture_sample'];
    expect(node).not.toBeNull();
    expect(node.category).toBe('texture');
    expect(node.inputs.some(p => p.type === 'texture2d')).toBe(true);
    expect(node.inputs.some(p => p.type === 'vec2')).toBe(true);
  });

  it('texture_sample has color output', () => {
    const node = SHADER_NODE_DEFINITIONS['texture_sample'];
    expect(node.outputs.some(p => p.id === 'color')).toBe(true);
  });

  it('contains noise_texture node', () => {
    expect(SHADER_NODE_DEFINITIONS['noise_texture']).toBeDefined();
  });
});

// ── vector category ────────────────────────────────────────────────────────────

describe('SHADER_NODE_DEFINITIONS: vector category', () => {
  it('contains normalize node', () => {
    const node = SHADER_NODE_DEFINITIONS['normalize'];
    expect(node).not.toBeNull();
    expect(node.category).toBe('vector');
  });

  it('contains dot_product node with float output', () => {
    const node = SHADER_NODE_DEFINITIONS['dot_product'];
    expect(node).not.toBeNull();
    expect(node.outputs.some(p => p.type === 'float')).toBe(true);
  });

  it('contains cross_product node with vec3 output', () => {
    const node = SHADER_NODE_DEFINITIONS['cross_product'];
    expect(node).not.toBeNull();
    expect(node.outputs.some(p => p.type === 'vec3')).toBe(true);
  });
});

// ── lighting category ──────────────────────────────────────────────────────────

describe('SHADER_NODE_DEFINITIONS: lighting category', () => {
  it('contains fresnel node', () => {
    const node = SHADER_NODE_DEFINITIONS['fresnel'];
    expect(node).not.toBeNull();
    expect(node.category).toBe('lighting');
    expect(node.inputs.some(p => p.id === 'normal')).toBe(true);
    expect(node.inputs.some(p => p.id === 'view')).toBe(true);
    expect(node.inputs.some(p => p.id === 'power')).toBe(true);
  });

  it('contains normal_map node with strength input', () => {
    const node = SHADER_NODE_DEFINITIONS['normal_map'];
    expect(node).not.toBeNull();
    expect(node.inputs.some(p => p.id === 'strength')).toBe(true);
    expect(node.outputs.some(p => p.id === 'normal')).toBe(true);
  });
});

// ── output node ────────────────────────────────────────────────────────────────

describe('SHADER_NODE_DEFINITIONS: output node (pbr_output)', () => {
  it('contains pbr_output node', () => {
    const node = SHADER_NODE_DEFINITIONS['pbr_output'];
    expect(node).not.toBeNull();
    expect(node.category).toBe('output');
  });

  it('pbr_output has no outputs (terminal node)', () => {
    const node = SHADER_NODE_DEFINITIONS['pbr_output'];
    expect(node.outputs).toHaveLength(0);
  });

  it('pbr_output has base_color, metallic, roughness inputs', () => {
    const node = SHADER_NODE_DEFINITIONS['pbr_output'];
    expect(node.inputs.some(p => p.id === 'base_color')).toBe(true);
    expect(node.inputs.some(p => p.id === 'metallic')).toBe(true);
    expect(node.inputs.some(p => p.id === 'roughness')).toBe(true);
  });

  it('pbr_output has normal, emissive, alpha inputs', () => {
    const node = SHADER_NODE_DEFINITIONS['pbr_output'];
    expect(node.inputs.some(p => p.id === 'normal')).toBe(true);
    expect(node.inputs.some(p => p.id === 'emissive')).toBe(true);
    expect(node.inputs.some(p => p.id === 'alpha')).toBe(true);
  });
});

// ── SHADER_PORT_COMPATIBILITY ──────────────────────────────────────────────────

describe('SHADER_PORT_COMPATIBILITY: type compatibility matrix', () => {
  it('is a non-null object', () => {
    expect(typeof SHADER_PORT_COMPATIBILITY).toBe('object');
    expect(SHADER_PORT_COMPATIBILITY).not.toBeNull();
  });

  it('has an entry for every ShaderDataType', () => {
    for (const type of VALID_SHADER_TYPES) {
      expect(SHADER_PORT_COMPATIBILITY[type]).toBeDefined();
    }
  });

  it('each compatibility list is a non-empty array', () => {
    for (const [, compatible] of Object.entries(SHADER_PORT_COMPATIBILITY)) {
      expect(Array.isArray(compatible)).toBe(true);
      expect(compatible.length).toBeGreaterThan(0);
    }
  });

  it('every type is compatible with itself', () => {
    for (const type of VALID_SHADER_TYPES) {
      expect(SHADER_PORT_COMPATIBILITY[type]).toContain(type);
    }
  });

  it('float is only compatible with float', () => {
    expect(SHADER_PORT_COMPATIBILITY['float']).toEqual(['float']);
  });

  it('color is compatible with vec3, vec4, and color', () => {
    const compat = SHADER_PORT_COMPATIBILITY['color'];
    expect(compat).toContain('vec3');
    expect(compat).toContain('vec4');
    expect(compat).toContain('color');
  });

  it('vec3 is compatible with color', () => {
    expect(SHADER_PORT_COMPATIBILITY['vec3']).toContain('color');
  });
});

// ── SHADER_NODE_CATEGORIES ────────────────────────────────────────────────────

describe('SHADER_NODE_CATEGORIES: palette display', () => {
  const expectedCategoryIds = ['input', 'math', 'texture', 'color', 'vector', 'lighting', 'output'];

  it('is a non-empty array', () => {
    expect(Array.isArray(SHADER_NODE_CATEGORIES)).toBe(true);
    expect(SHADER_NODE_CATEGORIES.length).toBeGreaterThan(0);
  });

  it('covers all expected category ids', () => {
    const ids = SHADER_NODE_CATEGORIES.map(c => c.id);
    for (const expected of expectedCategoryIds) {
      expect(ids).toContain(expected);
    }
  });

  it('every category has a non-empty label', () => {
    for (const cat of SHADER_NODE_CATEGORIES) {
      expect(typeof cat.label).toBe('string');
      expect(cat.label.length).toBeGreaterThan(0);
    }
  });

  it('every category has a color hex string', () => {
    for (const cat of SHADER_NODE_CATEGORIES) {
      expect(cat.color).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    }
  });

  it('no duplicate category ids', () => {
    const ids = SHADER_NODE_CATEGORIES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
