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
    // 'cinematic' alone names a narrative device, not a camera rig — it already
    // sits in narrative:story, and on its own here it answered "an fps with
    // cinematic cutscenes" with an orbit camera.
    { keywords: ['orbit', 'free camera', 'cinematic camera'], defaultType: 'orbit' },
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

/** Escape a table keyword for use inside a RegExp. `8-bit`, `point-and-click`. */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every place `keyword` occurs in `text` as a whole word.
 *
 * A keyword used to be tested with `text.includes(kw)`, which matches anywhere —
 * including the middle of an unrelated word. That is the root of every
 * misclassification this module has produced: `car` matched "scary", so a horror
 * prompt got vehicle movement; `star` matched "start", so "where you start the
 * level" collected pickups; `click` matched "clicker" and `run` matched "runner",
 * so the two entries that describe those genres lost to entries the prompt never
 * used a word from.
 *
 * A word ends where a letter or digit does, so a hyphen or a space bounds a
 * match: `top-down` is found in "a top-down game", and `run` is not found in
 * "auto-runner". A trailing plural is still the same word — the table lists
 * `coin` and prompts say "coins" — so one optional `s`/`es` is allowed. Nothing
 * further: `-ing` would put `run` back inside "running" for no gain the table
 * cannot get by listing the inflection, which it already does for `jumping`,
 * `flying`, `fighting` and `racing`.
 */
function findWordSpans(keyword: string, text: string): { start: number; end: number }[] {
  const pattern = new RegExp(`(?<![a-z0-9])${escapeForRegExp(keyword)}(?:es|s)?(?![a-z0-9])`, 'g');
  const spans: { start: number; end: number }[] = [];
  for (const match of text.matchAll(pattern)) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/**
 * Which of an entry's keywords the prompt actually evidenced.
 *
 * Evidence is a region of the prompt, not a keyword: the table nests its own
 * vocabulary throughout (`platform` inside `platformer`, `runner` inside
 * `endless runner`, `pixel` inside `pixel art`), so counting keywords lets one
 * word speak several times. Used to pick between entries that inflation was
 * decisive and wrong — "a top-down game with jumping" scored the platformer
 * entry 2 for the single word "jumping" and came back a platformer.
 *
 * Longest match wins an overlap, and a shorter keyword covered by it is dropped
 * as saying nothing the longer one does not. A shorter keyword matching
 * SOMEWHERE ELSE is kept: "a platformer with moving platforms" names the entry's
 * vocabulary twice, in two places, which is exactly the confidence the count is
 * supposed to measure.
 */
function scoreEntry(keywords: string[], text: string): string[] {
  const found = keywords
    .flatMap(keyword => findWordSpans(keyword, text).map(span => ({ ...span, keyword })))
    .sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);

  const claimed: { start: number; end: number }[] = [];
  const matched: string[] = [];
  for (const hit of found) {
    if (claimed.some(span => hit.start < span.end && span.start < hit.end)) continue;
    claimed.push(hit);
    if (!matched.includes(hit.keyword)) matched.push(hit.keyword);
  }
  return matched;
}

/** Length of the longest matched keyword — the specificity of a match set. */
function specificityOf(matched: string[]): number {
  return matched.reduce((longest, kw) => Math.max(longest, kw.length), 0);
}

/**
 * Decompose a game description prompt into composable systems.
 *
 * Returns detected systems sorted by confidence (number of keyword matches).
 * Systems with 0 matches are not included. Every game gets at least 'input'
 * and 'camera' as core defaults if no explicit matches are found.
 *
 * Within a category, entries compete first on how many distinct signals they
 * found and then, on a tie, on the longest keyword matched — not on the order
 * the entries happen to sit in the table: "a top-down game where you jump"
 * finds one signal in each of two entries, and `top-down` is the more specific
 * claim. The tie-break is a heuristic and it can be wrong when two entries own
 * genuinely different vocabulary of different lengths; when it is, fix the table
 * (a keyword that names one category should not sit in another's list) rather
 * than adding a second heuristic on top.
 *
 * `priority` records whether the PROMPT named the category, which is the only
 * thing this module can honestly know: a category reached through the keyword
 * table is `core`, and the two categories injected below because every game
 * needs them are `secondary`. It used to mean "matched 2+ keywords", but the
 * table nests its own vocabulary so densely that the count was mostly measuring
 * that nesting — "a platformer" scored 2 for one word — and once matching became
 * span-based every one-word genre prompt would have dropped to `secondary`,
 * which `getSystemLabel` renders as 'custom game'.
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
    let bestSpecificity = 0;

    for (const entry of entries) {
      const matched = scoreEntry(entry.keywords, lower);
      if (matched.length === 0) continue;

      const specificity = specificityOf(matched);
      const wins =
        matched.length > bestScore ||
        (matched.length === bestScore && specificity > bestSpecificity);
      if (wins) {
        bestScore = matched.length;
        bestSpecificity = specificity;
        bestEntry = { defaultType: entry.defaultType, matchedKeywords: matched };
      }
    }

    if (bestEntry) {
      detected.push({
        category,
        type: bestEntry.defaultType,
        priority: 'core',
        matchedKeywords: bestEntry.matchedKeywords,
      });
    }
  }

  // Sort by number of matched keywords (most confident first)
  detected.sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length);

  // Every game needs input and camera — add defaults if not detected. These are
  // the only 'secondary' systems the decomposition can produce: nothing in the
  // prompt asked for them, so getSystemLabel() must not describe the game by
  // them, and a prompt that named no system at all still reads 'custom game'.
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

/** How many systems the label names before it stops being a summary. */
const MAX_LABELLED_SYSTEMS = 3;

/**
 * Get a human-readable label for a system decomposition.
 * Used in UI to replace the old genre display.
 *
 * Every system is named by its `type`, which is the specific thing that was
 * detected. Four categories used to be named that way and the rest fell back to
 * the bare category, so a prompt that asked for pixel art was answered with
 * "visual" — the panel repeating the question's own shape instead of what it
 * understood.
 *
 * Camera and input are dropped whenever anything else was detected. They are
 * present on nearly every decomposition (a platformer implies a side-scrolling
 * camera without saying so), so leaving them in pushed the systems the author
 * actually described out past the cap.
 *
 * @returns A short description like "walk & jump + combat"
 */
export function getSystemLabel(decomposition: SystemDecomposition): string {
  const core = decomposition.systems.filter(s => s.priority === 'core');
  if (core.length === 0) return 'custom game';

  const described = core.filter(s => s.category !== 'camera' && s.category !== 'input');
  const named = described.length > 0 ? described : core;

  return named
    .slice(0, MAX_LABELLED_SYSTEMS)
    .map(s => s.type.replaceAll('+', ' & ').replaceAll('-', ' '))
    .join(' + ');
}
