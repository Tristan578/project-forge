/**
 * Prompt Template Library — pre-built prompt templates for common AI chat tasks.
 * Templates provide structured starting points with variable placeholders.
 */

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: PromptCategory;
  prompt: string;
  /** Variable placeholders in the prompt (e.g., {{entityName}}) */
  variables: PromptVariable[];
  /** Tags for search/filter */
  tags: string[];
}

export interface PromptVariable {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select';
  defaultValue?: string;
  options?: string[]; // for 'select' type
}

export type PromptCategory =
  | 'scene-setup'
  | 'entity-creation'
  | 'materials'
  | 'physics'
  | 'scripting'
  | 'lighting'
  | 'animation'
  | 'optimization'
  | 'gameplay';

export const PROMPT_CATEGORIES: Record<PromptCategory, { label: string; description: string }> = {
  'scene-setup': { label: 'Scene Setup', description: 'Create and configure scenes' },
  'entity-creation': { label: 'Entity Creation', description: 'Spawn and arrange entities' },
  'materials': { label: 'Materials', description: 'Configure materials and textures' },
  'physics': { label: 'Physics', description: 'Set up physics and collisions' },
  'scripting': { label: 'Scripting', description: 'Add behaviors and scripts' },
  'lighting': { label: 'Lighting', description: 'Configure lights and environment' },
  'animation': { label: 'Animation', description: 'Create animations and effects' },
  'optimization': { label: 'Optimization', description: 'Performance and quality tuning' },
  'gameplay': { label: 'Gameplay', description: 'Game mechanics and systems' },
};

export const BUILT_IN_TEMPLATES: PromptTemplate[] = [
  // Scene Setup
  {
    id: 'scene-basic-3d',
    name: 'Basic 3D Scene',
    description: 'Set up a scene with ground plane, lighting, and camera',
    category: 'scene-setup',
    prompt: 'Create a basic 3D scene with a {{groundSize}} ground plane, a directional light with soft shadows, and ambient lighting. Position the camera for a good overview.',
    variables: [
      { name: 'groundSize', label: 'Ground Size', type: 'select', defaultValue: 'large', options: ['small', 'medium', 'large'] },
    ],
    tags: ['beginner', 'setup', '3d'],
  },
  {
    id: 'scene-outdoor',
    name: 'Outdoor Environment',
    description: 'Create an outdoor scene with skybox, fog, and natural lighting',
    category: 'scene-setup',
    prompt: 'Set up an outdoor environment with the {{skybox}} skybox, distance fog from {{fogStart}} to {{fogEnd}}, and warm directional lighting like a {{timeOfDay}} sun.',
    variables: [
      { name: 'skybox', label: 'Skybox', type: 'select', defaultValue: 'Sunset', options: ['Studio', 'Sunset', 'Overcast', 'Night', 'Bright Day'] },
      { name: 'fogStart', label: 'Fog Start', type: 'number', defaultValue: '20' },
      { name: 'fogEnd', label: 'Fog End', type: 'number', defaultValue: '100' },
      { name: 'timeOfDay', label: 'Time of Day', type: 'select', defaultValue: 'afternoon', options: ['morning', 'afternoon', 'evening', 'night'] },
    ],
    tags: ['environment', 'outdoor', 'skybox', 'fog'],
  },

  // Entity Creation
  {
    id: 'entity-grid',
    name: 'Grid of Objects',
    description: 'Create a grid arrangement of entities',
    category: 'entity-creation',
    prompt: 'Create a {{rows}}x{{cols}} grid of {{entityType}} entities, spaced {{spacing}} units apart, starting at the origin.',
    variables: [
      { name: 'rows', label: 'Rows', type: 'number', defaultValue: '3' },
      { name: 'cols', label: 'Columns', type: 'number', defaultValue: '3' },
      { name: 'entityType', label: 'Entity Type', type: 'select', defaultValue: 'cube', options: ['cube', 'sphere', 'cylinder', 'capsule'] },
      { name: 'spacing', label: 'Spacing', type: 'number', defaultValue: '2' },
    ],
    tags: ['arrangement', 'grid', 'spawn'],
  },
  {
    id: 'entity-character',
    name: 'Player Character',
    description: 'Set up a player entity with controller and camera',
    category: 'entity-creation',
    prompt: 'Create a player character using a {{shape}} mesh. Add a character controller component with {{speed}} movement speed, {{jumpForce}} jump force, and a {{cameraMode}} game camera following it.',
    variables: [
      { name: 'shape', label: 'Shape', type: 'select', defaultValue: 'capsule', options: ['capsule', 'cube', 'sphere', 'cylinder'] },
      { name: 'speed', label: 'Speed', type: 'number', defaultValue: '5' },
      { name: 'jumpForce', label: 'Jump Force', type: 'number', defaultValue: '8' },
      { name: 'cameraMode', label: 'Camera Mode', type: 'select', defaultValue: 'ThirdPerson', options: ['ThirdPerson', 'FirstPerson', 'SideScroller', 'TopDown'] },
    ],
    tags: ['player', 'character', 'controller', 'camera'],
  },

  // Materials
  {
    id: 'material-metallic',
    name: 'Metallic Material',
    description: 'Apply a metallic material to the selected entity',
    category: 'materials',
    prompt: 'Make the selected entity look like polished {{metal}} by setting metallic to {{metallic}}, roughness to {{roughness}}, and an appropriate base color.',
    variables: [
      { name: 'metal', label: 'Metal Type', type: 'select', defaultValue: 'steel', options: ['steel', 'gold', 'copper', 'chrome', 'bronze'] },
      { name: 'metallic', label: 'Metallic', type: 'number', defaultValue: '0.95' },
      { name: 'roughness', label: 'Roughness', type: 'number', defaultValue: '0.1' },
    ],
    tags: ['material', 'metal', 'shiny'],
  },
  {
    id: 'material-glass',
    name: 'Glass Material',
    description: 'Create a transparent glass-like material',
    category: 'materials',
    prompt: 'Apply a glass material to the selected entity with specular transmission {{transmission}}, IOR {{ior}}, and a slight {{tint}} tint.',
    variables: [
      { name: 'transmission', label: 'Transmission', type: 'number', defaultValue: '0.9' },
      { name: 'ior', label: 'IOR', type: 'number', defaultValue: '1.5' },
      { name: 'tint', label: 'Tint', type: 'select', defaultValue: 'blue', options: ['clear', 'blue', 'green', 'amber', 'red'] },
    ],
    tags: ['material', 'glass', 'transparent'],
  },

  // Physics
  {
    id: 'physics-rigid-body',
    name: 'Physics Object',
    description: 'Add physics to the selected entity',
    category: 'physics',
    prompt: 'Enable physics on the selected entity as a {{bodyType}} body with a {{collider}} collider, restitution {{restitution}}, friction {{friction}}, and density {{density}}.',
    variables: [
      { name: 'bodyType', label: 'Body Type', type: 'select', defaultValue: 'dynamic', options: ['dynamic', 'fixed', 'kinematic_position'] },
      { name: 'collider', label: 'Collider', type: 'select', defaultValue: 'cuboid', options: ['cuboid', 'sphere', 'capsule', 'trimesh'] },
      { name: 'restitution', label: 'Bounciness', type: 'number', defaultValue: '0.3' },
      { name: 'friction', label: 'Friction', type: 'number', defaultValue: '0.5' },
      { name: 'density', label: 'Density', type: 'number', defaultValue: '1.0' },
    ],
    tags: ['physics', 'rigid-body', 'collider'],
  },

  // Scripting
  {
    id: 'script-movement',
    name: 'Movement Script',
    description: 'Add basic movement behavior to an entity',
    category: 'scripting',
    prompt: 'Add a script to the selected entity that moves it {{direction}} at {{speed}} units per second using {{method}}.',
    variables: [
      { name: 'direction', label: 'Direction', type: 'select', defaultValue: 'forward', options: ['forward', 'sideways', 'up-down', 'circular'] },
      { name: 'speed', label: 'Speed', type: 'number', defaultValue: '3' },
      { name: 'method', label: 'Method', type: 'select', defaultValue: 'transform', options: ['transform', 'physics-velocity', 'physics-impulse'] },
    ],
    tags: ['script', 'movement', 'behavior'],
  },

  // Lighting
  {
    id: 'lighting-three-point',
    name: 'Three-Point Lighting',
    description: 'Classic three-point lighting setup',
    category: 'lighting',
    prompt: 'Set up three-point lighting: a bright {{keyColor}} key light from the left, a softer fill light from the right, and a {{backColor}} backlight for rim lighting. Set ambient to {{ambientLevel}}.',
    variables: [
      { name: 'keyColor', label: 'Key Light Color', type: 'select', defaultValue: 'warm white', options: ['warm white', 'cool white', 'golden', 'blue'] },
      { name: 'backColor', label: 'Back Light Color', type: 'select', defaultValue: 'cool blue', options: ['cool blue', 'warm white', 'orange', 'purple'] },
      { name: 'ambientLevel', label: 'Ambient Level', type: 'number', defaultValue: '0.1' },
    ],
    tags: ['lighting', 'three-point', 'studio'],
  },

  // Animation
  {
    id: 'animation-rotate',
    name: 'Rotation Animation',
    description: 'Animate rotation on the selected entity',
    category: 'animation',
    prompt: 'Create a keyframe animation clip on the selected entity that rotates it {{degrees}} degrees around the {{axis}} axis over {{duration}} seconds with {{easing}} easing, set to {{playMode}}.',
    variables: [
      { name: 'degrees', label: 'Degrees', type: 'number', defaultValue: '360' },
      { name: 'axis', label: 'Axis', type: 'select', defaultValue: 'Y', options: ['X', 'Y', 'Z'] },
      { name: 'duration', label: 'Duration (s)', type: 'number', defaultValue: '2' },
      { name: 'easing', label: 'Easing', type: 'select', defaultValue: 'linear', options: ['linear', 'ease-in', 'ease-out', 'ease-in-out'] },
      { name: 'playMode', label: 'Play Mode', type: 'select', defaultValue: 'loop', options: ['once', 'loop', 'ping-pong'] },
    ],
    tags: ['animation', 'rotation', 'keyframe'],
  },

  // Optimization
  {
    id: 'optimize-quality',
    name: 'Quality Preset',
    description: 'Apply a rendering quality preset',
    category: 'optimization',
    prompt: 'Set the rendering quality to {{preset}} and {{bloomAction}} bloom with intensity {{bloomIntensity}}.',
    variables: [
      { name: 'preset', label: 'Quality Preset', type: 'select', defaultValue: 'high', options: ['low', 'medium', 'high', 'ultra'] },
      { name: 'bloomAction', label: 'Bloom', type: 'select', defaultValue: 'enable', options: ['enable', 'disable'] },
      { name: 'bloomIntensity', label: 'Bloom Intensity', type: 'number', defaultValue: '0.3' },
    ],
    tags: ['quality', 'performance', 'rendering'],
  },

  // Gameplay
  {
    id: 'gameplay-collectibles',
    name: 'Collectible System',
    description: 'Set up collectible items with scoring',
    category: 'gameplay',
    prompt: 'Create {{count}} collectible {{shape}} entities arranged in a {{pattern}} pattern. Make them {{color}} colored, add collectible components with {{points}} points each, and make them slowly rotate.',
    variables: [
      { name: 'count', label: 'Count', type: 'number', defaultValue: '5' },
      { name: 'shape', label: 'Shape', type: 'select', defaultValue: 'sphere', options: ['sphere', 'cube', 'cylinder', 'torus'] },
      { name: 'pattern', label: 'Pattern', type: 'select', defaultValue: 'line', options: ['line', 'circle', 'random', 'grid'] },
      { name: 'color', label: 'Color', type: 'select', defaultValue: 'gold', options: ['gold', 'green', 'blue', 'red', 'purple'] },
      { name: 'points', label: 'Points Each', type: 'number', defaultValue: '10' },
    ],
    tags: ['gameplay', 'collectible', 'score'],
  },
  {
    id: 'gameplay-platformer-level',
    name: 'Platformer Level',
    description: 'Generate a basic platformer level layout',
    category: 'gameplay',
    prompt: 'Create a platformer level with {{platformCount}} platforms at varying heights, a start position on the left, and a goal area on the right. Add {{hazardCount}} hazard zones and make platforms {{material}}.',
    variables: [
      { name: 'platformCount', label: 'Platforms', type: 'number', defaultValue: '8' },
      { name: 'hazardCount', label: 'Hazards', type: 'number', defaultValue: '3' },
      { name: 'material', label: 'Material', type: 'select', defaultValue: 'stone', options: ['stone', 'wood', 'metal', 'ice', 'grass'] },
    ],
    tags: ['gameplay', 'platformer', 'level-design'],
  },
];

/**
 * Fill template variables into a prompt string.
 * Replaces {{varName}} placeholders with provided values.
 */
export function fillTemplate(
  prompt: string,
  values: Record<string, string>,
): string {
  let result = prompt;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

/**
 * Search templates by query string (matches name, description, tags).
 */
export function searchTemplates(
  templates: PromptTemplate[],
  query: string,
): PromptTemplate[] {
  if (!query.trim()) return templates;
  const lower = query.toLowerCase();
  return templates.filter((t) =>
    t.name.toLowerCase().includes(lower) ||
    t.description.toLowerCase().includes(lower) ||
    t.tags.some((tag) => tag.toLowerCase().includes(lower)) ||
    t.category.toLowerCase().includes(lower)
  );
}

/**
 * Filter templates by category.
 */
export function filterByCategory(
  templates: PromptTemplate[],
  category: PromptCategory | null,
): PromptTemplate[] {
  if (!category) return templates;
  return templates.filter((t) => t.category === category);
}
