/**
 * Local keyword-based system decomposition.
 *
 * Replaces detectGenre() with a systems-based approach: instead of classifying
 * a prompt into a single genre string, we identify which composable systems
 * (movement, camera, physics, etc.) the described game likely needs.
 *
 * This is a LOCAL-ONLY implementation using keyword matching — no AI calls.
 * The AI-powered decomposeIntoSystems() in game-creation/decomposer.ts
 * (Phase 2A) will supersede this for the full orchestrator pipeline.
 *
 * See: specs/2026-03-25-game-creation-orchestrator-phase2a-v4.md
 */

/**
 * System categories aligned with Phase 2A spec.
 * These are the composable building blocks of any game.
 */
export type SystemCategory =
  | 'movement' | 'input' | 'camera' | 'world' | 'challenge'
  | 'entities' | 'progression' | 'feedback' | 'narrative'
  | 'audio' | 'visual' | 'physics';

export const SYSTEM_CATEGORIES: SystemCategory[] = [
  'movement', 'input', 'camera', 'world', 'challenge',
  'entities', 'progression', 'feedback', 'narrative',
  'audio', 'visual', 'physics',
];

export interface SystemDecomposition {
  /** Detected systems sorted by confidence (highest first). */
  systems: DetectedSystem[];
  /** Human-readable summary of the decomposition. */
  summary: string;
}

export interface DetectedSystem {
  category: SystemCategory;
  /** Specific type hint, e.g. 'walk+jump', 'top-down', 'follow'. */
  type: string;
  /** Priority: core = essential, secondary = important, polish = nice-to-have. */
  priority: 'core' | 'secondary' | 'polish';
  /** Keywords that triggered this detection. */
  matchedKeywords: string[];
}

/**
 * Keyword map: each system category has keywords and a suggested type.
 * Multiple keywords can match the same category.
 */
const SYSTEM_KEYWORDS: Record<SystemCategory, { keywords: string[]; defaultType: string }[]> = {
  movement: [
    { keywords: ['platformer', 'jump', 'jumping', 'platform', 'side-scroller', 'sidescroller'], defaultType: 'walk+jump' },
    { keywords: ['top-down', 'overhead', 'zelda', 'twin-stick'], defaultType: 'top-down' },
    { keywords: ['runner', 'endless runner', 'auto-runner', 'infinite'], defaultType: 'auto-run' },
    { keywords: ['racing', 'race', 'car', 'kart', 'driving'], defaultType: 'vehicle' },
    { keywords: ['flying', 'fly', 'flight', 'airplane', 'spaceship'], defaultType: 'flight' },
    { keywords: ['walk', 'run', 'move', 'roam'], defaultType: 'walk' },
  ],
  input: [
    { keywords: ['touch', 'mobile', 'tap', 'swipe', 'gesture'], defaultType: 'touch' },
    { keywords: ['controller', 'gamepad', 'joystick'], defaultType: 'gamepad' },
    { keywords: ['mouse', 'click', 'point-and-click', 'drag'], defaultType: 'mouse' },
  ],
  camera: [
    { keywords: ['side-scroller', 'sidescroller', 'platformer', '2d'], defaultType: 'side-scroll' },
    { keywords: ['top-down', 'overhead', 'isometric'], defaultType: 'top-down' },
    { keywords: ['first-person', 'fps', 'first person'], defaultType: 'first-person' },
    { keywords: ['third-person', 'third person', 'over-the-shoulder'], defaultType: 'third-person' },
    { keywords: ['orbit', 'free camera', 'cinematic'], defaultType: 'orbit' },
  ],
  world: [
    { keywords: ['open world', 'sandbox', 'explore', 'exploration'], defaultType: 'open' },
    { keywords: ['level', 'levels', 'stage', 'stages', 'room'], defaultType: 'level-based' },
    { keywords: ['procedural', 'procedurally generated', 'random', 'roguelike', 'roguelite'], defaultType: 'procedural' },
    { keywords: ['tilemap', 'tile', 'grid', 'map editor'], defaultType: 'tilemap' },
    { keywords: ['terrain', 'landscape', 'heightmap'], defaultType: 'terrain' },
  ],
  challenge: [
    { keywords: ['combat', 'fight', 'fighting', 'brawl', 'melee', 'attack'], defaultType: 'combat' },
    { keywords: ['puzzle', 'match', 'brain', 'logic', 'riddle', 'sokoban'], defaultType: 'puzzle' },
    { keywords: ['shooter', 'shoot', 'gun', 'fps', 'bullet', 'weapon'], defaultType: 'ranged-combat' },
    { keywords: ['survival', 'survive', 'hunger', 'crafting'], defaultType: 'survival' },
    { keywords: ['tower defense', 'td', 'defend', 'wave'], defaultType: 'tower-defense' },
    { keywords: ['strategy', 'rts', 'turn-based', 'tactics'], defaultType: 'strategy' },
    { keywords: ['stealth', 'sneak', 'hide', 'avoid'], defaultType: 'stealth' },
  ],
  entities: [
    { keywords: ['enemy', 'enemies', 'monster', 'boss', 'ai enemies'], defaultType: 'ai-agents' },
    { keywords: ['npc', 'villager', 'companion', 'ally'], defaultType: 'npcs' },
    { keywords: ['collectible', 'coin', 'gem', 'star', 'pickup'], defaultType: 'collectibles' },
    { keywords: ['projectile', 'bullet', 'arrow', 'fireball'], defaultType: 'projectiles' },
    { keywords: ['spawn', 'spawner', 'wave'], defaultType: 'spawners' },
  ],
  progression: [
    { keywords: ['rpg', 'role-playing', 'leveling', 'level up', 'xp', 'experience'], defaultType: 'xp-levels' },
    { keywords: ['inventory', 'items', 'equipment', 'loot'], defaultType: 'inventory' },
    { keywords: ['skill tree', 'skill', 'ability', 'upgrade', 'unlock'], defaultType: 'skill-tree' },
    { keywords: ['score', 'highscore', 'leaderboard', 'points'], defaultType: 'score' },
    { keywords: ['save', 'load', 'checkpoint', 'autosave'], defaultType: 'save-system' },
  ],
  feedback: [
    { keywords: ['particle', 'particles', 'effects', 'vfx', 'explosion'], defaultType: 'particles' },
    { keywords: ['screen shake', 'rumble', 'haptic', 'juice'], defaultType: 'screen-effects' },
    { keywords: ['combo', 'chain', 'multiplier'], defaultType: 'combo-system' },
  ],
  narrative: [
    { keywords: ['story', 'narrative', 'cutscene', 'cinematic'], defaultType: 'story' },
    { keywords: ['dialogue', 'dialog', 'conversation', 'npc talk', 'quest'], defaultType: 'dialogue' },
    { keywords: ['adventure', 'journey', 'lore'], defaultType: 'adventure' },
    { keywords: ['horror', 'scary', 'haunted', 'spooky', 'creepy'], defaultType: 'horror-atmosphere' },
  ],
  audio: [
    { keywords: ['music', 'soundtrack', 'bgm', 'rhythm'], defaultType: 'music' },
    { keywords: ['sound', 'sfx', 'audio', 'ambient'], defaultType: 'sfx' },
  ],
  visual: [
    { keywords: ['pixel art', 'pixel', 'retro', '8-bit', '16-bit'], defaultType: 'pixel-art' },
    { keywords: ['low-poly', 'low poly', 'minimalist', 'abstract'], defaultType: 'low-poly' },
    { keywords: ['realistic', 'photorealistic', 'pbr'], defaultType: 'realistic' },
    { keywords: ['cartoon', 'cel-shaded', 'stylized', 'hand-drawn'], defaultType: 'stylized' },
    { keywords: ['dark', 'moody', 'atmospheric', 'noir'], defaultType: 'dark-atmospheric' },
  ],
  physics: [
    { keywords: ['physics', 'gravity', 'collision', 'ragdoll', 'rigid body'], defaultType: 'rigid-body' },
    { keywords: ['bounce', 'spring', 'elastic'], defaultType: 'bouncy' },
    { keywords: ['water', 'fluid', 'buoyancy'], defaultType: 'fluid' },
  ],
};

/**
 * Decompose a game description prompt into composable systems.
 *
 * Returns detected systems sorted by confidence (number of keyword matches).
 * Systems with 0 matches are not included. Every game gets at least 'input'
 * and 'camera' as core defaults if no explicit matches are found.
 *
 * @param prompt - Natural language game description
 * @returns SystemDecomposition with detected systems and summary
 */
export function decomposeIntoSystems(prompt: string): SystemDecomposition {
  const lower = prompt.toLowerCase();
  const detected: DetectedSystem[] = [];

  for (const [category, entries] of Object.entries(SYSTEM_KEYWORDS) as [SystemCategory, typeof SYSTEM_KEYWORDS[SystemCategory]][]) {
    let bestEntry: { defaultType: string; matchedKeywords: string[] } | null = null;
    let bestScore = 0;

    for (const entry of entries) {
      const matched = entry.keywords.filter(kw => lower.includes(kw));
      if (matched.length > bestScore) {
        bestScore = matched.length;
        bestEntry = { defaultType: entry.defaultType, matchedKeywords: matched };
      }
    }

    if (bestEntry && bestScore > 0) {
      detected.push({
        category,
        type: bestEntry.defaultType,
        priority: bestScore >= 2 ? 'core' : 'secondary',
        matchedKeywords: bestEntry.matchedKeywords,
      });
    }
  }

  // Sort by number of matched keywords (most confident first)
  detected.sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length);

  // Every game needs input and camera — add defaults if not detected.
  // Defaults use 'secondary' priority so getSystemLabel() correctly falls
  // back to "custom game" for vague prompts (only explicit matches are 'core').
  if (!detected.some(d => d.category === 'input')) {
    detected.push({ category: 'input', type: 'keyboard', priority: 'secondary', matchedKeywords: [] });
  }
  if (!detected.some(d => d.category === 'camera')) {
    detected.push({ category: 'camera', type: 'follow', priority: 'secondary', matchedKeywords: [] });
  }

  const systemNames = detected.map(d => `${d.category}:${d.type}`);
  const summary = detected.length > 0
    ? `Detected ${detected.length} systems: ${systemNames.join(', ')}`
    : 'No specific systems detected — using defaults';

  return { systems: detected, summary };
}

/**
 * Get a human-readable label for a system decomposition.
 * Used in UI to replace the old genre display.
 *
 * @returns A short description like "platformer with combat and puzzles"
 */
export function getSystemLabel(decomposition: SystemDecomposition): string {
  const core = decomposition.systems.filter(s => s.priority === 'core');
  if (core.length === 0) return 'custom game';

  const labels = core.map(s => {
    switch (s.category) {
      case 'movement': return s.type.replace('+', ' & ');
      case 'challenge': return s.type.replace('-', ' ');
      case 'narrative': return s.type;
      case 'world': return s.type.replace('-', ' ');
      default: return s.category;
    }
  });

  return labels.join(' + ');
}
