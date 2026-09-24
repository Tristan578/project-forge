/**
 * Server-side per-panel tier gate for generation routes (#7715).
 *
 * The single implementation of "may this caller use the editor panel that
 * fronts this route?". `createGenerationHandler` runs it as step 1a for every
 * create route, and every route under `src/app/api/generate/` that calls
 * `resolveApiKey()` DIRECTLY (the `status` pollers and `voice/batch`) must run
 * it too, after authentication and BEFORE the key is resolved. Those routes do
 * not go through the factory, so without this call a caller whose own panel
 * renders `LockedPanelOverlay` could still poll the provider with the platform
 * key — e.g. a trial `starter` (effective `hobbyist`) on the creator-gated
 * 3D model or skybox status route.
 *
 * `panel` must be a key of `PANEL_TIER_REQUIREMENTS` in
 * `@/lib/ai/tierAccess`: `canAccessPanel` returns true for an unmapped id, so
 * a misspelled panel is default-OPEN. Use the same id the route's create
 * handler declares in its `panel:` field.
 */

import { NextResponse } from 'next/server';
import type { Tier, User } from '@/lib/db/schema';
import { canAccessPanel, effectiveTier, getRequiredTier, spendableTokensOf, TIER_LABELS } from '@/lib/ai/tierAccess';

/** The user fields the gate reads — the auth context's `user` satisfies it. */
export type PanelTierGateUser = Pick<User, 'tier' | 'monthlyTokens' | 'monthlyTokensUsed' | 'addonTokens'>;

/**
 * Returns the 403 `TIER_REQUIRED` response when `user` may not use `panel`,
 * or `null` when the caller is allowed through. The access decision uses
 * `effectiveTier(user.tier, spendableTokensOf(user))` — the same rule the
 * editor's `canAccessPanel` applies — so the server refuses exactly when the
 * caller's panel would render locked. `currentTier` in the body is the RAW
 * tier, not the effective one.
 */
export function panelTierGateResponse(panel: string, user: PanelTierGateUser): NextResponse | null {
  const accessTier = effectiveTier(user.tier as Tier, spendableTokensOf(user));
  if (canAccessPanel(panel, accessTier)) return null;
  const requiredTier = getRequiredTier(panel);
  return NextResponse.json(
    {
      error: 'TIER_REQUIRED',
      message: `This feature requires the ${requiredTier ? TIER_LABELS[requiredTier] : 'a higher'} plan`,
      currentTier: user.tier,
      requiredTier,
    },
    { status: 403 },
  );
}
