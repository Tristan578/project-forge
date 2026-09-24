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
 *   NOT read the live balance, because the balance-aware rule would refuse
 *   exactly the polls the trial exists to deliver: one generation can spend
 *   the whole grant (a tileset costs `TRIAL_GRANT_TOKENS`), so the account is
 *   at 0 by its first poll and every poll of the job it just paid for would be
 *   403, with the result never delivered. Instead a `starter` counts as
 *   `TRIAL_ACCESS_TIER` only when it has HELD tokens — `monthlyTokens > 0 ||
 *   addonTokens > 0` (`hasHeldTokens`). The evidence holds up because of how
 *   the columns move: `grantTrialTokens` sets `monthly_tokens` to
 *   `TRIAL_GRANT_TOKENS`, and spending only raises `monthly_tokens_used`
 *   (`deductTokens`), so a spent trial still reads
 *   `monthlyTokens === TRIAL_GRANT_TOKENS`. A
 *   starter that never received a grant (all columns 0) is judged as plain
 *   `starter` and refused on every hobbyist panel, as it was before #7715.
 *   Known gap, in the fail-CLOSED direction: add-on spending DECREMENTS
 *   `addon_tokens`, so a never-granted starter whose only tokens were add-ons,
 *   spent to exactly 0, reads as never-held and its hobbyist polls are refused.
 *   A `$0` account still never drives a CREATOR-or-above provider (3D model,
 *   skybox, …) with the platform key, because the trial never reaches above
 *   `TRIAL_ACCESS_TIER` — the same answer `canAccessPanelBeforeProfileLoad`
 *   gives the editor. Paid tiers get the same answer from both variants.
 *
 *   THIS IS NOT AN OWNERSHIP CHECK. The status routes do not bind `jobId` to
 *   the caller — pre-existing on main for every paid tier, tracked in #10262 —
 *   and `resolveApiKey` skips its tier and balance checks for a zero-cost
 *   `STATUS_CHECK_OPERATION`, so any account the poll gate admits can poll an
 *   arbitrary job id on that route with the platform key. The poll gate
 *   narrows WHO can reach a status route; it does not decide WHICH jobs they
 *   may read.
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
 * Whether the account has ever been credited tokens that its row still shows:
 * a monthly allocation (the trial grant, a paid tier, or the post-cancellation
 * starter allocation) or add-ons. Spending a monthly allocation leaves
 * `monthlyTokens` in place and raises `monthlyTokensUsed`, so a fully spent
 * trial still counts; a never-granted signup (every column 0) does not.
 */
function hasHeldTokens(user: Pick<PanelTierGateUser, 'monthlyTokens' | 'addonTokens'>): boolean {
  return user.monthlyTokens > 0 || user.addonTokens > 0;
}

/**
 * STATUS-POLL variant. Same body and same `null`-when-allowed contract as
 * `panelTierGateResponse`, but the access tier ignores the live balance: a
 * `starter` that has held tokens (`hasHeldTokens`) is `TRIAL_ACCESS_TIER`, a
 * starter that never did is `starter`, and every other account is its own
 * tier. See the module docblock for why a poll must not depend on the live
 * balance, and for why this is not a job-ownership check.
 */
export function panelTierGateResponseForPoll(panel: string, user: PanelTierGateUser): NextResponse | null {
  const accessTier: Tier =
    user.tier === 'starter' && hasHeldTokens(user) ? TRIAL_ACCESS_TIER : (user.tier as Tier);
  if (canAccessPanel(panel, accessTier)) return null;
  return tierRequiredResponse(panel, user);
}
