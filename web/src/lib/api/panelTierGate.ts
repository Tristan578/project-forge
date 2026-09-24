/**
 * Server-side per-panel tier gate for generation routes (#7715).
 *
 * The single implementation of "may this caller use the editor panel that
 * fronts this route?". It comes in TWO variants, one per kind of request,
 * and every route under `src/app/api/generate/` runs exactly one of them
 * after authentication and BEFORE any provider key is resolved:
 *
 * - `panelTierGateResponse` — CREATE requests (work that spends tokens).
 *   `createGenerationHandler` runs it as step 1a for every create route, and
 *   `voice/batch` (which resolves its key directly but starts a charged batch)
 *   runs it too. The access tier is BALANCE-AWARE:
 *   `effectiveTier(user.tier, spendableTokensOf(user))`, the same rule the
 *   editor's `canAccessPanel` applies, so a `starter` counts as the trial
 *   tier only while it still has trial tokens to spend.
 *
 * - `panelTierGateResponseForPoll` — STATUS POLLS (`generate/<type>/status`),
 *   which read a job the caller has ALREADY paid for. The access tier does
 *   NOT read the balance: a `starter` counts as `TRIAL_ACCESS_TIER` whatever
 *   it holds. The balance-aware rule would refuse exactly the polls the trial
 *   exists to deliver — one generation can spend the whole grant (a tileset
 *   costs `TRIAL_GRANT_TOKENS`), so the account is at 0 by its first poll and
 *   every poll of the job it just paid for would be 403, with the result never
 *   delivered. What gating the pollers is FOR is unchanged: a `$0` account
 *   still cannot drive a CREATOR-or-above provider (3D model, skybox, …) with
 *   the platform key, because the trial never reaches above
 *   `TRIAL_ACCESS_TIER` — the same answer `canAccessPanelBeforeProfileLoad`
 *   gives the editor. Paid tiers get the same answer from both variants.
 *
 * `panel` must be a key of `PANEL_TIER_REQUIREMENTS` in
 * `@/lib/ai/tierAccess`: `canAccessPanel` returns true for an unmapped id, so
 * a misspelled panel is default-OPEN. Use the same id the route's create
 * handler declares in its `panel:` field.
 */

import { NextResponse } from 'next/server';
import type { Tier, User } from '@/lib/db/schema';
import {
  canAccessPanel,
  effectiveTier,
  getRequiredTier,
  spendableTokensOf,
  TIER_LABELS,
  TRIAL_ACCESS_TIER,
} from '@/lib/ai/tierAccess';

/** The user fields the gate reads — the auth context's `user` satisfies it. */
export type PanelTierGateUser = Pick<User, 'tier' | 'monthlyTokens' | 'monthlyTokensUsed' | 'addonTokens'>;

/** The 403 body both variants return. `currentTier` is the RAW tier, not the access tier. */
function tierRequiredResponse(panel: string, user: PanelTierGateUser): NextResponse {
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

/**
 * CREATE variant. Returns the 403 `TIER_REQUIRED` response when `user` may
 * not start work on `panel`, or `null` when the caller is allowed through.
 * Balance-aware: `effectiveTier(user.tier, spendableTokensOf(user))`, so the
 * server refuses exactly when the caller's panel would render locked.
 */
export function panelTierGateResponse(panel: string, user: PanelTierGateUser): NextResponse | null {
  const accessTier = effectiveTier(user.tier as Tier, spendableTokensOf(user));
  if (canAccessPanel(panel, accessTier)) return null;
  return tierRequiredResponse(panel, user);
}

/**
 * STATUS-POLL variant. Same body and same `null`-when-allowed contract as
 * `panelTierGateResponse`, but the access tier ignores the balance: a
 * `starter` is `TRIAL_ACCESS_TIER`, every other account is its own tier. See
 * the module docblock for why a poll must not depend on the live balance.
 */
export function panelTierGateResponseForPoll(panel: string, user: PanelTierGateUser): NextResponse | null {
  const accessTier: Tier = user.tier === 'starter' ? TRIAL_ACCESS_TIER : (user.tier as Tier);
  if (canAccessPanel(panel, accessTier)) return null;
  return tierRequiredResponse(panel, user);
}
