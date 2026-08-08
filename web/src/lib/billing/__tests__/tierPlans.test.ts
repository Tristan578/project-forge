import { describe, it, expect } from 'vitest';
import {
  TIER_KEYS,
  TIER_DISPLAY_NAMES,
  TIER_PRICE_CENTS,
  PROJECT_LIMITS,
  ENTITY_LIMITS,
  PUBLISH_LIMITS,
  TIER_MONTHLY_TOKENS,
  formatLimit,
  formatPrice,
} from '../tierPlans';

/**
 * Every map in this module is keyed by tier. A map that gains a tier the others
 * lack is how a surface ends up rendering `undefined` — or, worse, silently
 * falling back to the free tier's allowance for a paying customer.
 */
const TIER_MAPS = {
  TIER_DISPLAY_NAMES,
  TIER_PRICE_CENTS,
  PROJECT_LIMITS,
  ENTITY_LIMITS,
  PUBLISH_LIMITS,
  TIER_MONTHLY_TOKENS,
} as const;

describe('tierPlans', () => {
  it('lists the four billing tiers in ascending order of entitlement', () => {
    expect(TIER_KEYS).toEqual(['starter', 'hobbyist', 'creator', 'pro']);
  });

  describe.each(Object.entries(TIER_MAPS))('%s', (name, map) => {
    it('is keyed by exactly the four tier keys', () => {
      expect(Object.keys(map).sort()).toEqual([...TIER_KEYS].sort());
    });

    it('has a defined value for every tier', () => {
      for (const tier of TIER_KEYS) {
        expect(map[tier], `${name}.${tier}`).toBeDefined();
      }
    });
  });

  describe('TIER_DISPLAY_NAMES', () => {
    it('never renders a raw tier key to a user', () => {
      // `hobbyist` is the $9 plan but reads as something cheaper, and the FREE
      // tier is keyed `starter` — the name of the paid plan above it. Showing
      // either key verbatim misnames the product the user is on.
      expect(TIER_DISPLAY_NAMES).toEqual({
        starter: 'Free',
        hobbyist: 'Starter',
        creator: 'Creator',
        pro: 'Studio',
      });
    });

    it('gives each tier a distinct name', () => {
      const names = Object.values(TIER_DISPLAY_NAMES);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe('TIER_PRICE_CENTS', () => {
    it('matches the prices quoted on the pricing page', () => {
      expect(TIER_PRICE_CENTS).toEqual({
        starter: 0,
        hobbyist: 900,
        creator: 2900,
        pro: 7900,
      });
    });

    it('is monotonically increasing with entitlement', () => {
      const prices = TIER_KEYS.map((t) => TIER_PRICE_CENTS[t]);
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i]).toBeGreaterThan(prices[i - 1]);
      }
    });

    it('charges whole dollars, so the cards never need cents', () => {
      for (const tier of TIER_KEYS) {
        expect(TIER_PRICE_CENTS[tier] % 100).toBe(0);
      }
    });
  });

  describe('limits', () => {
    it.each([
      ['PROJECT_LIMITS', PROJECT_LIMITS],
      ['ENTITY_LIMITS', ENTITY_LIMITS],
      ['PUBLISH_LIMITS', PUBLISH_LIMITS],
      ['TIER_MONTHLY_TOKENS', TIER_MONTHLY_TOKENS],
    ] as const)('%s never decreases as the tier goes up', (name, map) => {
      const values = TIER_KEYS.map((t) => map[t] as number);
      for (let i = 1; i < values.length; i++) {
        expect(values[i], `${name} at ${TIER_KEYS[i]}`).toBeGreaterThan(values[i - 1]);
      }
    });
  });

  describe('formatLimit', () => {
    it('renders an unbounded limit as words, not "Infinity"', () => {
      // PROJECT_LIMITS.pro is Infinity, which stringifies to the literal
      // "Infinity" — a number no user has ever wanted to read on a card.
      expect(formatLimit(PROJECT_LIMITS.pro)).toBe('Unlimited');
      expect(formatLimit(Infinity)).toBe('Unlimited');
    });

    it('renders NaN as Unlimited rather than leaking "NaN" to a card', () => {
      expect(formatLimit(Number.NaN)).toBe('Unlimited');
    });

    it('groups thousands', () => {
      expect(formatLimit(10000)).toBe('10,000');
      expect(formatLimit(50)).toBe('50');
    });
  });

  describe('formatPrice', () => {
    it('renders whole dollars with a leading symbol', () => {
      expect(formatPrice(0)).toBe('$0');
      expect(formatPrice(900)).toBe('$9');
      expect(formatPrice(7900)).toBe('$79');
    });

    it('renders every tier price the way the cards show it', () => {
      expect(TIER_KEYS.map((t) => formatPrice(TIER_PRICE_CENTS[t]))).toEqual([
        '$0',
        '$9',
        '$29',
        '$79',
      ]);
    });
  });
});
