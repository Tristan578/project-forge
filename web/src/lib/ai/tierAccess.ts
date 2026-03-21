/**
 * Tier-based access control for AI panels.
 *
 * Maps each AI panel ID to the minimum subscription tier required to use it.
 * The four tiers in ascending capability order are:
 *   starter < hobbyist < creator < pro
 *
 * Rules (from product spec):
 *   - Core editing panels (scene, hierarchy, inspector, assets, docs) are always free.
 *   - Hobbyist+ gets basic AI panels (review, tutorial, design-teacher, idea-generator).
 *   - Creator+ gets advanced AI panels (world-builder, narrative, economy, …).
 *   - Pro gets all panels including the most powerful ones (auto-iteration, playtest).
 */

import type { Tier } from '@/stores/userStore';

// ---------------------------------------------------------------------------
// Tier ordering
// ---------------------------------------------------------------------------

/** Numeric rank for comparison — higher is more capable. */
const TIER_RANK: Record<Tier, number> = {
  starter: 0,
  hobbyist: 1,
  creator: 2,
  pro: 3,
};

/** Returns true if `tier` meets or exceeds `required`. */
export function tierAtLeast(tier: Tier, required: Tier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[required];
}

// ---------------------------------------------------------------------------
// Panel tier requirements
// ---------------------------------------------------------------------------

/**
 * Minimum tier required to access a panel.
 * Panels absent from this map are always accessible (free / non-AI panels).
 */
export const PANEL_TIER_REQUIREMENTS: Partial<Record<string, Tier>> = {
  // ---------- Hobbyist+ ----------
  review: 'hobbyist',
  tutorial: 'hobbyist',
  'design-teacher': 'hobbyist',
  'idea-generator': 'hobbyist',
  accessibility: 'hobbyist',

  // ---------- Creator+ ----------
  'world-builder': 'creator',
  narrative: 'creator',
  economy: 'creator',
  'behavior-tree': 'creator',
  'level-generator': 'creator',
  'save-system': 'creator',
  'art-style': 'creator',
  'physics-feel': 'creator',
  difficulty: 'creator',
  'pacing-analyzer': 'creator',
  'quest-generator': 'creator',
  'smart-camera': 'creator',
  'texture-painter': 'creator',
  'procedural-anim': 'creator',

  // ---------- Pro only ----------
  'auto-iteration': 'pro',
  playtest: 'pro',
  'auto-rigging': 'pro',
  'game-analytics': 'pro',
};

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if `tier` is allowed to open `panelId`.
 * Panels without a tier requirement are always accessible.
 */
export function canAccessPanel(panelId: string, tier: Tier): boolean {
  const required = PANEL_TIER_REQUIREMENTS[panelId];
  if (required === undefined) return true;
  return tierAtLeast(tier, required);
}

/**
 * Returns the list of panel IDs accessible for `tier`.
 * Accepts an optional full list of panel IDs to check against;
 * defaults to all panels that have a tier requirement (plus all free panels
 * in the provided list).
 */
export function getAvailablePanels(tier: Tier, allPanelIds?: string[]): string[] {
  const ids = allPanelIds ?? Object.keys(PANEL_TIER_REQUIREMENTS);
  return ids.filter((id) => canAccessPanel(id, tier));
}

/**
 * Returns the minimum tier required for `panelId`, or null if no restriction.
 */
export function getRequiredTier(panelId: string): Tier | null {
  return PANEL_TIER_REQUIREMENTS[panelId] ?? null;
}

/** Human-readable display label for each tier. */
export const TIER_LABELS: Record<Tier, string> = {
  starter: 'Starter',
  hobbyist: 'Hobbyist',
  creator: 'Creator',
  pro: 'Pro',
};
