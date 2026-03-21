import { describe, it, expect } from 'vitest';
import {
  canAccessPanel,
  getAvailablePanels,
  getRequiredTier,
  tierLabel,
  isHigherTier,
} from '../tierAccess';
import type { Tier } from '@/stores/userStore';

// ---------------------------------------------------------------------------
// canAccessPanel
// ---------------------------------------------------------------------------

describe('canAccessPanel', () => {
  // ---- Free panels accessible to all tiers ----
  const FREE_SAMPLE = ['scene-viewport', 'inspector', 'docs', 'audio-mixer', 'asset-browser'];
  for (const panelId of FREE_SAMPLE) {
    for (const tier of ['starter', 'hobbyist', 'creator', 'pro'] as Tier[]) {
      it(`allows ${tier} to access free panel "${panelId}"`, () => {
        expect(canAccessPanel(panelId, tier)).toBe(true);
      });
    }
  }

  // ---- Hobbyist panels ----
  it('denies starter from hobbyist panel "level-generator"', () => {
    expect(canAccessPanel('level-generator', 'starter')).toBe(false);
  });

  it('allows hobbyist to access "level-generator"', () => {
    expect(canAccessPanel('level-generator', 'hobbyist')).toBe(true);
  });

  it('allows creator to access "level-generator" (higher tier)', () => {
    expect(canAccessPanel('level-generator', 'creator')).toBe(true);
  });

  it('allows pro to access "level-generator" (highest tier)', () => {
    expect(canAccessPanel('level-generator', 'pro')).toBe(true);
  });

  it('denies starter from hobbyist panel "pacing-analyzer"', () => {
    expect(canAccessPanel('pacing-analyzer', 'starter')).toBe(false);
  });

  it('allows hobbyist to access "pacing-analyzer"', () => {
    expect(canAccessPanel('pacing-analyzer', 'hobbyist')).toBe(true);
  });

  // ---- Creator panels ----
  it('denies starter from creator panel "behavior-tree"', () => {
    expect(canAccessPanel('behavior-tree', 'starter')).toBe(false);
  });

  it('denies hobbyist from creator panel "behavior-tree"', () => {
    expect(canAccessPanel('behavior-tree', 'hobbyist')).toBe(false);
  });

  it('allows creator to access "behavior-tree"', () => {
    expect(canAccessPanel('behavior-tree', 'creator')).toBe(true);
  });

  it('allows pro to access "behavior-tree"', () => {
    expect(canAccessPanel('behavior-tree', 'pro')).toBe(true);
  });

  it('denies starter from "auto-iteration"', () => {
    expect(canAccessPanel('auto-iteration', 'starter')).toBe(false);
  });

  it('allows creator to access "texture-painter" is false (pro only)', () => {
    expect(canAccessPanel('texture-painter', 'creator')).toBe(false);
  });

  it('allows pro to access "texture-painter"', () => {
    expect(canAccessPanel('texture-painter', 'pro')).toBe(true);
  });

  // ---- Unknown panel IDs default to accessible ----
  it('allows access to unknown panel IDs (do not block unknown panels)', () => {
    expect(canAccessPanel('some-future-panel', 'starter')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getAvailablePanels
// ---------------------------------------------------------------------------

describe('getAvailablePanels', () => {
  it('returns a non-empty array for all tiers', () => {
    for (const tier of ['starter', 'hobbyist', 'creator', 'pro'] as Tier[]) {
      expect(getAvailablePanels(tier).length).toBeGreaterThan(0);
    }
  });

  it('higher tiers have at least as many panels as lower tiers', () => {
    const starter = getAvailablePanels('starter').length;
    const hobbyist = getAvailablePanels('hobbyist').length;
    const creator = getAvailablePanels('creator').length;
    const pro = getAvailablePanels('pro').length;
    expect(hobbyist).toBeGreaterThanOrEqual(starter);
    expect(creator).toBeGreaterThanOrEqual(hobbyist);
    expect(pro).toBeGreaterThanOrEqual(creator);
  });

  it('starter panels include core free panels', () => {
    const panels = getAvailablePanels('starter');
    expect(panels).toContain('scene-viewport');
    expect(panels).toContain('inspector');
    expect(panels).toContain('docs');
  });

  it('starter panels do not include locked AI panels', () => {
    const panels = getAvailablePanels('starter');
    expect(panels).not.toContain('level-generator');
    expect(panels).not.toContain('behavior-tree');
    expect(panels).not.toContain('texture-painter');
  });

  it('hobbyist panels include hobbyist AI panels', () => {
    const panels = getAvailablePanels('hobbyist');
    expect(panels).toContain('level-generator');
    expect(panels).toContain('pacing-analyzer');
  });

  it('hobbyist panels do not include creator panels', () => {
    const panels = getAvailablePanels('hobbyist');
    expect(panels).not.toContain('behavior-tree');
    expect(panels).not.toContain('texture-painter');
  });

  it('pro panels include all panels', () => {
    const panels = getAvailablePanels('pro');
    expect(panels).toContain('texture-painter');
    expect(panels).toContain('behavior-tree');
    expect(panels).toContain('level-generator');
    expect(panels).toContain('scene-viewport');
  });

  it('returns panels in sorted order', () => {
    const panels = getAvailablePanels('pro');
    const sorted = [...panels].sort();
    expect(panels).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// getRequiredTier
// ---------------------------------------------------------------------------

describe('getRequiredTier', () => {
  it('returns null for free panels', () => {
    expect(getRequiredTier('scene-viewport')).toBeNull();
    expect(getRequiredTier('inspector')).toBeNull();
    expect(getRequiredTier('docs')).toBeNull();
  });

  it('returns "hobbyist" for hobbyist-tier panels', () => {
    expect(getRequiredTier('level-generator')).toBe('hobbyist');
    expect(getRequiredTier('pacing-analyzer')).toBe('hobbyist');
    expect(getRequiredTier('idea-generator')).toBe('hobbyist');
  });

  it('returns "creator" for creator-tier panels', () => {
    expect(getRequiredTier('behavior-tree')).toBe('creator');
    expect(getRequiredTier('auto-iteration')).toBe('creator');
    expect(getRequiredTier('design-teacher')).toBe('creator');
  });

  it('returns "pro" for pro-tier panels', () => {
    expect(getRequiredTier('texture-painter')).toBe('pro');
  });

  it('returns null for unknown panel IDs', () => {
    expect(getRequiredTier('nonexistent-panel')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// tierLabel
// ---------------------------------------------------------------------------

describe('tierLabel', () => {
  it('returns human-readable labels', () => {
    expect(tierLabel('starter')).toBe('Starter');
    expect(tierLabel('hobbyist')).toBe('Hobbyist');
    expect(tierLabel('creator')).toBe('Creator');
    expect(tierLabel('pro')).toBe('Pro');
  });
});

// ---------------------------------------------------------------------------
// isHigherTier
// ---------------------------------------------------------------------------

describe('isHigherTier', () => {
  it('returns true when candidate is strictly higher than current', () => {
    expect(isHigherTier('hobbyist', 'starter')).toBe(true);
    expect(isHigherTier('creator', 'hobbyist')).toBe(true);
    expect(isHigherTier('pro', 'creator')).toBe(true);
    expect(isHigherTier('pro', 'starter')).toBe(true);
  });

  it('returns false for equal tiers', () => {
    expect(isHigherTier('starter', 'starter')).toBe(false);
    expect(isHigherTier('pro', 'pro')).toBe(false);
  });

  it('returns false when candidate is lower than current', () => {
    expect(isHigherTier('starter', 'hobbyist')).toBe(false);
    expect(isHigherTier('hobbyist', 'pro')).toBe(false);
  });
});
