import { describe, it, expect } from 'vitest';
import { compileToWgsl } from './wgslCompiler';
import type { ShaderGraph } from '@/stores/shaderEditorStore';

/** Helper to create a ShaderGraph with required id/name fields */
let _counter = 0;
function makeGraph(partial: Pick<ShaderGraph, 'nodes' | 'edges'>): ShaderGraph {
  return { id: `test-graph-${++_counter}`, name: 'Test Graph', ...partial };
}

describe('wgslCompiler', () => {
  it('returns error when no PBR Output node exists', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'vertex_position', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('No PBR Output node found');
    expect(result.code).toBe('');
  });

  it('compiles empty graph with only PBR Output', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'pbr_output', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('@fragment');
    expect(result.code).toContain('fn fragment');
    expect(result.code).toContain('pbr_input');
    expect(result.code).toContain('pbr(pbr_input)');
  });

  it('compiles vertex position input node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'vertex_position', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'split_vec3', position: { x: 100, y: 0 }, data: {} },
        { id: '3', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'position', target: '2', targetHandle: 'vector' },
        { id: 'e2', source: '2', sourceHandle: 'x', target: '3', targetHandle: 'metallic' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('in.world_position.xyz');
  });

  it('compiles vertex normal input node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'vertex_normal', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'normal', target: '2', targetHandle: 'normal' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('in.world_normal');
  });

  it('compiles add operation', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'add', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('+');
    expect(result.code).toContain('let var_0');
  });

  it('compiles multiply operation', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'multiply', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('*');
  });

  it('compiles color constant node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'color_constant', position: { x: 0, y: 0 }, data: { color: [1.0, 0.5, 0.25, 1.0] } },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'color', target: '2', targetHandle: 'base_color' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('vec4<f32>(1.0000, 0.5000, 0.2500, 1.0000)');
    expect(result.code).toContain('pbr_input.material.base_color');
  });

  it('compiles split vec3 node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'split_vec3', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('.x');
    expect(result.code).toContain('.y');
    expect(result.code).toContain('.z');
  });

  it('compiles combine vec3 node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'combine_vec3', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('vec3<f32>');
  });

  it('compiles fresnel node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'fresnel', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('pow');
    expect(result.code).toContain('dot');
  });

  it('compiles noise texture node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'noise_texture', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('fract');
    expect(result.code).toContain('sin');
    expect(result.code).toContain('dot');
  });

  it('compiles function calls (sqrt, abs, clamp)', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'sqrt', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'abs', position: { x: 100, y: 0 }, data: {} },
        { id: '3', type: 'clamp', position: { x: 200, y: 0 }, data: {} },
        { id: '4', type: 'pbr_output', position: { x: 300, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('sqrt');
    expect(result.code).toContain('abs');
    expect(result.code).toContain('clamp');
  });

  it('compiles connected nodes with data flow', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'vertex_uv', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'noise_texture', position: { x: 200, y: 0 }, data: {} },
        { id: '3', type: 'multiply', position: { x: 400, y: 0 }, data: {} },
        { id: '4', type: 'pbr_output', position: { x: 600, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'uv', target: '2', targetHandle: 'uv' },
        { id: 'e2', source: '2', sourceHandle: 'value', target: '3', targetHandle: 'a' },
        { id: 'e3', source: '3', sourceHandle: 'result', target: '4', targetHandle: 'metallic' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('in.uv');
    expect(result.code).toContain('pbr_input.material.metallic');
  });

  it('returns error on cyclic dependency', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'add', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'multiply', position: { x: 200, y: 0 }, data: {} },
        { id: '3', type: 'pbr_output', position: { x: 400, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'result', target: '2', targetHandle: 'a' },
        { id: 'e2', source: '2', sourceHandle: 'result', target: '1', targetHandle: 'a' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Cyclic dependency');
  });

  it('handles missing connections with default values', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'add', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'result', target: '2', targetHandle: 'roughness' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('0 + 0');
    expect(result.code).toContain('pbr_input.material.perceptual_roughness');
  });

  it('compiles emissive output connection', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'color_constant', position: { x: 0, y: 0 }, data: { color: [1.0, 0.0, 0.0, 1.0] } },
        { id: '2', type: 'split_vec3', position: { x: 200, y: 0 }, data: {} },
        { id: '3', type: 'pbr_output', position: { x: 400, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'color', target: '2', targetHandle: 'vector' },
        { id: 'e2', source: '2', sourceHandle: 'x', target: '3', targetHandle: 'emissive' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('pbr_input.material.emissive');
  });

  it('compiles normal output connection', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'vertex_normal', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'normalize', position: { x: 200, y: 0 }, data: {} },
        { id: '3', type: 'pbr_output', position: { x: 400, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'normal', target: '2', targetHandle: 'vector' },
        { id: 'e2', source: '2', sourceHandle: 'result', target: '3', targetHandle: 'normal' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('normalize');
    expect(result.code).toContain('pbr_input.N =');
  });
});
