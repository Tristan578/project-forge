/**
 * WGSL Shader Compiler
 * Converts shader node graphs to WGSL fragment shader code.
 */

import type { ShaderGraph, ShaderNode, ShaderEdge } from '@/stores/shaderEditorStore';
import { SHADER_NODE_DEFINITIONS, type ShaderDataType } from './shaderNodeTypes';

interface CompilerContext {
  varCounter: number;
  statements: string[];
  varMap: Map<string, string>; // nodeId:outputId -> wgsl var name
}

/**
 * Result of compiling a node graph to a mega-shader slot function body.
 */
export interface MegaShaderCompileResult {
  /** WGSL function body (without the fn signature wrapper). */
  functionBody: string;
  error?: string;
}

/**
 * Compile a shader graph to a WGSL function body suitable for the mega-shader registry.
 *
 * The output can be passed directly to `register_custom_shader` as `wgslCode`.
 * The body operates on the `color` input (PBR-lit) and must return `vec4<f32>`.
 *
 * Available variables inside the body:
 *   color: vec4<f32>   — PBR lit fragment color
 *   uv: vec2<f32>      — texture coordinates
 *   time: f32          — elapsed seconds
 *   params: array<f32, 16> — float parameters
 */
export function compileToMegaShaderSlot(graph: ShaderGraph): MegaShaderCompileResult {
  try {
    const ctx: CompilerContext = {
      varCounter: 0,
      statements: [],
      varMap: new Map(),
    };

    // Seed the variable map with slot function inputs.
    // Graph nodes that reference vertex attributes can use these names.
    ctx.varMap.set('__slot_color', 'color');
    ctx.varMap.set('__slot_uv', 'uv');
    ctx.varMap.set('__slot_time', 'time');

    const outputNode = graph.nodes.find((n) => n.type === 'pbr_output');
    if (!outputNode) {
      return { functionBody: '', error: 'No PBR Output node found.' };
    }

    const sortedNodes = topologicalSort(graph);
    if (!sortedNodes) {
      return { functionBody: '', error: 'Cyclic dependency detected.' };
    }

    for (const node of sortedNodes) {
      if (node.type === 'pbr_output') continue;
      generateNodeCode(node, graph.edges, ctx);
    }

    // For the mega-shader slot the output is always the final color.
    // Find what is connected to the base_color input of the output node.
    const baseColorEdge = graph.edges.find(
      (e) => e.target === outputNode.id && e.targetHandle === 'base_color',
    );
    const finalColor = baseColorEdge
      ? (ctx.varMap.get(`${baseColorEdge.source}:${baseColorEdge.sourceHandle}`) ?? 'color')
      : 'color';

    const body = [
      ...ctx.statements,
      `return ${finalColor};`,
    ].map((s) => `  ${s}`).join('\n');

    return { functionBody: body };
  } catch (err) {
    return {
      functionBody: '',
      error: err instanceof Error ? err.message : 'Compilation failed',
    };
  }
}

/**
 * Compile a shader graph to WGSL fragment shader code.
 */
export function compileToWgsl(graph: ShaderGraph): { code: string; error?: string } {
  try {
    const ctx: CompilerContext = {
      varCounter: 0,
      statements: [],
      varMap: new Map(),
    };

    // Find the output node
    const outputNode = graph.nodes.find((n) => n.type === 'pbr_output');
    if (!outputNode) {
      return { code: '', error: 'No PBR Output node found. Add a PBR Output node to complete the shader.' };
    }

    // Build dependency graph
    const sortedNodes = topologicalSort(graph);
    if (!sortedNodes) {
      return { code: '', error: 'Cyclic dependency detected in shader graph.' };
    }

    // Generate code for each node in topological order
    for (const node of sortedNodes) {
      if (node.type === 'pbr_output') continue; // Output handled separately
      generateNodeCode(node, graph.edges, ctx);
    }

    // Generate final output assignments
    const outputCode = generateOutputCode(outputNode, graph.edges, ctx);

    // Assemble final shader
    const shaderCode = assembleShader(ctx.statements, outputCode);
    return { code: shaderCode };
  } catch (err) {
    return {
      code: '',
      error: err instanceof Error ? err.message : 'Compilation failed',
    };
  }
}

/**
 * Topological sort of nodes to ensure dependencies are computed before use.
 */
function topologicalSort(graph: ShaderGraph): ShaderNode[] | null {
  const { nodes, edges } = graph;
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  // Initialize
  nodes.forEach((n) => {
    inDegree.set(n.id, 0);
    adjList.set(n.id, []);
  });

  // Build adjacency list and in-degree counts
  edges.forEach((e) => {
    adjList.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
  });

  // Kahn's algorithm
  const queue: string[] = [];
  inDegree.forEach((degree, nodeId) => {
    if (degree === 0) queue.push(nodeId);
  });

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    adjList.get(current)?.forEach((neighbor) => {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    });
  }

  // Check for cycles
  if (sorted.length !== nodes.length) {
    return null; // Cycle detected
  }

  return sorted.map((id) => nodes.find((n) => n.id === id)!);
}

/**
 * Generate WGSL code for a single node.
 */
function generateNodeCode(node: ShaderNode, edges: ShaderEdge[], ctx: CompilerContext): void {
  const def = SHADER_NODE_DEFINITIONS[node.type];
  if (!def) return;

  // Get input values (either from connected nodes or default values)
  const inputs: Record<string, string> = {};
  def.inputs.forEach((input) => {
    const edge = edges.find((e) => e.target === node.id && e.targetHandle === input.id);
    if (edge) {
      // Use connected value
      const varName = ctx.varMap.get(`${edge.source}:${edge.sourceHandle}`);
      inputs[input.id] = varName || getDefaultValue(input.type, input.defaultValue);
    } else {
      // Use default value
      inputs[input.id] = getDefaultValue(input.type, input.defaultValue);
    }
  });

  // Generate code based on node type
  switch (node.type) {
    // Input nodes
    case 'vertex_position':
      ctx.varMap.set(`${node.id}:position`, 'in.world_position.xyz');
      break;
    case 'vertex_normal':
      ctx.varMap.set(`${node.id}:normal`, 'in.world_normal');
      break;
    case 'vertex_uv':
      ctx.varMap.set(`${node.id}:uv`, 'in.uv');
      break;
    case 'time':
      ctx.varMap.set(`${node.id}:time`, 'globals.time');
      break;
    case 'camera_position':
      ctx.varMap.set(`${node.id}:position`, 'view.world_position.xyz');
      break;

    // Math nodes
    case 'add':
      emitBinaryOp(node, inputs, '+', ctx);
      break;
    case 'subtract':
      emitBinaryOp(node, inputs, '-', ctx);
      break;
    case 'multiply':
      emitBinaryOp(node, inputs, '*', ctx);
      break;
    case 'divide':
      emitBinaryOp(node, inputs, '/', ctx);
      break;
    case 'power':
      emitFunctionCall(node, 'pow', [inputs.base, inputs.exponent], 'f32', ctx);
      break;
    case 'sqrt':
      emitFunctionCall(node, 'sqrt', [inputs.value], 'f32', ctx);
      break;
    case 'abs':
      emitFunctionCall(node, 'abs', [inputs.value], 'f32', ctx);
      break;
    case 'clamp':
      emitFunctionCall(node, 'clamp', [inputs.value, inputs.min, inputs.max], 'f32', ctx);
      break;
    case 'lerp':
      emitFunctionCall(node, 'mix', [inputs.a, inputs.b, inputs.t], 'f32', ctx);
      break;
    case 'step':
      emitFunctionCall(node, 'step', [inputs.edge, inputs.value], 'f32', ctx);
      break;
    case 'smoothstep':
      emitFunctionCall(node, 'smoothstep', [inputs.edge0, inputs.edge1, inputs.value], 'f32', ctx);
      break;
    case 'sin':
      emitFunctionCall(node, 'sin', [inputs.value], 'f32', ctx);
      break;
    case 'cos':
      emitFunctionCall(node, 'cos', [inputs.value], 'f32', ctx);
      break;
    case 'fract':
      emitFunctionCall(node, 'fract', [inputs.value], 'f32', ctx);
      break;
    case 'floor':
      emitFunctionCall(node, 'floor', [inputs.value], 'f32', ctx);
      break;

    // Texture nodes
    case 'texture_sample':
      emitTextureSample(node, inputs, ctx);
      break;
    case 'noise_texture':
      emitNoiseTexture(node, inputs, ctx);
      break;
    case 'voronoi_texture':
      emitVoronoiTexture(node, inputs, ctx);
      break;

    // Color nodes
    case 'color_constant':
      emitColorConstant(node, ctx);
      break;
    case 'hsv_to_rgb':
      emitHsvToRgb(node, inputs, ctx);
      break;
    case 'rgb_to_hsv':
      emitRgbToHsv(node, inputs, ctx);
      break;
    case 'color_ramp':
      emitFunctionCall(node, 'mix', [inputs.color_a, inputs.color_b, inputs.t], 'vec4<f32>', ctx);
      break;

    // Vector nodes
    case 'split_vec3':
      emitSplitVec3(node, inputs, ctx);
      break;
    case 'combine_vec3':
      emitCombineVec3(node, inputs, ctx);
      break;
    case 'normalize':
      emitFunctionCall(node, 'normalize', [inputs.vector], 'vec3<f32>', ctx);
      break;
    case 'dot_product':
      emitFunctionCall(node, 'dot', [inputs.a, inputs.b], 'f32', ctx);
      break;
    case 'cross_product':
      emitFunctionCall(node, 'cross', [inputs.a, inputs.b], 'vec3<f32>', ctx);
      break;

    // Lighting nodes
    case 'fresnel':
      emitFresnel(node, inputs, ctx);
      break;
    case 'normal_map':
      emitNormalMap(node, inputs, ctx);
      break;
  }
}

function emitBinaryOp(node: ShaderNode, inputs: Record<string, string>, op: string, ctx: CompilerContext): void {
  const varName = `var_${ctx.varCounter++}`;
  ctx.statements.push(`let ${varName} = ${inputs.a} ${op} ${inputs.b};`);
  ctx.varMap.set(`${node.id}:result`, varName);
}

function emitFunctionCall(
  node: ShaderNode,
  funcName: string,
  args: string[],
  returnType: string,
  ctx: CompilerContext
): void {
  const varName = `var_${ctx.varCounter++}`;
  const def = SHADER_NODE_DEFINITIONS[node.type];
  const outputId = def.outputs[0]?.id || 'result';
  ctx.statements.push(`let ${varName}: ${returnType} = ${funcName}(${args.join(', ')});`);
  ctx.varMap.set(`${node.id}:${outputId}`, varName);
}

function emitTextureSample(node: ShaderNode, inputs: Record<string, string>, ctx: CompilerContext): void {
  const varName = `var_${ctx.varCounter++}`;
  // Use mesh UVs when the UV input is unconnected (synthetic default is vec2<f32>(0.0, 0.0))
  const uv = inputs.uv && !inputs.uv.includes('vec2<f32>(0.0') ? inputs.uv : 'in.uv';
  // Sample from the material's base color texture using Bevy's PBR bindings
  ctx.statements.push(`let ${varName} = textureSample(pbr_bindings::base_color_texture, pbr_bindings::base_color_sampler, ${uv});`);
  ctx.varMap.set(`${node.id}:color`, varName);
}

function emitNoiseTexture(node: ShaderNode, inputs: Record<string, string>, ctx: CompilerContext): void {
  const varName = `var_${ctx.varCounter++}`;
  // Simple procedural noise (expand later)
  ctx.statements.push(`let ${varName} = fract(sin(dot(${inputs.uv} * ${inputs.scale}, vec2<f32>(12.9898, 78.233))) * 43758.5453);`);
  ctx.varMap.set(`${node.id}:value`, varName);
}

function emitVoronoiTexture(node: ShaderNode, inputs: Record<string, string>, ctx: CompilerContext): void {
  const distVar = `var_${ctx.varCounter++}`;
  const colorVar = `var_${ctx.varCounter++}`;
  const cellVar = `vor_cell_${ctx.varCounter}`;
  const uv = inputs.uv && !inputs.uv.includes('vec2<f32>(0.0') ? inputs.uv : 'in.uv';
  const scale = inputs.scale || '5.0';

  // Voronoi cellular noise: find nearest cell center using hash-based random offsets
  ctx.statements.push(`
    var ${distVar} = 1.0;
    var ${colorVar} = vec3<f32>(0.0);
    {
      let vor_p = ${uv} * ${scale};
      let vor_ip = floor(vor_p);
      let vor_fp = fract(vor_p);
      var min_dist = 1.0;
      var ${cellVar} = vec2<f32>(0.0);
      for (var j: i32 = -1; j <= 1; j = j + 1) {
        for (var i: i32 = -1; i <= 1; i = i + 1) {
          let neighbor = vec2<f32>(f32(i), f32(j));
          let cell_id = vor_ip + neighbor;
          let cell_hash = fract(sin(dot(cell_id, vec2<f32>(127.1, 311.7))) * 43758.5453);
          let cell_hash2 = fract(sin(dot(cell_id, vec2<f32>(269.5, 183.3))) * 43758.5453);
          let cell_offset = vec2<f32>(cell_hash, cell_hash2);
          let diff = neighbor + cell_offset - vor_fp;
          let d = dot(diff, diff);
          if (d < min_dist) {
            min_dist = d;
            ${cellVar} = cell_id;
          }
        }
      }
      ${distVar} = sqrt(min_dist);
      let ch = fract(sin(dot(${cellVar}, vec2<f32>(127.1, 311.7))) * 43758.5453);
      let ch2 = fract(sin(dot(${cellVar}, vec2<f32>(269.5, 183.3))) * 43758.5453);
      let ch3 = fract(sin(dot(${cellVar}, vec2<f32>(419.2, 371.9))) * 43758.5453);
      ${colorVar} = vec3<f32>(ch, ch2, ch3);
    }`);
  ctx.varMap.set(`${node.id}:distance`, distVar);
  ctx.varMap.set(`${node.id}:color`, colorVar);
}

function emitColorConstant(node: ShaderNode, ctx: CompilerContext): void {
  const color = (node.data.color as number[]) || [1, 1, 1, 1];
  const varName = `var_${ctx.varCounter++}`;
  ctx.statements.push(`let ${varName} = vec4<f32>(${color.map((c) => c.toFixed(4)).join(', ')});`);
  ctx.varMap.set(`${node.id}:color`, varName);
}

function emitSplitVec3(node: ShaderNode, inputs: Record<string, string>, ctx: CompilerContext): void {
  const xVar = `var_${ctx.varCounter++}`;
  const yVar = `var_${ctx.varCounter++}`;
  const zVar = `var_${ctx.varCounter++}`;
  ctx.statements.push(`let ${xVar} = ${inputs.vector}.x;`);
  ctx.statements.push(`let ${yVar} = ${inputs.vector}.y;`);
  ctx.statements.push(`let ${zVar} = ${inputs.vector}.z;`);
  ctx.varMap.set(`${node.id}:x`, xVar);
  ctx.varMap.set(`${node.id}:y`, yVar);
  ctx.varMap.set(`${node.id}:z`, zVar);
}

function emitCombineVec3(node: ShaderNode, inputs: Record<string, string>, ctx: CompilerContext): void {
  const varName = `var_${ctx.varCounter++}`;
  ctx.statements.push(`let ${varName} = vec3<f32>(${inputs.x}, ${inputs.y}, ${inputs.z});`);
  ctx.varMap.set(`${node.id}:vector`, varName);
}

function emitHsvToRgb(node: ShaderNode, inputs: Record<string, string>, ctx: CompilerContext): void {
  const varName = `var_${ctx.varCounter++}`;
  // HSV to RGB conversion
  ctx.statements.push(`
    let hsv_val = ${inputs.hsv};
    let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    let p = abs(fract(hsv_val.xxx + K.xyz) * 6.0 - K.www);
    let ${varName} = hsv_val.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), hsv_val.y);
  `);
  ctx.varMap.set(`${node.id}:rgb`, varName);
}

function emitRgbToHsv(node: ShaderNode, inputs: Record<string, string>, ctx: CompilerContext): void {
  const varName = `var_${ctx.varCounter++}`;
  // RGB to HSV conversion
  ctx.statements.push(`
    let rgb_val = ${inputs.rgb};
    let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    let p = mix(vec4<f32>(rgb_val.bg, K.wz), vec4<f32>(rgb_val.gb, K.xy), step(rgb_val.b, rgb_val.g));
    let q = mix(vec4<f32>(p.xyw, rgb_val.r), vec4<f32>(rgb_val.r, p.yzx), step(p.x, rgb_val.r));
    let d = q.x - min(q.w, q.y);
    let e = 1.0e-10;
    let ${varName} = vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  `);
  ctx.varMap.set(`${node.id}:hsv`, varName);
}

function emitFresnel(node: ShaderNode, inputs: Record<string, string>, ctx: CompilerContext): void {
  const varName = `var_${ctx.varCounter++}`;
  ctx.statements.push(`let ${varName} = pow(1.0 - max(dot(${inputs.normal}, ${inputs.view}), 0.0), ${inputs.power});`);
  ctx.varMap.set(`${node.id}:result`, varName);
}

function emitNormalMap(node: ShaderNode, inputs: Record<string, string>, ctx: CompilerContext): void {
  const varName = `var_${ctx.varCounter++}`;
  // Use mesh UVs when the UV input is unconnected (synthetic default is vec2<f32>(0.0, 0.0))
  const uv = inputs.uv && !inputs.uv.includes('vec2<f32>(0.0') ? inputs.uv : 'in.uv';
  const strength = inputs.strength || '1.0';

  // Sample normal map texture and transform from tangent space to world space
  ctx.statements.push(`
    let ${varName}_raw = textureSample(pbr_bindings::normal_map_texture, pbr_bindings::normal_map_sampler, ${uv}).xyz;
    let ${varName}_tangent = ${varName}_raw * 2.0 - 1.0;
    let ${varName}_scaled = vec3<f32>(${varName}_tangent.xy * ${strength}, ${varName}_tangent.z);
    let ${varName} = normalize(
      ${varName}_scaled.x * normalize(in.world_tangent.xyz) +
      ${varName}_scaled.y * normalize(cross(in.world_normal, in.world_tangent.xyz) * in.world_tangent.w) +
      ${varName}_scaled.z * in.world_normal
    );`);
  ctx.varMap.set(`${node.id}:normal`, varName);
}

/**
 * Generate output code for the PBR Output node.
 */
function generateOutputCode(outputNode: ShaderNode, edges: ShaderEdge[], ctx: CompilerContext): string {
  const def = SHADER_NODE_DEFINITIONS.pbr_output;
  const outputs: string[] = [];

  def.inputs.forEach((input) => {
    const edge = edges.find((e) => e.target === outputNode.id && e.targetHandle === input.id);
    const value = edge
      ? ctx.varMap.get(`${edge.source}:${edge.sourceHandle}`) || getDefaultValue(input.type, input.defaultValue)
      : getDefaultValue(input.type, input.defaultValue);

    // Map to pbr_input struct fields (assuming Bevy's PBR material structure)
    switch (input.id) {
      case 'base_color':
        outputs.push(`pbr_input.material.base_color = ${value};`);
        break;
      case 'metallic':
        outputs.push(`pbr_input.material.metallic = ${value};`);
        break;
      case 'roughness':
        outputs.push(`pbr_input.material.perceptual_roughness = ${value};`);
        break;
      case 'normal':
        if (edge) {
          outputs.push(`pbr_input.N = ${value};`);
        }
        break;
      case 'emissive':
        outputs.push(`pbr_input.material.emissive = vec4<f32>(${value}, 1.0);`);
        break;
      case 'alpha':
        outputs.push(`pbr_input.material.base_color.a = ${value};`);
        break;
    }
  });

  return outputs.join('\n  ');
}

/**
 * Get default value representation in WGSL.
 */
function getDefaultValue(type: ShaderDataType, defaultValue: unknown): string {
  if (defaultValue !== undefined) {
    if (Array.isArray(defaultValue)) {
      return `vec${defaultValue.length}<f32>(${defaultValue.join(', ')})`;
    }
    return String(defaultValue);
  }

  switch (type) {
    case 'float':
      return '0.0';
    case 'vec2':
      return 'vec2<f32>(0.0, 0.0)';
    case 'vec3':
    case 'color':
      return 'vec3<f32>(0.0, 0.0, 0.0)';
    case 'vec4':
      return 'vec4<f32>(0.0, 0.0, 0.0, 1.0)';
    default:
      return '0.0';
  }
}

/**
 * Assemble the final WGSL shader code.
 */
function assembleShader(statements: string[], outputCode: string): string {
  return `
// Custom Shader Node Graph
// Generated by SpawnForge Shader Editor

@fragment
fn fragment(
  in: VertexOutput,
  @builtin(front_facing) is_front: bool,
) -> @location(0) vec4<f32> {
  var pbr_input = pbr_input_from_vertex_output(in, is_front, false);

  // Node computations
  ${statements.join('\n  ')}

  // Output assignments
  ${outputCode}

  // Standard PBR lighting
  var output_color = pbr(pbr_input);

  return output_color;
}
`.trim();
}
