/**
 * Game Template Registry
 *
 * Provides pre-built game templates that users can instantiate as starting points.
 * Each template is a complete scene with entities, materials, physics, scripts, and input bindings.
 */

// Game template metadata and data
export interface GameTemplate {
  id: string;
  name: string;
  description: string;
  category: 'platformer' | 'runner' | 'shooter' | 'puzzle' | 'explorer';
  difficulty: 'beginner' | 'intermediate';
  thumbnail: TemplateThumbnail;
  tags: string[];

  // Scene data as .forge SceneFile JSON (without scripts -- those are loaded separately)
  sceneData: SceneFileData;

  // Scripts keyed by entityId
  scripts: Record<string, { source: string; enabled: boolean }>;

  // Input preset to apply (fps | platformer | topdown | racing)
  inputPreset?: string;
}

export interface TemplateThumbnail {
  gradient: string;        // CSS gradient for card background
  icon: string;            // Lucide icon name
  accentColor: string;     // Accent border color
}

// Minimal type for scene file data (matches Rust SceneFile)
export interface SceneFileData {
  formatVersion: number;
  metadata: { name: string; createdAt: string; modifiedAt: string };
  environment: Record<string, unknown>;
  ambientLight: { color: [number, number, number]; brightness: number };
  inputBindings: Record<string, unknown>;
  assets?: Record<string, unknown>;
  postProcessing?: Record<string, unknown>;
  audioBuses?: Record<string, unknown>;
  entities: EntitySnapshotData[];
  gameUi?: string | null;
}

// Matches Rust EntitySnapshot (serialized via serde)
export interface EntitySnapshotData {
  entityId: string;
  entityName: string;
  entityType: string;
  parentId: string | null;
  visible: boolean;
  transform: {
    translation: [number, number, number];
    rotation: [number, number, number, number]; // quaternion
    scale: [number, number, number];
  };
  material?: Record<string, unknown> | null;
  light?: Record<string, unknown> | null;
  physics?: { data: Record<string, unknown>; enabled: boolean } | null;
  gameComponents?: Array<Record<string, unknown>> | null;
  // ... other optional snapshot fields
}

// Template registry entry with lazy loading
export interface TemplateRegistryEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  difficulty: string;
  thumbnail: TemplateThumbnail;
  tags: string[];
  entityCount: number;
  // Lazy loader -- actual template data loaded on demand
  load: () => Promise<GameTemplate>;
}

export const TEMPLATE_REGISTRY: TemplateRegistryEntry[] = [
  {
    id: 'platformer',
    name: '3D Platformer',
    description: 'Jump between floating platforms, collect coins, reach the goal flag.',
    category: 'platformer',
    difficulty: 'beginner',
    thumbnail: { gradient: 'linear-gradient(135deg, #22c55e, #059669)', icon: 'Gamepad2', accentColor: '#22c55e' },
    tags: ['3d', 'platformer', 'physics', 'collectibles'],
    entityCount: 32, // Will be computed at runtime from sceneData
    load: async () => (await import('./platformer')).PLATFORMER_TEMPLATE,
  },
  {
    id: 'runner',
    name: 'Endless Runner',
    description: 'Auto-run forward, dodge obstacles, chase a high score.',
    category: 'runner',
    difficulty: 'beginner',
    thumbnail: { gradient: 'linear-gradient(135deg, #f59e0b, #d97706)', icon: 'Zap', accentColor: '#f59e0b' },
    tags: ['3d', 'runner', 'procedural', 'score'],
    entityCount: 20, // Will be computed at runtime from sceneData
    load: async () => (await import('./runner')).RUNNER_TEMPLATE,
  },
  {
    id: 'shooter',
    name: 'Arena Shooter',
    description: 'First-person shooting gallery. Hit targets, rack up points.',
    category: 'shooter',
    difficulty: 'intermediate',
    thumbnail: { gradient: 'linear-gradient(135deg, #ef4444, #b91c1c)', icon: 'Crosshair', accentColor: '#ef4444' },
    tags: ['3d', 'fps', 'shooter', 'projectile'],
    entityCount: 20, // Will be computed at runtime from sceneData
    load: async () => (await import('./shooter')).SHOOTER_TEMPLATE,
  },
  {
    id: 'puzzle',
    name: 'Block Puzzle',
    description: 'Push blocks onto pressure plates to open doors and escape.',
    category: 'puzzle',
    difficulty: 'intermediate',
    thumbnail: { gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', icon: 'Puzzle', accentColor: '#8b5cf6' },
    tags: ['3d', 'puzzle', 'logic', 'physics'],
    entityCount: 20, // Will be computed at runtime from sceneData
    load: async () => (await import('./puzzle')).PUZZLE_TEMPLATE,
  },
  {
    id: 'explorer',
    name: 'Walking Simulator',
    description: 'Explore a serene environment. Find glowing orbs, discover story fragments.',
    category: 'explorer',
    difficulty: 'beginner',
    thumbnail: { gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)', icon: 'Compass', accentColor: '#06b6d4' },
    tags: ['3d', 'exploration', 'narrative', 'ambient'],
    entityCount: 20, // Will be computed at runtime from sceneData
    load: async () => (await import('./explorer')).EXPLORER_TEMPLATE,
  },
];

/**
 * Load a template by ID (dynamic import)
 */
export async function loadTemplate(templateId: string): Promise<GameTemplate | null> {
  const entry = TEMPLATE_REGISTRY.find(t => t.id === templateId);
  if (!entry) return null;
  return entry.load();
}

/**
 * Get template metadata without loading the full data
 */
export function getTemplateInfo(templateId: string): TemplateRegistryEntry | null {
  return TEMPLATE_REGISTRY.find(t => t.id === templateId) ?? null;
}
