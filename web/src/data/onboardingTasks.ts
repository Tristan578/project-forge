export interface OnboardingTask {
  id: string;
  label: string;
  description: string;
  category: 'basic' | 'advanced';
  /** If set, the task only applies to this project type. Omit for shared tasks. */
  projectType?: '2d' | '3d';
}

export const ONBOARDING_TASKS: OnboardingTask[] = [
  // Basic tasks — shared
  {
    id: 'customize-material',
    label: 'Customize a Material',
    description: 'Change the color or texture of an object',
    category: 'basic',
  },
  {
    id: 'add-physics',
    label: 'Add Physics',
    description: 'Make an object respond to gravity',
    category: 'basic',
  },
  {
    id: 'write-script',
    label: 'Write a Script',
    description: 'Add behavior to an entity with TypeScript',
    category: 'basic',
  },
  {
    id: 'use-ai-chat',
    label: 'Use AI Chat',
    description: 'Ask the AI to modify your scene',
    category: 'basic',
  },
  {
    id: 'export-game',
    label: 'Export Your Game',
    description: 'Download your game as a standalone package',
    category: 'basic',
  },
  // Basic tasks — 3D only
  {
    id: 'create-entity',
    label: 'Create an Entity',
    description: 'Add a cube, sphere, or other object to your scene',
    category: 'basic',
    projectType: '3d',
  },
  // Basic tasks — 2D only
  {
    id: 'create-sprite',
    label: 'Create a Sprite',
    description: 'Add a 2D sprite to your scene',
    category: 'basic',
    projectType: '2d',
  },
  // Advanced tasks — shared
  {
    id: 'create-prefab',
    label: 'Create a Prefab',
    description: 'Save an entity as a reusable template',
    category: 'advanced',
  },
  {
    id: 'add-audio',
    label: 'Add Audio',
    description: 'Import and play sound effects or music',
    category: 'advanced',
  },
  {
    id: 'build-ui',
    label: 'Build a Game UI',
    description: 'Create health bars, score displays, or menus',
    category: 'advanced',
  },
  {
    id: 'use-animation',
    label: 'Animate an Object',
    description: 'Create keyframe animations',
    category: 'advanced',
  },
  {
    id: 'publish-game',
    label: 'Publish Your Game',
    description: 'Share your game with a public URL',
    category: 'advanced',
  },
  // Advanced tasks — 3D only
  {
    id: 'add-particles',
    label: 'Add Particle Effects',
    description: 'Create fire, smoke, or sparkle effects',
    category: 'advanced',
    projectType: '3d',
  },
  // Advanced tasks — 2D only
  {
    id: 'create-tilemap',
    label: 'Create a Tilemap',
    description: 'Build levels with tile-based terrain',
    category: 'advanced',
    projectType: '2d',
  },
];

/**
 * Filter onboarding tasks for a specific project type.
 * Includes tasks with no projectType (shared) and tasks matching the given type.
 */
export function getTasksForProjectType(
  tasks: OnboardingTask[],
  type: '2d' | '3d',
): OnboardingTask[] {
  return tasks.filter((t) => !t.projectType || t.projectType === type);
}
