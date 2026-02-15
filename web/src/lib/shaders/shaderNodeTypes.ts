/**
 * Shader Node Type Definitions
 * Defines the structure and capabilities of each shader node type.
 */

export type ShaderDataType = 'float' | 'vec2' | 'vec3' | 'vec4' | 'color' | 'texture2d' | 'exec';

export interface ShaderNodePort {
  id: string;
  label: string;
  type: ShaderDataType;
  defaultValue?: unknown;
}

export interface ShaderNodeDefinition {
  type: string;
  category: string;
  label: string;
  description: string;
  inputs: ShaderNodePort[];
  outputs: ShaderNodePort[];
  // Optional: custom data fields for the node inspector
  dataFields?: Array<{
    id: string;
    label: string;
    type: 'float' | 'vec3' | 'color' | 'texture' | 'enum';
    defaultValue?: unknown;
    min?: number;
    max?: number;
    options?: string[];
  }>;
}

export const SHADER_NODE_DEFINITIONS: Record<string, ShaderNodeDefinition> = {
  // --- INPUT NODES ---
  vertex_position: {
    type: 'vertex_position',
    category: 'input',
    label: 'Vertex Position',
    description: 'World-space vertex position',
    inputs: [],
    outputs: [{ id: 'position', label: 'Position', type: 'vec3' }],
  },
  vertex_normal: {
    type: 'vertex_normal',
    category: 'input',
    label: 'Vertex Normal',
    description: 'World-space vertex normal',
    inputs: [],
    outputs: [{ id: 'normal', label: 'Normal', type: 'vec3' }],
  },
  vertex_uv: {
    type: 'vertex_uv',
    category: 'input',
    label: 'Vertex UV',
    description: 'UV texture coordinates',
    inputs: [],
    outputs: [{ id: 'uv', label: 'UV', type: 'vec2' }],
  },
  time: {
    type: 'time',
    category: 'input',
    label: 'Time',
    description: 'Elapsed time in seconds',
    inputs: [],
    outputs: [{ id: 'time', label: 'Time', type: 'float' }],
  },
  camera_position: {
    type: 'camera_position',
    category: 'input',
    label: 'Camera Position',
    description: 'World-space camera position',
    inputs: [],
    outputs: [{ id: 'position', label: 'Position', type: 'vec3' }],
  },

  // --- MATH NODES ---
  add: {
    type: 'add',
    category: 'math',
    label: 'Add',
    description: 'Add two values',
    inputs: [
      { id: 'a', label: 'A', type: 'float', defaultValue: 0 },
      { id: 'b', label: 'B', type: 'float', defaultValue: 0 },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },
  subtract: {
    type: 'subtract',
    category: 'math',
    label: 'Subtract',
    description: 'Subtract B from A',
    inputs: [
      { id: 'a', label: 'A', type: 'float', defaultValue: 0 },
      { id: 'b', label: 'B', type: 'float', defaultValue: 0 },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },
  multiply: {
    type: 'multiply',
    category: 'math',
    label: 'Multiply',
    description: 'Multiply two values',
    inputs: [
      { id: 'a', label: 'A', type: 'float', defaultValue: 1 },
      { id: 'b', label: 'B', type: 'float', defaultValue: 1 },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },
  divide: {
    type: 'divide',
    category: 'math',
    label: 'Divide',
    description: 'Divide A by B',
    inputs: [
      { id: 'a', label: 'A', type: 'float', defaultValue: 1 },
      { id: 'b', label: 'B', type: 'float', defaultValue: 1 },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },
  power: {
    type: 'power',
    category: 'math',
    label: 'Power',
    description: 'Raise A to the power of B',
    inputs: [
      { id: 'base', label: 'Base', type: 'float', defaultValue: 1 },
      { id: 'exponent', label: 'Exponent', type: 'float', defaultValue: 2 },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },
  sqrt: {
    type: 'sqrt',
    category: 'math',
    label: 'Square Root',
    description: 'Square root of input',
    inputs: [{ id: 'value', label: 'Value', type: 'float', defaultValue: 1 }],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },
  abs: {
    type: 'abs',
    category: 'math',
    label: 'Absolute',
    description: 'Absolute value',
    inputs: [{ id: 'value', label: 'Value', type: 'float', defaultValue: 0 }],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },
  clamp: {
    type: 'clamp',
    category: 'math',
    label: 'Clamp',
    description: 'Clamp value between min and max',
    inputs: [
      { id: 'value', label: 'Value', type: 'float', defaultValue: 0 },
      { id: 'min', label: 'Min', type: 'float', defaultValue: 0 },
      { id: 'max', label: 'Max', type: 'float', defaultValue: 1 },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },
  lerp: {
    type: 'lerp',
    category: 'math',
    label: 'Lerp',
    description: 'Linear interpolation between A and B',
    inputs: [
      { id: 'a', label: 'A', type: 'float', defaultValue: 0 },
      { id: 'b', label: 'B', type: 'float', defaultValue: 1 },
      { id: 't', label: 'T', type: 'float', defaultValue: 0.5 },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },
  step: {
    type: 'step',
    category: 'math',
    label: 'Step',
    description: 'Returns 0 if value < edge, else 1',
    inputs: [
      { id: 'edge', label: 'Edge', type: 'float', defaultValue: 0.5 },
      { id: 'value', label: 'Value', type: 'float', defaultValue: 0 },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },
  smoothstep: {
    type: 'smoothstep',
    category: 'math',
    label: 'Smooth Step',
    description: 'Smooth Hermite interpolation',
    inputs: [
      { id: 'edge0', label: 'Edge 0', type: 'float', defaultValue: 0 },
      { id: 'edge1', label: 'Edge 1', type: 'float', defaultValue: 1 },
      { id: 'value', label: 'Value', type: 'float', defaultValue: 0.5 },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },
  sin: {
    type: 'sin',
    category: 'math',
    label: 'Sin',
    description: 'Sine function',
    inputs: [{ id: 'value', label: 'Value', type: 'float', defaultValue: 0 }],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },
  cos: {
    type: 'cos',
    category: 'math',
    label: 'Cos',
    description: 'Cosine function',
    inputs: [{ id: 'value', label: 'Value', type: 'float', defaultValue: 0 }],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },
  fract: {
    type: 'fract',
    category: 'math',
    label: 'Fract',
    description: 'Fractional part (x - floor(x))',
    inputs: [{ id: 'value', label: 'Value', type: 'float', defaultValue: 0 }],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },
  floor: {
    type: 'floor',
    category: 'math',
    label: 'Floor',
    description: 'Floor function',
    inputs: [{ id: 'value', label: 'Value', type: 'float', defaultValue: 0 }],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },

  // --- TEXTURE NODES ---
  texture_sample: {
    type: 'texture_sample',
    category: 'texture',
    label: 'Texture Sample',
    description: 'Sample a texture at UV coordinates',
    inputs: [
      { id: 'texture', label: 'Texture', type: 'texture2d' },
      { id: 'uv', label: 'UV', type: 'vec2' },
    ],
    outputs: [{ id: 'color', label: 'Color', type: 'vec4' }],
    dataFields: [
      {
        id: 'textureId',
        label: 'Texture',
        type: 'texture',
      },
    ],
  },
  noise_texture: {
    type: 'noise_texture',
    category: 'texture',
    label: 'Noise Texture',
    description: 'Procedural noise texture',
    inputs: [
      { id: 'uv', label: 'UV', type: 'vec2' },
      { id: 'scale', label: 'Scale', type: 'float', defaultValue: 1 },
    ],
    outputs: [{ id: 'value', label: 'Value', type: 'float' }],
  },
  voronoi_texture: {
    type: 'voronoi_texture',
    category: 'texture',
    label: 'Voronoi Texture',
    description: 'Procedural Voronoi pattern',
    inputs: [
      { id: 'uv', label: 'UV', type: 'vec2' },
      { id: 'scale', label: 'Scale', type: 'float', defaultValue: 5 },
    ],
    outputs: [
      { id: 'distance', label: 'Distance', type: 'float' },
      { id: 'color', label: 'Color', type: 'vec3' },
    ],
  },

  // --- COLOR NODES ---
  color_constant: {
    type: 'color_constant',
    category: 'color',
    label: 'Color',
    description: 'Constant color value',
    inputs: [],
    outputs: [{ id: 'color', label: 'Color', type: 'vec4' }],
    dataFields: [
      {
        id: 'color',
        label: 'Color',
        type: 'color',
        defaultValue: [1, 1, 1, 1],
      },
    ],
  },
  hsv_to_rgb: {
    type: 'hsv_to_rgb',
    category: 'color',
    label: 'HSV to RGB',
    description: 'Convert HSV to RGB',
    inputs: [{ id: 'hsv', label: 'HSV', type: 'vec3' }],
    outputs: [{ id: 'rgb', label: 'RGB', type: 'vec3' }],
  },
  rgb_to_hsv: {
    type: 'rgb_to_hsv',
    category: 'color',
    label: 'RGB to HSV',
    description: 'Convert RGB to HSV',
    inputs: [{ id: 'rgb', label: 'RGB', type: 'vec3' }],
    outputs: [{ id: 'hsv', label: 'HSV', type: 'vec3' }],
  },
  color_ramp: {
    type: 'color_ramp',
    category: 'color',
    label: 'Color Ramp',
    description: 'Gradient between two colors',
    inputs: [
      { id: 't', label: 'Factor', type: 'float', defaultValue: 0.5 },
      { id: 'color_a', label: 'Color A', type: 'vec4' },
      { id: 'color_b', label: 'Color B', type: 'vec4' },
    ],
    outputs: [{ id: 'color', label: 'Color', type: 'vec4' }],
  },

  // --- VECTOR NODES ---
  split_vec3: {
    type: 'split_vec3',
    category: 'vector',
    label: 'Split Vec3',
    description: 'Split a Vec3 into components',
    inputs: [{ id: 'vector', label: 'Vector', type: 'vec3' }],
    outputs: [
      { id: 'x', label: 'X', type: 'float' },
      { id: 'y', label: 'Y', type: 'float' },
      { id: 'z', label: 'Z', type: 'float' },
    ],
  },
  combine_vec3: {
    type: 'combine_vec3',
    category: 'vector',
    label: 'Combine Vec3',
    description: 'Combine components into Vec3',
    inputs: [
      { id: 'x', label: 'X', type: 'float', defaultValue: 0 },
      { id: 'y', label: 'Y', type: 'float', defaultValue: 0 },
      { id: 'z', label: 'Z', type: 'float', defaultValue: 0 },
    ],
    outputs: [{ id: 'vector', label: 'Vector', type: 'vec3' }],
  },
  normalize: {
    type: 'normalize',
    category: 'vector',
    label: 'Normalize',
    description: 'Normalize a vector',
    inputs: [{ id: 'vector', label: 'Vector', type: 'vec3' }],
    outputs: [{ id: 'result', label: 'Result', type: 'vec3' }],
  },
  dot_product: {
    type: 'dot_product',
    category: 'vector',
    label: 'Dot Product',
    description: 'Dot product of two vectors',
    inputs: [
      { id: 'a', label: 'A', type: 'vec3' },
      { id: 'b', label: 'B', type: 'vec3' },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },
  cross_product: {
    type: 'cross_product',
    category: 'vector',
    label: 'Cross Product',
    description: 'Cross product of two vectors',
    inputs: [
      { id: 'a', label: 'A', type: 'vec3' },
      { id: 'b', label: 'B', type: 'vec3' },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'vec3' }],
  },

  // --- LIGHTING NODES ---
  fresnel: {
    type: 'fresnel',
    category: 'lighting',
    label: 'Fresnel',
    description: 'Fresnel effect (view-dependent falloff)',
    inputs: [
      { id: 'normal', label: 'Normal', type: 'vec3' },
      { id: 'view', label: 'View', type: 'vec3' },
      { id: 'power', label: 'Power', type: 'float', defaultValue: 5 },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'float' }],
  },
  normal_map: {
    type: 'normal_map',
    category: 'lighting',
    label: 'Normal Map',
    description: 'Sample and transform normal map',
    inputs: [
      { id: 'texture', label: 'Texture', type: 'texture2d' },
      { id: 'uv', label: 'UV', type: 'vec2' },
      { id: 'strength', label: 'Strength', type: 'float', defaultValue: 1 },
    ],
    outputs: [{ id: 'normal', label: 'Normal', type: 'vec3' }],
  },

  // --- OUTPUT NODE ---
  pbr_output: {
    type: 'pbr_output',
    category: 'output',
    label: 'PBR Output',
    description: 'Material output node',
    inputs: [
      { id: 'base_color', label: 'Base Color', type: 'vec4', defaultValue: [0.5, 0.5, 0.5, 1] },
      { id: 'metallic', label: 'Metallic', type: 'float', defaultValue: 0 },
      { id: 'roughness', label: 'Roughness', type: 'float', defaultValue: 0.5 },
      { id: 'normal', label: 'Normal', type: 'vec3' },
      { id: 'emissive', label: 'Emissive', type: 'vec3', defaultValue: [0, 0, 0] },
      { id: 'alpha', label: 'Alpha', type: 'float', defaultValue: 1 },
    ],
    outputs: [],
  },
};

// Type compatibility matrix for shader connections
export const SHADER_PORT_COMPATIBILITY: Record<ShaderDataType, ShaderDataType[]> = {
  float: ['float'],
  vec2: ['vec2'],
  vec3: ['vec3', 'color'],
  vec4: ['vec4', 'color'],
  color: ['vec3', 'vec4', 'color'],
  texture2d: ['texture2d'],
  exec: ['exec'],
};

// Group nodes by category for palette display
export const SHADER_NODE_CATEGORIES = [
  { id: 'input', label: 'Input', color: '#3b82f6' },
  { id: 'math', label: 'Math', color: '#f59e0b' },
  { id: 'texture', label: 'Texture', color: '#8b5cf6' },
  { id: 'color', label: 'Color', color: '#ec4899' },
  { id: 'vector', label: 'Vector', color: '#10b981' },
  { id: 'lighting', label: 'Lighting', color: '#f97316' },
  { id: 'output', label: 'Output', color: '#ef4444' },
];
