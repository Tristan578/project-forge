/**
 * The two variants of the per-panel tier gate (#7715):
 * - `panelTierGateResponse` (create): balance-aware, so a starter counts as
 *   the trial tier only while it holds spendable tokens.
 * - `panelTierGateResponseForPoll` (status poll): ignores the balance. A
 *   starter is `TRIAL_ACCESS_TIER` whatever it holds, so a trial user whose one
 *   generation spent the whole grant can still read the job it paid for.
 *   Creator-or-above panels stay refused to every $0 account.
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

describe('panelTierGate fixtures', () => {
  it('uses a panel at exactly the trial access tier and one above it', () => {
    expect(getRequiredTier(HOBBYIST_PANEL)).toBe(TRIAL_ACCESS_TIER);
    expect(getRequiredTier(CREATOR_PANEL)).toBe('creator');
    expect(TRIAL_GRANT_TOKENS).toBeGreaterThan(0);
  });
});

describe('panelTierGateResponseForPoll (status polls)', () => {
  it('admits a starter with a zero balance to a hobbyist panel', () => {
    expect(panelTierGateResponseForPoll(HOBBYIST_PANEL, SPENT_STARTER)).toBeNull();
    expect(panelTierGateResponseForPoll(HOBBYIST_PANEL, user({}))).toBeNull();
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
