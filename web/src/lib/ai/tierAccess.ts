/**
 * Tier-based access control for AI panels.
 *
 * Maps subscription tiers to the AI panel IDs they may access.
 * Panel IDs match the keys in PANEL_DEFINITIONS (panelRegistry.ts).
 *
 * Tier hierarchy (lowest → highest access):
 *   starter → hobbyist → creator → pro
 */

import type { Tier } from '@/stores/userStore';

// ---------------------------------------------------------------------------
// Panel tier requirements
// ---------------------------------------------------------------------------

/**
 * Panels available to ALL tiers (free panels).
 * These are the core editor panels — not AI-feature panels.
 */
const FREE_PANELS: ReadonlySet<string> = new Set([
  'scene-viewport',
  'scene-hierarchy',
  'inspector',
  'script-editor',
  'script-explorer',
  'scene-settings',
  'asset-browser',
  'audio-mixer',
  'docs',
  'timeline',
  'tileset',
  'dialogue-editor',
  'ui-builder',
  'taskboard',
]);

/**
 * AI panels unlocked at hobbyist tier (and above).
 */
const HOBBYIST_PANELS: ReadonlySet<string> = new Set([
  'level-generator',
  'narrative',
  'pacing-analyzer',
  'idea-generator',
  'quest-generator',
  'art-style',
  'review',
  'tutorial',
]);

/**
 * AI panels unlocked at creator tier (and above).
 */
const CREATOR_PANELS: ReadonlySet<string> = new Set([
  'behavior-tree',
  'procedural-anim',
  'effect-bindings',
  'auto-iteration',
  'game-analytics',
  'auto-rigging',
  'design-teacher',
  'difficulty',
  'economy',
  'smart-camera',
  'accessibility',
  'physics-feel',
  'save-system',
  'playtest',
  'world-builder',
]);

/**
 * AI panels that require pro tier.
 */
const PRO_PANELS: ReadonlySet<string> = new Set([
  'texture-painter',
]);

// ---------------------------------------------------------------------------
// Tier ordering for comparisons
// ---------------------------------------------------------------------------

const TIER_RANK: Record<Tier, number> = {
  starter: 0,
  hobbyist: 1,
  creator: 2,
  pro: 3,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true when `tier` may open `panelId`.
 *
 * @example
 * canAccessPanel('level-generator', 'hobbyist') // true
 * canAccessPanel('level-generator', 'starter')  // false
 */
export function canAccessPanel(panelId: string, tier: Tier): boolean {
  if (FREE_PANELS.has(panelId)) return true;
  const rank = TIER_RANK[tier] ?? 0;
  if (HOBBYIST_PANELS.has(panelId)) return rank >= TIER_RANK.hobbyist;
  if (CREATOR_PANELS.has(panelId)) return rank >= TIER_RANK.creator;
  if (PRO_PANELS.has(panelId)) return rank >= TIER_RANK.pro;
  // Unknown panel IDs default to accessible (don't hide panels we don't know about).
  return true;
}

/**
 * Returns the sorted list of panel IDs accessible at `tier`.
 *
 * @example
 * getAvailablePanels('starter') // ['scene-viewport', 'inspector', ...]
 */
export function getAvailablePanels(tier: Tier): string[] {
  const all = [
    ...FREE_PANELS,
    ...HOBBYIST_PANELS,
    ...CREATOR_PANELS,
    ...PRO_PANELS,
  ];
  return all.filter((id) => canAccessPanel(id, tier)).sort();
}

/**
 * Returns the minimum tier required to access a panel, or null if the panel
 * is free / unknown.
 *
 * Useful for rendering upgrade prompts ("Requires Creator tier").
 */
export function getRequiredTier(panelId: string): Tier | null {
  if (FREE_PANELS.has(panelId)) return null;
  if (HOBBYIST_PANELS.has(panelId)) return 'hobbyist';
  if (CREATOR_PANELS.has(panelId)) return 'creator';
  if (PRO_PANELS.has(panelId)) return 'pro';
  return null;
}

/**
 * Returns a human-readable label for a tier.
 */
export function tierLabel(tier: Tier): string {
  const labels: Record<Tier, string> = {
    starter: 'Starter',
    hobbyist: 'Hobbyist',
    creator: 'Creator',
    pro: 'Pro',
  };
  return labels[tier];
}

/**
 * True when `candidate` is strictly higher than `current`.
 * Used to determine whether to show an upgrade CTA.
 */
export function isHigherTier(candidate: Tier, current: Tier): boolean {
  return (TIER_RANK[candidate] ?? 0) > (TIER_RANK[current] ?? 0);
}
