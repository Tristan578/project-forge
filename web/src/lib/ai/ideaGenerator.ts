/**
 * Game Idea Generator — trending genres + mechanics remix to spark creativity.
 *
 * Provides genre/mechanic catalogs, random combination engine, idea scoring,
 * and optional AI-powered idea expansion.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Genre {
  id: string;
  name: string;
  description: string;
  trending: boolean;
  tags: string[];
}

export interface Mechanic {
  id: string;
  name: string;
  description: string;
  complexity: 'low' | 'medium' | 'high';
  tags: string[];
}

export interface GenreMix {
  primary: Genre;
  secondary: Genre;
}

export interface MechanicCombo {
  mechanics: Mechanic[];
}

export interface GameIdea {
  id: string;
  title: string;
  description: string;
  genreMix: GenreMix;
  mechanicCombo: MechanicCombo;
  score: number;
  hooks: string[];
  targetAudience: string;
}

export interface IdeaFilters {
  genreIds?: string[];
  mechanicIds?: string[];
  maxComplexity?: 'low' | 'medium' | 'high';
  trendingOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Genre Catalog
// ---------------------------------------------------------------------------

export const GENRE_CATALOG: Genre[] = [
  { id: 'platformer', name: 'Platformer', description: 'Jump and traverse obstacles across levels', trending: true, tags: ['action', '2d', '3d'] },
  { id: 'roguelike', name: 'Roguelike', description: 'Procedurally generated runs with permadeath', trending: true, tags: ['strategy', 'procedural'] },
  { id: 'tower-defense', name: 'Tower Defense', description: 'Place defenses to stop waves of enemies', trending: false, tags: ['strategy', 'casual'] },
  { id: 'puzzle', name: 'Puzzle', description: 'Solve logic challenges and brain teasers', trending: true, tags: ['casual', 'logic'] },
  { id: 'survival', name: 'Survival', description: 'Gather resources, craft items, stay alive', trending: true, tags: ['action', 'crafting'] },
  { id: 'rpg', name: 'RPG', description: 'Character progression with story-driven quests', trending: false, tags: ['story', 'progression'] },
  { id: 'racing', name: 'Racing', description: 'High-speed competition on tracks or open roads', trending: false, tags: ['action', 'competitive'] },
  { id: 'rhythm', name: 'Rhythm', description: 'Music-driven gameplay with timed inputs', trending: true, tags: ['music', 'casual'] },
  { id: 'sandbox', name: 'Sandbox', description: 'Open-ended creative world building', trending: true, tags: ['creative', 'open-world'] },
  { id: 'horror', name: 'Horror', description: 'Atmospheric tension with scares and dread', trending: false, tags: ['story', 'atmosphere'] },
  { id: 'shooter', name: 'Shooter', description: 'Fast-paced ranged combat gameplay', trending: false, tags: ['action', 'competitive'] },
  { id: 'simulation', name: 'Simulation', description: 'Realistic systems modeling and management', trending: true, tags: ['casual', 'strategy'] },
  { id: 'idle', name: 'Idle / Incremental', description: 'Automated progression with strategic upgrades', trending: true, tags: ['casual', 'progression'] },
  { id: 'metroidvania', name: 'Metroidvania', description: 'Exploration-based with ability gating', trending: true, tags: ['action', '2d', 'exploration'] },
  { id: 'card-game', name: 'Card Game', description: 'Deck-building and card-based strategy', trending: true, tags: ['strategy', 'casual'] },
];

// ---------------------------------------------------------------------------
// Mechanic Catalog
// ---------------------------------------------------------------------------

export const MECHANIC_CATALOG: Mechanic[] = [
  { id: 'time-rewind', name: 'Time Rewind', description: 'Rewind time to undo mistakes or solve puzzles', complexity: 'high', tags: ['puzzle', 'action'] },
  { id: 'gravity-flip', name: 'Gravity Flip', description: 'Toggle gravity direction to navigate environments', complexity: 'medium', tags: ['platformer', 'puzzle'] },
  { id: 'combo-chain', name: 'Combo Chain', description: 'String actions together for multiplied rewards', complexity: 'medium', tags: ['action', 'competitive'] },
  { id: 'resource-loop', name: 'Resource Loop', description: 'Gather, spend, and reinvest resources in cycles', complexity: 'low', tags: ['strategy', 'idle'] },
  { id: 'stealth', name: 'Stealth', description: 'Avoid detection using shadows and distractions', complexity: 'high', tags: ['action', 'puzzle'] },
  { id: 'crafting', name: 'Crafting', description: 'Combine raw materials into useful items', complexity: 'medium', tags: ['survival', 'rpg'] },
  { id: 'wave-survival', name: 'Wave Survival', description: 'Survive increasingly difficult enemy waves', complexity: 'low', tags: ['action', 'strategy'] },
  { id: 'deck-building', name: 'Deck Building', description: 'Acquire and organize a deck of ability cards', complexity: 'high', tags: ['strategy', 'roguelike'] },
  { id: 'physics-sim', name: 'Physics Simulation', description: 'Realistic physics for puzzles or destruction', complexity: 'medium', tags: ['puzzle', 'sandbox'] },
  { id: 'procedural-gen', name: 'Procedural Generation', description: 'Algorithmically created levels and content', complexity: 'high', tags: ['roguelike', 'exploration'] },
  { id: 'rhythm-action', name: 'Rhythm Action', description: 'Timing-based inputs synced to music', complexity: 'medium', tags: ['rhythm', 'action'] },
  { id: 'base-building', name: 'Base Building', description: 'Construct and upgrade a home base', complexity: 'medium', tags: ['strategy', 'survival'] },
  { id: 'dialogue-choices', name: 'Dialogue Choices', description: 'Branching conversations that affect outcomes', complexity: 'low', tags: ['rpg', 'story'] },
  { id: 'permadeath', name: 'Permadeath', description: 'Death is permanent, encouraging careful play', complexity: 'low', tags: ['roguelike', 'survival'] },
  { id: 'shape-shifting', name: 'Shape Shifting', description: 'Transform into different forms with unique abilities', complexity: 'high', tags: ['action', 'puzzle'] },
  { id: 'companion-ai', name: 'Companion AI', description: 'AI ally that assists the player dynamically', complexity: 'high', tags: ['rpg', 'action'] },
  { id: 'color-matching', name: 'Color Matching', description: 'Match or swap colors to trigger effects', complexity: 'low', tags: ['puzzle', 'casual'] },
  { id: 'bullet-hell', name: 'Bullet Hell', description: 'Navigate dense projectile patterns', complexity: 'medium', tags: ['shooter', 'action'] },
];

// ---------------------------------------------------------------------------
// Complexity weight map (for scoring)
// ---------------------------------------------------------------------------

const COMPLEXITY_WEIGHT: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export function filterGenres(genres: Genre[], filters: IdeaFilters): Genre[] {
  let result = genres;
  if (filters.genreIds && filters.genreIds.length > 0) {
    const ids = new Set(filters.genreIds);
    result = result.filter((g) => ids.has(g.id));
  }
  if (filters.trendingOnly) {
    result = result.filter((g) => g.trending);
  }
  return result;
}

export function filterMechanics(mechanics: Mechanic[], filters: IdeaFilters): Mechanic[] {
  let result = mechanics;
  if (filters.mechanicIds && filters.mechanicIds.length > 0) {
    const ids = new Set(filters.mechanicIds);
    result = result.filter((m) => ids.has(m.id));
  }
  if (filters.maxComplexity) {
    const max = COMPLEXITY_WEIGHT[filters.maxComplexity];
    result = result.filter((m) => COMPLEXITY_WEIGHT[m.complexity] <= max);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score a game idea based on genre synergy, mechanic synergy, trending
 * status, and complexity balance. Returns 0..100.
 */
export function scoreIdea(genreMix: GenreMix, mechanicCombo: MechanicCombo): number {
  let score = 50; // Base score

  // Genre synergy: shared tags boost, identical genres penalize
  if (genreMix.primary.id === genreMix.secondary.id) {
    score -= 15;
  } else {
    const sharedTags = genreMix.primary.tags.filter((t) =>
      genreMix.secondary.tags.includes(t)
    );
    score += Math.min(sharedTags.length * 8, 20);
  }

  // Trending bonus
  if (genreMix.primary.trending) score += 10;
  if (genreMix.secondary.trending) score += 5;

  // Mechanic synergy: mechanics with overlapping tags to genres
  const genreTags = new Set([...genreMix.primary.tags, ...genreMix.secondary.tags]);
  for (const mechanic of mechanicCombo.mechanics) {
    const overlap = mechanic.tags.filter((t) => genreTags.has(t)).length;
    score += overlap * 5;
  }

  // Complexity balance: prefer mixed complexity over all-high or all-low
  const complexities = mechanicCombo.mechanics.map((m) => COMPLEXITY_WEIGHT[m.complexity]);
  if (complexities.length >= 2) {
    const hasVariety = new Set(complexities).size > 1;
    if (hasVariety) score += 8;
  }

  // Clamp to 0..100
  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Seeded random (for deterministic testing)
// ---------------------------------------------------------------------------

export function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ---------------------------------------------------------------------------
// Random idea generation
// ---------------------------------------------------------------------------

function pickRandom<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function pickMultiple<T>(arr: T[], count: number, rng: () => number): T[] {
  if (arr.length <= count) return [...arr];
  // Fisher-Yates shuffle for uniform distribution
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

function generateTitle(genreMix: GenreMix, mechanics: Mechanic[], rng: () => number): string {
  const prefixes = ['Neon', 'Shadow', 'Crystal', 'Void', 'Storm', 'Pixel', 'Quantum', 'Ember', 'Frost', 'Solar'];
  const suffixes = ['Run', 'Quest', 'Wars', 'Shift', 'Dash', 'Forge', 'Pulse', 'Core', 'Edge', 'Drift'];
  const prefix = pickRandom(prefixes, rng);
  const suffix = pickRandom(suffixes, rng);

  // Sometimes incorporate a mechanic or genre word
  if (rng() > 0.5 && mechanics.length > 0) {
    const mechWord = pickRandom(mechanics, rng).name.split(' ')[0];
    return `${prefix} ${mechWord} ${suffix}`;
  }
  if (rng() > 0.5) {
    const genreWord = pickRandom([genreMix.primary, genreMix.secondary], rng).name.split(' ')[0];
    return `${genreWord} ${prefix} ${suffix}`;
  }
  return `${prefix} ${suffix}`;
}

function generateDescription(genreMix: GenreMix, mechanics: Mechanic[]): string {
  const mechDescs = mechanics.map((m) => m.name.toLowerCase()).join(' and ');
  return `A ${genreMix.primary.name.toLowerCase()} meets ${genreMix.secondary.name.toLowerCase()} experience featuring ${mechDescs}. Players explore a world where ${genreMix.primary.description.toLowerCase()} blends with ${genreMix.secondary.description.toLowerCase()}.`;
}

function generateHooks(genreMix: GenreMix, mechanics: Mechanic[]): string[] {
  const hooks: string[] = [];
  if (genreMix.primary.trending || genreMix.secondary.trending) {
    hooks.push('Leverages trending genre popularity');
  }
  if (genreMix.primary.id !== genreMix.secondary.id) {
    hooks.push(`Fresh genre mashup: ${genreMix.primary.name} x ${genreMix.secondary.name}`);
  }
  const highComplexity = mechanics.filter((m) => m.complexity === 'high');
  if (highComplexity.length > 0) {
    hooks.push(`Deep gameplay via ${highComplexity[0].name}`);
  }
  const lowComplexity = mechanics.filter((m) => m.complexity === 'low');
  if (lowComplexity.length > 0) {
    hooks.push('Accessible entry point for casual players');
  }
  if (hooks.length === 0) {
    hooks.push('Unique combination of familiar elements');
  }
  return hooks;
}

function generateTargetAudience(genreMix: GenreMix, mechanics: Mechanic[]): string {
  const hasHigh = mechanics.some((m) => m.complexity === 'high');
  const hasLow = mechanics.some((m) => m.complexity === 'low');
  const isTrending = genreMix.primary.trending || genreMix.secondary.trending;

  if (hasHigh && !hasLow) return 'Hardcore gamers seeking depth and challenge';
  if (hasLow && !hasHigh) return 'Casual players looking for accessible fun';
  if (isTrending) return 'Broad audience attracted to trending genres';
  return 'Mid-core players who enjoy genre mashups';
}

let ideaCounter = 0;

/**
 * Generate a single random game idea.
 * Accepts optional filters and a random number generator (for testing).
 */
export function generateIdea(
  filters: IdeaFilters = {},
  rng: () => number = Math.random,
): GameIdea {
  const genres = filterGenres(GENRE_CATALOG, filters);
  const mechanics = filterMechanics(MECHANIC_CATALOG, filters);

  if (genres.length < 2) {
    // If too few genres after filtering, fall back to full catalog
    const allGenres = GENRE_CATALOG;
    const primary = pickRandom(allGenres, rng);
    let secondary = pickRandom(allGenres, rng);
    while (secondary.id === primary.id && allGenres.length > 1) {
      secondary = pickRandom(allGenres, rng);
    }
    const selectedMechanics = pickMultiple(mechanics.length > 0 ? mechanics : MECHANIC_CATALOG, 2, rng);
    const genreMix: GenreMix = { primary, secondary };
    const mechanicCombo: MechanicCombo = { mechanics: selectedMechanics };
    const score = scoreIdea(genreMix, mechanicCombo);
    ideaCounter++;

    return {
      id: `idea-${ideaCounter}-${Math.floor(rng() * 100000)}`,
      title: generateTitle(genreMix, selectedMechanics, rng),
      description: generateDescription(genreMix, selectedMechanics),
      genreMix,
      mechanicCombo,
      score,
      hooks: generateHooks(genreMix, selectedMechanics),
      targetAudience: generateTargetAudience(genreMix, selectedMechanics),
    };
  }

  const primary = pickRandom(genres, rng);
  let secondary = pickRandom(genres, rng);
  // Avoid identical genres when possible
  let attempts = 0;
  while (secondary.id === primary.id && genres.length > 1 && attempts < 10) {
    secondary = pickRandom(genres, rng);
    attempts++;
  }

  const selectedMechanics = pickMultiple(mechanics.length > 0 ? mechanics : MECHANIC_CATALOG, 2, rng);
  const genreMix: GenreMix = { primary, secondary };
  const mechanicCombo: MechanicCombo = { mechanics: selectedMechanics };
  const score = scoreIdea(genreMix, mechanicCombo);
  ideaCounter++;

  return {
    id: `idea-${ideaCounter}-${Math.floor(rng() * 100000)}`,
    title: generateTitle(genreMix, selectedMechanics, rng),
    description: generateDescription(genreMix, selectedMechanics),
    genreMix,
    mechanicCombo,
    score,
    hooks: generateHooks(genreMix, selectedMechanics),
    targetAudience: generateTargetAudience(genreMix, selectedMechanics),
  };
}

/**
 * Generate multiple ideas at once.
 */
export function generateIdeas(
  count: number,
  filters: IdeaFilters = {},
  rng: () => number = Math.random,
): GameIdea[] {
  const ideas: GameIdea[] = [];
  for (let i = 0; i < count; i++) {
    ideas.push(generateIdea(filters, rng));
  }
  // Sort by score descending
  ideas.sort((a, b) => b.score - a.score);
  return ideas;
}

// ---------------------------------------------------------------------------
// AI-powered idea expansion (returns a prompt for the AI chat)
// ---------------------------------------------------------------------------

/**
 * Generate a GDD-style expansion prompt for an idea. This can be fed into
 * the AI chat to get a full Game Design Document.
 */
export function buildGddPrompt(idea: GameIdea): string {
  const mechanicNames = idea.mechanicCombo.mechanics.map((m) => m.name).join(', ');
  return [
    `Create a Game Design Document for "${idea.title}".`,
    '',
    `Genre Mix: ${idea.genreMix.primary.name} + ${idea.genreMix.secondary.name}`,
    `Core Mechanics: ${mechanicNames}`,
    `Target Audience: ${idea.targetAudience}`,
    '',
    `Concept: ${idea.description}`,
    '',
    'Please include:',
    '1. Game overview and unique selling points',
    '2. Core gameplay loop',
    '3. Key mechanics in detail',
    '4. Art style and visual direction',
    '5. Sound and music direction',
    '6. Progression system',
    '7. Level/world design suggestions',
    '8. Monetization considerations',
  ].join('\n');
}
