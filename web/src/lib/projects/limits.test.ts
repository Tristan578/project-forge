import { describe, it, expect } from 'vitest';
import { PROJECT_LIMITS, ENTITY_LIMITS } from './limits';

describe('PROJECT_LIMITS', () => {
  it('uses the correct tier names', () => {
    const tiers = Object.keys(PROJECT_LIMITS);
    expect(tiers).toContain('starter');
    expect(tiers).toContain('hobbyist');
    expect(tiers).toContain('creator');
    expect(tiers).toContain('pro');
  });

  it('does not use deprecated tier names', () => {
    const tiers = Object.keys(PROJECT_LIMITS);
    expect(tiers).not.toContain('free');
    expect(tiers).not.toContain('studio');
  });

  it('starter tier has the lowest project limit', () => {
    expect(PROJECT_LIMITS.starter).toBeLessThan(PROJECT_LIMITS.hobbyist);
    expect(PROJECT_LIMITS.hobbyist).toBeLessThan(PROJECT_LIMITS.creator);
  });

  it('pro tier has unlimited projects', () => {
    expect(PROJECT_LIMITS.pro).toBe(Infinity);
  });

  it('starter allows at least 1 project', () => {
    expect(PROJECT_LIMITS.starter).toBeGreaterThanOrEqual(1);
  });

  it('hobbyist allows more projects than starter', () => {
    expect(PROJECT_LIMITS.hobbyist).toBeGreaterThan(PROJECT_LIMITS.starter);
  });

  it('creator allows more projects than hobbyist', () => {
    expect(PROJECT_LIMITS.creator).toBeGreaterThan(PROJECT_LIMITS.hobbyist);
  });
});

describe('ENTITY_LIMITS', () => {
  it('uses the correct tier names', () => {
    const tiers = Object.keys(ENTITY_LIMITS);
    expect(tiers).toContain('starter');
    expect(tiers).toContain('hobbyist');
    expect(tiers).toContain('creator');
    expect(tiers).toContain('pro');
  });

  it('does not use deprecated tier names', () => {
    const tiers = Object.keys(ENTITY_LIMITS);
    expect(tiers).not.toContain('free');
    expect(tiers).not.toContain('studio');
  });

  it('limits increase with tier level', () => {
    expect(ENTITY_LIMITS.starter).toBeLessThan(ENTITY_LIMITS.hobbyist);
    expect(ENTITY_LIMITS.hobbyist).toBeLessThan(ENTITY_LIMITS.creator);
    expect(ENTITY_LIMITS.creator).toBeLessThan(ENTITY_LIMITS.pro);
  });

  it('starter tier has a non-zero entity limit', () => {
    expect(ENTITY_LIMITS.starter).toBeGreaterThan(0);
  });

  it('pro tier has the highest entity limit', () => {
    expect(ENTITY_LIMITS.pro).toBeGreaterThan(ENTITY_LIMITS.creator);
  });

  it('returns correct values for each tier', () => {
    expect(ENTITY_LIMITS.starter).toBe(50);
    expect(ENTITY_LIMITS.hobbyist).toBe(500);
    expect(ENTITY_LIMITS.creator).toBe(2000);
    expect(ENTITY_LIMITS.pro).toBe(10000);
  });
});
