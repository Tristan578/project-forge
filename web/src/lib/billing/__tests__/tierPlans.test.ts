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
  countLabel,
  isExclusionFeature,
  getTierPlan,
  tierSummary,
  TIER_PLANS,
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

  describe('countLabel', () => {
    it('agrees the noun with the count', () => {
      expect(countLabel(1, 'published game', 'published games')).toBe('1 published game');
      expect(countLabel(3, 'cloud project', 'cloud projects')).toBe('3 cloud projects');
      expect(countLabel(0, 'cloud project', 'cloud projects')).toBe('0 cloud projects');
    });

    it('pluralizes an unbounded limit', () => {
      expect(countLabel(Infinity, 'cloud project', 'cloud projects')).toBe(
        'Unlimited cloud projects'
      );
    });
  });

  describe('isExclusionFeature', () => {
    it('recognizes the free tier absence bullet', () => {
      // A surface that puts a check mark beside every bullet turns "No AI
      // features" into a promise of AI features.
      expect(isExclusionFeature('No AI features')).toBe(true);
      expect(isExclusionFeature('AI chat and asset generation')).toBe(false);
    });

    it('does not misread a feature that merely starts with the letters', () => {
      expect(isExclusionFeature('Node-based visual scripting')).toBe(false);
    });

    it('classifies every feature the free tier lists', () => {
      const free = getTierPlan('starter');
      expect(free.features.filter(isExclusionFeature)).toEqual(['No AI features']);
    });
  });

  describe('TIER_PLANS', () => {
    it('carries one plan per tier, in tier order', () => {
      expect(TIER_PLANS.map((p) => p.key)).toEqual([...TIER_KEYS]);
    });

    it('gives every plan at least one feature to show', () => {
      for (const plan of TIER_PLANS) {
        expect(plan.features.length, plan.key).toBeGreaterThan(0);
      }
    });

    it('never repeats a feature within a plan', () => {
      for (const plan of TIER_PLANS) {
        expect(new Set(plan.features).size, plan.key).toBe(plan.features.length);
      }
    });
  });

  describe('getTierPlan', () => {
    it('returns the plan whose name and price the cards render', () => {
      const plan = getTierPlan('hobbyist');
      expect(plan.name).toBe('Starter');
      expect(plan.price).toBe('$9');
      expect(plan.priceCents).toBe(900);
    });

    it('throws rather than returning undefined for an unknown tier', () => {
      // Callers interpolate the result straight into copy. A silent `undefined`
      // ships "The undefined tier cannot use AI generation" to a user.
      expect(() => getTierPlan('enterprise' as never)).toThrow(/enterprise/);
    });
  });

  describe('tierSummary', () => {
    it('names the plan and its price in one phrase', () => {
      expect(tierSummary(getTierPlan('pro'))).toBe('Studio ($79/mo)');
      expect(tierSummary(getTierPlan('starter'))).toBe('Free ($0/mo)');
    });
  });
});
