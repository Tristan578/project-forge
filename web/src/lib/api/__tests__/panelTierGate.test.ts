/**
 * The two variants of the per-panel tier gate (#7715):
 * - `panelTierGateResponse` (create): balance-aware, so a starter counts as
 *   the trial tier only while it holds spendable tokens.
 * - `panelTierGateResponseForPoll` (status poll): ignores the LIVE balance.
 *   A starter that has HELD tokens (`monthlyTokens > 0 || addonTokens > 0`) is
 *   `TRIAL_ACCESS_TIER`, so a trial user whose one generation spent the whole
 *   grant can still read the job it paid for; a starter that never held any
 *   (a never-granted signup) is judged as `starter` and refused on hobbyist
 *   panels. Creator-or-above panels stay refused to every $0 account.
 */
import { describe, it, expect } from 'vitest';
import { panelTierGateResponse, panelTierGateResponseForPoll, type PanelTierGateUser } from '@/lib/api/panelTierGate';
import { getRequiredTier, TRIAL_ACCESS_TIER } from '@/lib/ai/tierAccess';
import { TRIAL_GRANT_TOKENS } from '@/lib/tokens/pricing';

// A panel the trial can open, and one it cannot. Derived checks rather than
// assumptions: if either panel's requirement moves, these cases would stop
// meaning what their names say, so fail loudly instead.
const HOBBYIST_PANEL = 'generate-sprite';
const CREATOR_PANEL = 'generate-model';

function user(overrides: Partial<PanelTierGateUser>): PanelTierGateUser {
  return { tier: 'starter', monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0, ...overrides };
}

/** The account a tileset (cost = the whole grant) leaves behind. */
const SPENT_STARTER = user({ tier: 'starter', monthlyTokens: TRIAL_GRANT_TOKENS, monthlyTokensUsed: TRIAL_GRANT_TOKENS });
const FUNDED_STARTER = user({ tier: 'starter', monthlyTokens: TRIAL_GRANT_TOKENS, monthlyTokensUsed: 0 });
/** A signup the trial grant never reached: nothing credited, nothing spent. */
const NEVER_GRANTED_STARTER = user({ tier: 'starter' });
/** No monthly allocation, but add-on tokens on the row. */
const ADDON_ONLY_STARTER = user({ tier: 'starter', monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 20 });

describe('panelTierGate fixtures', () => {
  it('uses a panel at exactly the trial access tier and one above it', () => {
    expect(getRequiredTier(HOBBYIST_PANEL)).toBe(TRIAL_ACCESS_TIER);
    expect(getRequiredTier(CREATOR_PANEL)).toBe('creator');
    expect(TRIAL_GRANT_TOKENS).toBeGreaterThan(0);
  });
});

describe('panelTierGateResponseForPoll (status polls)', () => {
  it('admits a spent-trial starter (held the grant, balance now 0) to a hobbyist panel', () => {
    // The fixture must really be at zero spendable, or this case would pass
    // under the balance-aware rule too and say nothing about the poll rule.
    expect(panelTierGateResponse(HOBBYIST_PANEL, SPENT_STARTER)?.status).toBe(403);
    expect(panelTierGateResponseForPoll(HOBBYIST_PANEL, SPENT_STARTER)).toBeNull();
  });

  it('admits a starter holding only add-on tokens to a hobbyist panel', () => {
    expect(panelTierGateResponseForPoll(HOBBYIST_PANEL, ADDON_ONLY_STARTER)).toBeNull();
  });

  it('refuses a never-granted starter (every token column 0) on a hobbyist panel, with the TIER_REQUIRED body', async () => {
    // The #10236 review-board blocker: status routes do not bind jobId to the
    // caller and the resolver hands a zero-cost status check the platform key,
    // so admitting this $0 account would let it poll arbitrary job ids.
    const res = panelTierGateResponseForPoll(HOBBYIST_PANEL, NEVER_GRANTED_STARTER);
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({
      error: 'TIER_REQUIRED',
      message: 'This feature requires the Starter plan',
      currentTier: 'starter',
      requiredTier: 'hobbyist',
    });
  });

  it('refuses a starter whose row shows only USED monthly tokens and no allocation', () => {
    // monthlyTokensUsed alone is not evidence of a grant: the rule reads the
    // allocation columns, never the usage counter.
    expect(panelTierGateResponseForPoll(HOBBYIST_PANEL, user({ monthlyTokensUsed: 50 }))?.status).toBe(403);
  });

  it('refuses a starter with a zero balance on a creator panel, with the TIER_REQUIRED body', async () => {
    const res = panelTierGateResponseForPoll(CREATOR_PANEL, SPENT_STARTER);
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({
      error: 'TIER_REQUIRED',
      message: 'This feature requires the Creator plan',
      currentTier: 'starter',
      requiredTier: 'creator',
    });
  });

  it('refuses even a FUNDED starter on a creator panel (the trial never reaches above the trial tier)', () => {
    expect(panelTierGateResponseForPoll(CREATOR_PANEL, FUNDED_STARTER)?.status).toBe(403);
  });

  it('judges paid tiers by their own tier, balance aside', () => {
    expect(panelTierGateResponseForPoll(HOBBYIST_PANEL, user({ tier: 'hobbyist' }))).toBeNull();
    expect(panelTierGateResponseForPoll(CREATOR_PANEL, user({ tier: 'hobbyist' }))?.status).toBe(403);
    expect(panelTierGateResponseForPoll(CREATOR_PANEL, user({ tier: 'creator' }))).toBeNull();
  });
});

describe('panelTierGateResponse (create requests)', () => {
  it('still refuses a starter with a zero balance on a hobbyist panel', async () => {
    const res = panelTierGateResponse(HOBBYIST_PANEL, SPENT_STARTER);
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({
      error: 'TIER_REQUIRED',
      message: 'This feature requires the Starter plan',
      currentTier: 'starter',
      requiredTier: 'hobbyist',
    });
  });

  it('admits a starter holding trial tokens to a hobbyist panel, and never to a creator one', () => {
    expect(panelTierGateResponse(HOBBYIST_PANEL, FUNDED_STARTER)).toBeNull();
    expect(panelTierGateResponse(CREATOR_PANEL, FUNDED_STARTER)?.status).toBe(403);
  });
});
