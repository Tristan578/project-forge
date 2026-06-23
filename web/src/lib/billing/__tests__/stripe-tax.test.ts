import { describe, it, expect, afterEach } from 'vitest';
import { isStripeTaxEnabled } from '../stripe-tax';

const ORIGINAL = process.env.STRIPE_TAX_ENABLED;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.STRIPE_TAX_ENABLED;
  } else {
    process.env.STRIPE_TAX_ENABLED = ORIGINAL;
  }
});

describe('isStripeTaxEnabled', () => {
  it('returns false when the flag is unset', () => {
    delete process.env.STRIPE_TAX_ENABLED;
    expect(isStripeTaxEnabled()).toBe(false);
  });

  it('returns false when the flag is empty', () => {
    process.env.STRIPE_TAX_ENABLED = '';
    expect(isStripeTaxEnabled()).toBe(false);
  });

  it('returns false for any value other than the exact string "true"', () => {
    for (const v of ['false', 'TRUE', '1', 'yes', ' true', 'true ', 'enabled']) {
      process.env.STRIPE_TAX_ENABLED = v;
      expect(isStripeTaxEnabled()).toBe(false);
    }
  });

  it('returns true only for the exact string "true"', () => {
    process.env.STRIPE_TAX_ENABLED = 'true';
    expect(isStripeTaxEnabled()).toBe(true);
  });
});
