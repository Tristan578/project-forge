/**
 * Game creation intent detection — heuristic-based classifier.
 *
 * Determines whether a user message is requesting game creation
 * (route to pipeline) or normal chat (route to MCP tool loop).
 *
 * Keyword-based for v1 — no LLM call. False negatives are acceptable;
 * the user can retry or use QuickStart.
 *
 * Spec: specs/2026-04-12-e1-pipeline-integration.md (Deliverable 5)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntentResult {
  intent: 'game_creation' | 'normal_chat';
  confidence: number;
  extractedPrompt?: string;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const GAME_GENRES = [
  'platformer', 'shooter', 'puzzle', 'rpg', 'racer', 'racing',
  'adventure', 'sandbox', 'strategy', 'survival', 'horror',
  'fighting', 'simulation', 'sim', 'tower defense',
] as const;

/** Strong signals — phrases that almost certainly mean "create a game for me" */
const STRONG_PATTERNS: RegExp[] = [
  /\b(?:make|create|build|generate|design)\s+(?:me\s+)?a\s+game\b/i,
  /\b(?:make|create|build|generate|design)\s+(?:me\s+)?a\s+(?:new\s+)?(?:2d|3d)\s+game\b/i,
  // "make me a platformer", "create a shooter", etc.
  new RegExp(
    `\\b(?:make|create|build|generate)\\s+(?:me\\s+)?a\\s+(?:new\\s+)?(?:${GAME_GENRES.join('|')})\\b`,
    'i',
  ),
  /\bi\s+want\s+(?:to\s+(?:make|create|build)\s+)?a\s+game\b/i,
  /\blet'?s\s+(?:make|create|build)\s+a\s+game\b/i,
];

/** Medium signals — suggestive of game creation but not definitive */
const MEDIUM_PATTERNS: RegExp[] = [
  /\bgame\s+(?:about|where|with|that|featuring)\b/i,
  /\bi\s+want\s+a\s+game\b/i,
  /\bgame\s+idea\b/i,
];

/** Editing signals — phrases that indicate the user is modifying existing content */
const EDITING_PATTERNS: RegExp[] = [
  /\b(?:change|modify|update|fix|move|delete|remove|resize|rotate|scale|rename|select|undo|redo)\b/i,
  /\b(?:set|adjust|tweak|toggle|enable|disable)\s+(?:the\s+)?/i,
  /\bthe\s+(?:color|material|position|rotation|scale|size|light|physics)\b/i,
];

/** Game-related keyword count — having 2+ of these boosts confidence */
const GAME_KEYWORDS = [
  'player', 'enemy', 'enemies', 'level', 'levels', 'score',
  'lives', 'jump', 'shoot', 'collect', 'coins', 'gems',
  'health', 'power-up', 'powerup', 'boss', 'spawn', 'respawn',
  'obstacle', 'platform', 'weapon', 'inventory', 'quest',
  'checkpoint', 'timer', 'round', 'wave',
];

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectGameCreationIntent(message: string): IntentResult {
  const trimmed = message.trim();

  // Very short or empty messages are never game creation
  if (trimmed.length < 5) {
    return { intent: 'normal_chat', confidence: 0 };
  }

  // Questions about concepts are normal chat
  if (/^(?:what|how|why|can|does|is|are|do)\s/i.test(trimmed) && !STRONG_PATTERNS.some(p => p.test(trimmed))) {
    return { intent: 'normal_chat', confidence: 0.1 };
  }

  // Check for strong editing signals
  const hasEditingSignal = EDITING_PATTERNS.some(p => p.test(trimmed));

  // Check for strong game creation signals
  const hasStrongSignal = STRONG_PATTERNS.some(p => p.test(trimmed));
  if (hasStrongSignal && !hasEditingSignal) {
    return {
      intent: 'game_creation',
      confidence: 0.95,
      extractedPrompt: trimmed,
    };
  }

  // Check for medium signals
  const hasMediumSignal = MEDIUM_PATTERNS.some(p => p.test(trimmed));

  // Count game keywords
  const lowerMessage = trimmed.toLowerCase();
  let keywordCount = 0;
  for (const kw of GAME_KEYWORDS) {
    if (lowerMessage.includes(kw)) keywordCount++;
  }

  // Medium signal + multiple keywords = likely game creation
  if (hasMediumSignal && keywordCount >= 1 && !hasEditingSignal) {
    return {
      intent: 'game_creation',
      confidence: 0.7,
      extractedPrompt: trimmed,
    };
  }

  // Multiple game keywords without explicit creation verb = weak signal
  if (keywordCount >= 3 && !hasEditingSignal) {
    return {
      intent: 'game_creation',
      confidence: 0.6,
      extractedPrompt: trimmed,
    };
  }

  return { intent: 'normal_chat', confidence: 0.2 };
}
