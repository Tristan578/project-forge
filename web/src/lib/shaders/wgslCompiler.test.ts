import { describe, it, expect } from 'vitest';
import { compileToWgsl, compileToMegaShaderSlot } from './wgslCompiler';
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

  // ─── Math operations ────────────────────────────────────────────

  it('compiles subtract operation', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'subtract', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('-');
  });

  it('compiles divide operation', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'divide', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('/');
  });

  it('compiles power node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'power', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('pow(');
  });

  it('compiles lerp node using mix', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'lerp', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('mix(');
  });

  it('compiles step node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'step', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('step(');
  });

  it('compiles smoothstep node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'smoothstep', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('smoothstep(');
  });

  it('compiles trig nodes (sin, cos)', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'sin', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'cos', position: { x: 100, y: 0 }, data: {} },
        { id: '3', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toMatch(/\bsin\(/);
    expect(result.code).toMatch(/\bcos\(/);
  });

  it('compiles fract and floor nodes', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'fract', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'floor', position: { x: 100, y: 0 }, data: {} },
        { id: '3', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('fract(');
    expect(result.code).toContain('floor(');
  });

  // ─── Input nodes ────────────────────────────────────────────────

  it('compiles vertex_uv input node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'vertex_uv', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    // vertex_uv sets varMap but doesn't produce statements by itself
    expect(result.code).toContain('@fragment');
  });

  it('compiles time input node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'time', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'sin', position: { x: 100, y: 0 }, data: {} },
        { id: '3', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'time', target: '2', targetHandle: 'value' },
        { id: 'e2', source: '2', sourceHandle: 'result', target: '3', targetHandle: 'metallic' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('globals.time');
  });

  it('compiles camera_position input node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'camera_position', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'split_vec3', position: { x: 100, y: 0 }, data: {} },
        { id: '3', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'position', target: '2', targetHandle: 'vector' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('view.world_position.xyz');
  });

  // ─── Texture nodes ──────────────────────────────────────────────

  it('compiles texture_sample node with default UVs', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'texture_sample', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'color', target: '2', targetHandle: 'base_color' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('textureSample');
    expect(result.code).toContain('pbr_bindings::base_color_texture');
    expect(result.code).toContain('in.uv'); // Default UV fallback
  });

  it('compiles texture_sample node with connected UVs', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'vertex_uv', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'texture_sample', position: { x: 100, y: 0 }, data: {} },
        { id: '3', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'uv', target: '2', targetHandle: 'uv' },
        { id: 'e2', source: '2', sourceHandle: 'color', target: '3', targetHandle: 'base_color' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('textureSample');
  });

  it('compiles voronoi_texture node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'voronoi_texture', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('vor_p');
    expect(result.code).toContain('min_dist');
    expect(result.code).toContain('neighbor');
  });

  // ─── Color nodes ────────────────────────────────────────────────

  it('compiles hsv_to_rgb node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'hsv_to_rgb', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('hsv_val');
  });

  it('compiles rgb_to_hsv node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'rgb_to_hsv', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('rgb_val');
  });

  it('compiles color_ramp node using mix', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'color_ramp', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('mix(');
  });

  // ─── Vector nodes ───────────────────────────────────────────────

  it('compiles dot_product node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'dot_product', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('dot(');
  });

  it('compiles cross_product node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'cross_product', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('cross(');
  });

  it('compiles normalize node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'normalize', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('normalize(');
  });

  // ─── Lighting nodes ─────────────────────────────────────────────

  it('compiles normal_map node', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'normal_map', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'normal', target: '2', targetHandle: 'normal' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('normal_map_texture');
    expect(result.code).toContain('world_tangent');
    expect(result.code).toContain('pbr_input.N =');
  });

  // ─── Output node fields ─────────────────────────────────────────

  it('compiles alpha output connection', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'add', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'result', target: '2', targetHandle: 'alpha' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('pbr_input.material.base_color.a');
  });

  // ─── Complex pipeline ───────────────────────────────────────────

  it('compiles multi-step pipeline: noise → multiply → color → output', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'vertex_uv', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'noise_texture', position: { x: 100, y: 0 }, data: {} },
        { id: '3', type: 'color_constant', position: { x: 100, y: 100 }, data: { color: [1, 0, 0, 1] } },
        { id: '4', type: 'multiply', position: { x: 200, y: 0 }, data: {} },
        { id: '5', type: 'pbr_output', position: { x: 300, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'uv', target: '2', targetHandle: 'uv' },
        { id: 'e2', source: '2', sourceHandle: 'value', target: '4', targetHandle: 'a' },
        { id: 'e3', source: '3', sourceHandle: 'color', target: '5', targetHandle: 'base_color' },
        { id: 'e4', source: '4', sourceHandle: 'result', target: '5', targetHandle: 'metallic' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('pbr_input.material.base_color');
    expect(result.code).toContain('pbr_input.material.metallic');
    expect(result.code).toContain('in.uv');
  });

  it('handles unknown node types gracefully', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'nonexistent_node_type', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('@fragment');
  });

  it('compiles empty edges array', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'add', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'subtract', position: { x: 100, y: 0 }, data: {} },
        { id: '3', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    // Both nodes should produce code with default values
    expect(result.code).toContain('+');
    expect(result.code).toContain('-');
  });

  it('does not emit normal output when not connected', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'pbr_output', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    // Normal should NOT appear in output when not connected (conditional in generateOutputCode)
    expect(result.code).not.toContain('pbr_input.N =');
  });

  it('compiles color_constant with missing color data', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'color_constant', position: { x: 0, y: 0 }, data: {} }, // No color data
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'color', target: '2', targetHandle: 'base_color' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    // Falls back to [1,1,1,1]
    expect(result.code).toContain('vec4<f32>(1.0000, 1.0000, 1.0000, 1.0000)');
  });

  it('compiles chain: split → combine → output', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'vertex_position', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'split_vec3', position: { x: 100, y: 0 }, data: {} },
        { id: '3', type: 'combine_vec3', position: { x: 200, y: 0 }, data: {} },
        { id: '4', type: 'pbr_output', position: { x: 300, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'position', target: '2', targetHandle: 'vector' },
        { id: 'e2', source: '2', sourceHandle: 'x', target: '3', targetHandle: 'x' },
        { id: 'e3', source: '2', sourceHandle: 'y', target: '3', targetHandle: 'y' },
        { id: 'e4', source: '2', sourceHandle: 'z', target: '3', targetHandle: 'z' },
        { id: 'e5', source: '3', sourceHandle: 'vector', target: '4', targetHandle: 'emissive' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('in.world_position.xyz');
    expect(result.code).toContain('.x');
    expect(result.code).toContain('vec3<f32>(');
    expect(result.code).toContain('pbr_input.material.emissive');
  });

  it('compiles fresnel connected to output', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'vertex_normal', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'camera_position', position: { x: 0, y: 100 }, data: {} },
        { id: '3', type: 'fresnel', position: { x: 200, y: 0 }, data: {} },
        { id: '4', type: 'pbr_output', position: { x: 400, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'normal', target: '3', targetHandle: 'normal' },
        { id: 'e2', source: '2', sourceHandle: 'position', target: '3', targetHandle: 'view' },
        { id: 'e3', source: '3', sourceHandle: 'result', target: '4', targetHandle: 'metallic' },
      ],
    });
    const result = compileToWgsl(graph);
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('pow');
    expect(result.code).toContain('in.world_normal');
    expect(result.code).toContain('view.world_position.xyz');
    expect(result.code).toContain('pbr_input.material.metallic');
  });
});

// ─── compileToMegaShaderSlot ─────────────────────────────────────────────────

describe('compileToMegaShaderSlot', () => {
  it('returns error when no PBR Output node exists', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'add', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToMegaShaderSlot(graph);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('No PBR Output node found');
    expect(result.functionBody).toBe('');
  });

  it('returns error on cyclic dependency', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'add', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'multiply', position: { x: 100, y: 0 }, data: {} },
        { id: '3', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'result', target: '2', targetHandle: 'a' },
        { id: 'e2', source: '2', sourceHandle: 'result', target: '1', targetHandle: 'a' },
      ],
    });
    const result = compileToMegaShaderSlot(graph);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Cyclic');
    expect(result.functionBody).toBe('');
  });

  it('produces function body (not a @fragment entry point) for a minimal graph', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'pbr_output', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToMegaShaderSlot(graph);
    expect(result.error).toBeUndefined();
    // Must NOT contain a fragment entry point — this is a function body only
    expect(result.functionBody).not.toContain('@fragment');
    expect(result.functionBody).not.toContain('fn fragment');
    // Must end with a return statement
    expect(result.functionBody.trim()).toMatch(/return .+;$/);
  });

  it('body uses slot function inputs: color, uv, time', () => {
    // A graph that routes color → output should reference the `color` variable
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'multiply', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'result', target: '2', targetHandle: 'base_color' },
      ],
    });
    const result = compileToMegaShaderSlot(graph);
    expect(result.error).toBeUndefined();
    // The body should contain WGSL statements
    expect(result.functionBody.length).toBeGreaterThan(0);
    // Should end with a return statement pointing to some variable
    expect(result.functionBody.trim()).toMatch(/return \w+;$/);
  });

  it('returns `color` passthrough when output node has no base_color connection', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'pbr_output', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const result = compileToMegaShaderSlot(graph);
    expect(result.error).toBeUndefined();
    // With no connections the final color falls back to the input `color`
    expect(result.functionBody).toContain('return color;');
  });

  it('generates indented statements with leading spaces', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'add', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'result', target: '2', targetHandle: 'base_color' },
      ],
    });
    const result = compileToMegaShaderSlot(graph);
    expect(result.error).toBeUndefined();
    // All lines should start with at least 2 spaces (indentation)
    const lines = result.functionBody.split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      expect(line).toMatch(/^  /);
    }
  });

  it('compiles a graph using time node (slot input variable)', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'time', position: { x: 0, y: 0 }, data: {} },
        { id: '2', type: 'sin', position: { x: 100, y: 0 }, data: {} },
        { id: '3', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'time', target: '2', targetHandle: 'value' },
        { id: 'e2', source: '2', sourceHandle: 'result', target: '3', targetHandle: 'base_color' },
      ],
    });
    const result = compileToMegaShaderSlot(graph);
    expect(result.error).toBeUndefined();
    expect(result.functionBody).toContain('sin(');
  });

  it('does not produce @vertex or struct declarations in body', () => {
    const graph = makeGraph({
      nodes: [
        { id: '1', type: 'color_constant', position: { x: 0, y: 0 }, data: { color: [0.2, 0.4, 0.6, 1.0] } },
        { id: '2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: '1', sourceHandle: 'color', target: '2', targetHandle: 'base_color' },
      ],
    });
    const result = compileToMegaShaderSlot(graph);
    expect(result.error).toBeUndefined();
    expect(result.functionBody).not.toContain('@vertex');
    expect(result.functionBody).not.toContain('struct ');
    expect(result.functionBody).not.toContain('fn ');
  });
});
