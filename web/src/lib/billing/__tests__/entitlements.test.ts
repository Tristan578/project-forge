/**
 * Tests for the Stripe Entitlements → capability mapping (PF-911 / #8821).
 *
 * This module is pure (no IO), so it is tested directly. The load-bearing
 * invariant is the GUARD: when no feature set is present, every capability MUST
 * fall back to the legacy tier-derived value, so the change is purely additive.
 */

import { describe, it, expect } from 'vitest';
import {
  FEATURE_KEYS,
  normalizeFeatures,
  hasCapability,
  featuresFromSummary,
  customerIdFromSummary,
} from '../entitlements';

describe('normalizeFeatures', () => {
  it('returns null for non-array / missing values (→ caller falls back to tier)', () => {
    expect(normalizeFeatures(null)).toBeNull();
    expect(normalizeFeatures(undefined)).toBeNull();
    expect(normalizeFeatures('ai_generation')).toBeNull();
    expect(normalizeFeatures({ ai: true })).toBeNull();
    expect(normalizeFeatures(42)).toBeNull();
  });

  it('returns an empty array for [] (authoritative "no features", NOT a fallback)', () => {
    expect(normalizeFeatures([])).toEqual([]);
  });

  it('filters out non-string and empty members without throwing', () => {
    expect(normalizeFeatures(['ai_generation', 1, null, '', 'mcp_access'])).toEqual([
      'ai_generation',
      'mcp_access',
    ]);
  });
});

describe('hasCapability', () => {
  it('uses the tier fallback when features is null/undefined', () => {
    expect(hasCapability('canUseAI', null, true)).toBe(true);
    expect(hasCapability('canUseAI', undefined, false)).toBe(false);
    expect(hasCapability('canUseMCP', null, false)).toBe(false);
  });

  it('uses the tier fallback when features is not an array', () => {
    expect(hasCapability('canPublish', 'nope' as unknown as string[], true)).toBe(true);
  });

  it('grants strictly from the active feature set when present (ignores fallback)', () => {
    const features = [FEATURE_KEYS.AI_GENERATION, FEATURE_KEYS.PUBLISH_GAMES];
    // fallback is `false`, but the feature is present → granted
    expect(hasCapability('canUseAI', features, false)).toBe(true);
    expect(hasCapability('canPublish', features, false)).toBe(true);
    // MCP feature absent → denied even though fallback is `true`
    expect(hasCapability('canUseMCP', features, true)).toBe(false);
  });

  it('an empty active set denies every capability regardless of fallback', () => {
    expect(hasCapability('canUseAI', [], true)).toBe(false);
    expect(hasCapability('canUseMCP', [], true)).toBe(false);
    expect(hasCapability('canPublish', [], true)).toBe(false);
  });

  it('maps each capability to its own feature key', () => {
    expect(hasCapability('canUseAI', [FEATURE_KEYS.MCP_ACCESS], false)).toBe(false);
    expect(hasCapability('canUseMCP', [FEATURE_KEYS.MCP_ACCESS], false)).toBe(true);
  });
});

describe('featuresFromSummary', () => {
  it('extracts and dedupes lookup_keys from the summary payload', () => {
    const summary = {
      customer: 'cus_123',
      entitlements: {
        data: [
          { lookup_key: 'ai_generation' },
          { lookup_key: 'mcp_access' },
          { lookup_key: 'ai_generation' }, // duplicate
        ],
      },
    };
    expect(featuresFromSummary(summary).sort()).toEqual(['ai_generation', 'mcp_access']);
  });

  it('returns [] for an empty / missing entitlements list (authoritative empty)', () => {
    expect(featuresFromSummary({ entitlements: { data: [] } })).toEqual([]);
    expect(featuresFromSummary({ customer: 'cus_1' })).toEqual([]);
    expect(featuresFromSummary(null)).toEqual([]);
    expect(featuresFromSummary('garbage')).toEqual([]);
  });

  it('skips malformed entitlement entries without throwing', () => {
    const summary = {
      entitlements: { data: [{ lookup_key: 'ai_generation' }, {}, null, { lookup_key: 42 }] },
    };
    expect(featuresFromSummary(summary)).toEqual(['ai_generation']);
  });
});

describe('customerIdFromSummary', () => {
  it('reads a string customer id', () => {
    expect(customerIdFromSummary({ customer: 'cus_abc' })).toBe('cus_abc');
  });

  it('reads an expanded customer object id', () => {
    expect(customerIdFromSummary({ customer: { id: 'cus_obj' } })).toBe('cus_obj');
  });

  it('returns null for missing / empty / malformed customer', () => {
    expect(customerIdFromSummary({})).toBeNull();
    expect(customerIdFromSummary({ customer: '' })).toBeNull();
    expect(customerIdFromSummary({ customer: 123 })).toBeNull();
    expect(customerIdFromSummary(null)).toBeNull();
  });
});
