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
  category: 'platformer' | 'runner' | 'shooter' | 'puzzle' | 'explorer' | '2d_platformer' | '2d_topdown' | '2d_shmup' | '2d_puzzle' | '2d_fighter' | '2d_metroidvania';
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
  {
    id: '2d-platformer',
    name: '2D Platformer',
    description: 'Side-scrolling platformer with jumps, enemies, and collectibles.',
    category: '2d_platformer',
    difficulty: 'beginner',
    thumbnail: { gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', icon: 'Gamepad2', accentColor: '#3b82f6' },
    tags: ['2d', 'platformer', 'side-scroller', 'retro'],
    entityCount: 28,
    load: async () => (await import('./2d-platformer')).PLATFORMER_2D_TEMPLATE,
  },
  {
    id: '2d-topdown',
    name: '2D Top-Down RPG',
    description: 'Zelda-style adventure. Explore, talk to NPCs, collect items.',
    category: '2d_topdown',
    difficulty: 'beginner',
    thumbnail: { gradient: 'linear-gradient(135deg, #10b981, #059669)', icon: 'Map', accentColor: '#10b981' },
    tags: ['2d', 'rpg', 'exploration', 'dialogue'],
    entityCount: 22,
    load: async () => (await import('./2d-topdown')).TOPDOWN_2D_TEMPLATE,
  },
  {
    id: '2d-shmup',
    name: '2D Shoot-em-up',
    description: 'Vertical scrolling shooter. Dodge bullets, defeat waves of enemies.',
    category: '2d_shmup',
    difficulty: 'intermediate',
    thumbnail: { gradient: 'linear-gradient(135deg, #ef4444, #b91c1c)', icon: 'Target', accentColor: '#ef4444' },
    tags: ['2d', 'shooter', 'shmup', 'arcade'],
    entityCount: 19,
    load: async () => (await import('./2d-shmup')).SHMUP_2D_TEMPLATE,
  },
  {
    id: '2d-puzzle',
    name: '2D Puzzle Game',
    description: 'Match-3 puzzle game. Swap tiles to create matches.',
    category: '2d_puzzle',
    difficulty: 'intermediate',
    thumbnail: { gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', icon: 'Grid3x3', accentColor: '#8b5cf6' },
    tags: ['2d', 'puzzle', 'match-3', 'logic'],
    entityCount: 28,
    load: async () => (await import('./2d-puzzle')).PUZZLE_2D_TEMPLATE,
  },
  {
    id: '2d-fighter',
    name: '2D Fighter',
    description: 'Two-player fighting game. Attack, defend, knockout opponent.',
    category: '2d_fighter',
    difficulty: 'intermediate',
    thumbnail: { gradient: 'linear-gradient(135deg, #f59e0b, #d97706)', icon: 'Swords', accentColor: '#f59e0b' },
    tags: ['2d', 'fighting', 'pvp', 'action'],
    entityCount: 9,
    load: async () => (await import('./2d-fighter')).FIGHTER_2D_TEMPLATE,
  },
  {
    id: '2d-metroidvania',
    name: '2D Metroidvania',
    description: 'Exploration platformer. Unlock abilities, save progress, discover secrets.',
    category: '2d_metroidvania',
    difficulty: 'intermediate',
    thumbnail: { gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)', icon: 'Layers', accentColor: '#06b6d4' },
    tags: ['2d', 'metroidvania', 'exploration', 'abilities'],
    entityCount: 31,
    load: async () => (await import('./2d-metroidvania')).METROIDVANIA_2D_TEMPLATE,
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
