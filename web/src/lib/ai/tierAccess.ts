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
// Trial access (#7715)
// ---------------------------------------------------------------------------

/**
 * The access level a `starter` account is granted while it holds tokens it
 * can spend. Signup grants `TRIAL_GRANT_TOKENS` (`grantTrialTokens`), and a
 * cancelled subscription leaves the starter allocation behind; either way the
 * tokens are only worth something if the AI surfaces that spend them open.
 * `hobbyist` is the lowest tier with AI access, so that is what the tokens
 * buy: chat and the hobbyist generation panels. Creator and pro panels stay
 * gated on the paid tier.
 */
export const TRIAL_ACCESS_TIER: Tier = 'hobbyist';

/**
 * Tokens the account can spend right now: the unused part of the monthly
 * allocation plus add-ons. The same arithmetic `getTokenBalance` reports as
 * `total`; kept here so the server gates and the client gate agree on it.
 */
export function spendableTokensOf(user: {
  monthlyTokens: number;
  monthlyTokensUsed: number;
  addonTokens: number;
}): number {
  return Math.max(0, user.monthlyTokens - user.monthlyTokensUsed) + user.addonTokens;
}

/**
 * The tier to use for an ACCESS decision. A `starter` account with spendable
 * tokens is treated as `TRIAL_ACCESS_TIER`; every other account is its own
 * tier. This is the single rule behind `canAccessPanel` in the editor,
 * `assertAiAccess` on `/api/chat` and the platform-key resolver: the three
 * gates that had kept a trial grant unusable when they each checked the raw
 * tier alone.
 */
export function effectiveTier(tier: Tier, spendableTokens: number): Tier {
  return tier === 'starter' && spendableTokens > 0 ? TRIAL_ACCESS_TIER : tier;
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
  'gdd-generator': 'hobbyist',
  'ai-chat': 'hobbyist',
  'generate-texture': 'hobbyist',
  'generate-sound': 'hobbyist',
  'generate-music': 'hobbyist',
  'generate-sprite': 'hobbyist',
  'generate-pixel-art': 'hobbyist',

  // ---------- Creator+ ----------
  'generate-model': 'creator',
  'generate-skybox': 'creator',
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

/**
 * Human-readable display label for each tier.
 *
 * Re-exported from the billing source of truth rather than restated. These
 * strings appear in upsell copy ("Requires <label> tier"), so a label that
 * doesn't match a plan on `/pricing` sends the user looking for a product that
 * does not exist — which is exactly what `Hobbyist` and `Pro` used to do.
 */
export { TIER_DISPLAY_NAMES as TIER_LABELS } from '@/lib/billing/tierPlans';
