export interface Achievement {
  id: string;
  name: string;
  description: string;
  tier: 'bronze' | 'silver' | 'gold';
  icon: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first-entity',
    name: 'Creator',
    description: 'Created your first entity',
    tier: 'bronze',
    icon: 'Sparkles',
  },
  {
    id: 'colorful',
    name: 'Artist',
    description: 'Changed a material color',
    tier: 'bronze',
    icon: 'Palette',
  },
  {
    id: 'physicist',
    name: 'Physicist',
    description: 'Added physics to an entity',
    tier: 'bronze',
    icon: 'Atom',
  },
  {
    id: 'coder',
    name: 'Coder',
    description: 'Wrote your first script',
    tier: 'bronze',
    icon: 'Code',
  },
  {
    id: 'ai-collaborator',
    name: 'AI Collaborator',
    description: 'Used AI chat to build something',
    tier: 'bronze',
    icon: 'Bot',
  },
  {
    id: 'scene-builder',
    name: 'Scene Builder',
    description: 'Created a scene with 10+ entities',
    tier: 'silver',
    icon: 'Layout',
  },
  {
    id: 'game-designer',
    name: 'Game Designer',
    description: 'Used a game template',
    tier: 'silver',
    icon: 'Gamepad2',
  },
  {
    id: 'animator',
    name: 'Animator',
    description: 'Created a keyframe animation',
    tier: 'silver',
    icon: 'Film',
  },
  {
    id: 'sound-designer',
    name: 'Sound Designer',
    description: 'Added audio to your scene',
    tier: 'silver',
    icon: 'Music',
  },
  {
    id: 'publisher',
    name: 'Publisher',
    description: 'Published a game to the web',
    tier: 'gold',
    icon: 'Globe',
  },
  {
    id: 'template-master',
    name: 'Template Master',
    description: 'Tried 3 different templates',
    tier: 'gold',
    icon: 'Award',
  },
  {
    id: 'full-game',
    name: 'Game Developer',
    description: 'Created a game with physics, scripts, and UI',
    tier: 'gold',
    icon: 'Trophy',
  },
  {
    id: 'prolific',
    name: 'Prolific Creator',
    description: 'Created 5 different projects',
    tier: 'gold',
    icon: 'Layers',
  },
  {
    id: 'explorer',
    name: 'Explorer',
    description: 'Completed all basic onboarding tasks',
    tier: 'silver',
    icon: 'Compass',
  },
  {
    id: 'master',
    name: 'Master Builder',
    description: 'Completed all advanced onboarding tasks',
    tier: 'gold',
    icon: 'Crown',
  },
];
