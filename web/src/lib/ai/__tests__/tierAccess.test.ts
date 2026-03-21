import { describe, it, expect } from 'vitest';
import {
  tierAtLeast,
  canAccessPanel,
  getAvailablePanels,
  getRequiredTier,
  PANEL_TIER_REQUIREMENTS,
  TIER_LABELS,
} from '../tierAccess';
import type { Tier } from '@/stores/userStore';

// ---------------------------------------------------------------------------
// tierAtLeast
// ---------------------------------------------------------------------------

describe('tierAtLeast', () => {
  const tiers: Tier[] = ['starter', 'hobbyist', 'creator', 'pro'];

  it('returns true when tier equals the required tier', () => {
    for (const t of tiers) {
      expect(tierAtLeast(t, t)).toBe(true);
    }
  });

  it('returns true when tier is higher than required', () => {
    expect(tierAtLeast('hobbyist', 'starter')).toBe(true);
    expect(tierAtLeast('creator', 'starter')).toBe(true);
    expect(tierAtLeast('creator', 'hobbyist')).toBe(true);
    expect(tierAtLeast('pro', 'starter')).toBe(true);
    expect(tierAtLeast('pro', 'hobbyist')).toBe(true);
    expect(tierAtLeast('pro', 'creator')).toBe(true);
  });

  it('returns false when tier is lower than required', () => {
    expect(tierAtLeast('starter', 'hobbyist')).toBe(false);
    expect(tierAtLeast('starter', 'creator')).toBe(false);
    expect(tierAtLeast('starter', 'pro')).toBe(false);
    expect(tierAtLeast('hobbyist', 'creator')).toBe(false);
    expect(tierAtLeast('hobbyist', 'pro')).toBe(false);
    expect(tierAtLeast('creator', 'pro')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canAccessPanel
// ---------------------------------------------------------------------------

describe('canAccessPanel', () => {
  it('returns true for panels without a tier requirement (free panels)', () => {
    // Core panels not in PANEL_TIER_REQUIREMENTS
    expect(canAccessPanel('scene-viewport', 'starter')).toBe(true);
    expect(canAccessPanel('scene-hierarchy', 'starter')).toBe(true);
    expect(canAccessPanel('inspector', 'starter')).toBe(true);
    expect(canAccessPanel('asset-browser', 'starter')).toBe(true);
    expect(canAccessPanel('docs', 'starter')).toBe(true);
    expect(canAccessPanel('unknown-panel', 'starter')).toBe(true);
  });

  describe('hobbyist panels', () => {
    const hobbyistPanels = ['review', 'tutorial', 'design-teacher', 'idea-generator', 'accessibility'];

    it('blocks starter from hobbyist panels', () => {
      for (const panelId of hobbyistPanels) {
        expect(canAccessPanel(panelId, 'starter')).toBe(false);
      }
    });

    it('allows hobbyist and above to access hobbyist panels', () => {
      for (const panelId of hobbyistPanels) {
        expect(canAccessPanel(panelId, 'hobbyist')).toBe(true);
        expect(canAccessPanel(panelId, 'creator')).toBe(true);
        expect(canAccessPanel(panelId, 'pro')).toBe(true);
      }
    });
  });

  describe('creator panels', () => {
    const creatorPanels = [
      'world-builder',
      'narrative',
      'economy',
      'behavior-tree',
      'level-generator',
      'pacing-analyzer',
    ];

    it('blocks starter and hobbyist from creator panels', () => {
      for (const panelId of creatorPanels) {
        expect(canAccessPanel(panelId, 'starter')).toBe(false);
        expect(canAccessPanel(panelId, 'hobbyist')).toBe(false);
      }
    });

    it('allows creator and pro to access creator panels', () => {
      for (const panelId of creatorPanels) {
        expect(canAccessPanel(panelId, 'creator')).toBe(true);
        expect(canAccessPanel(panelId, 'pro')).toBe(true);
      }
    });
  });

  describe('pro panels', () => {
    const proPanels = ['auto-iteration', 'playtest', 'auto-rigging', 'game-analytics'];

    it('blocks starter, hobbyist, and creator from pro panels', () => {
      for (const panelId of proPanels) {
        expect(canAccessPanel(panelId, 'starter')).toBe(false);
        expect(canAccessPanel(panelId, 'hobbyist')).toBe(false);
        expect(canAccessPanel(panelId, 'creator')).toBe(false);
      }
    });

    it('allows pro to access pro panels', () => {
      for (const panelId of proPanels) {
        expect(canAccessPanel(panelId, 'pro')).toBe(true);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// getAvailablePanels
// ---------------------------------------------------------------------------

describe('getAvailablePanels', () => {
  it('returns only panels whose tier requirement the user meets', () => {
    const allPanels = Object.keys(PANEL_TIER_REQUIREMENTS);

    const starterPanels = getAvailablePanels('starter', allPanels);
    expect(starterPanels).toHaveLength(0); // starter can't access any AI panel

    const hobbyistPanels = getAvailablePanels('hobbyist', allPanels);
    expect(hobbyistPanels).toContain('review');
    expect(hobbyistPanels).toContain('tutorial');
    expect(hobbyistPanels).not.toContain('world-builder');
    expect(hobbyistPanels).not.toContain('auto-iteration');

    const creatorPanels = getAvailablePanels('creator', allPanels);
    expect(creatorPanels).toContain('review'); // hobbyist panels included
    expect(creatorPanels).toContain('world-builder');
    expect(creatorPanels).not.toContain('auto-iteration'); // pro only

    const proPanels = getAvailablePanels('pro', allPanels);
    expect(proPanels).toEqual(allPanels); // pro gets everything
  });

  it('returns free panels (not in PANEL_TIER_REQUIREMENTS) when included in allPanelIds', () => {
    const mixed = ['scene-viewport', 'review', 'world-builder', 'auto-iteration'];

    const starterResult = getAvailablePanels('starter', mixed);
    expect(starterResult).toEqual(['scene-viewport']); // only the free panel

    const hobbyistResult = getAvailablePanels('hobbyist', mixed);
    expect(hobbyistResult).toContain('scene-viewport');
    expect(hobbyistResult).toContain('review');
    expect(hobbyistResult).not.toContain('world-builder');

    const proResult = getAvailablePanels('pro', mixed);
    expect(proResult).toEqual(mixed);
  });

  it('defaults to keying over PANEL_TIER_REQUIREMENTS when no allPanelIds given', () => {
    const result = getAvailablePanels('pro');
    // Should include all keyed panels
    expect(result).toContain('review');
    expect(result).toContain('world-builder');
    expect(result).toContain('auto-iteration');
  });
});

// ---------------------------------------------------------------------------
// getRequiredTier
// ---------------------------------------------------------------------------

describe('getRequiredTier', () => {
  it('returns the required tier for gated panels', () => {
    expect(getRequiredTier('review')).toBe('hobbyist');
    expect(getRequiredTier('world-builder')).toBe('creator');
    expect(getRequiredTier('auto-iteration')).toBe('pro');
  });

  it('returns null for free panels', () => {
    expect(getRequiredTier('scene-viewport')).toBeNull();
    expect(getRequiredTier('inspector')).toBeNull();
    expect(getRequiredTier('unknown-panel')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TIER_LABELS
// ---------------------------------------------------------------------------

describe('TIER_LABELS', () => {
  it('provides human-readable labels for all tiers', () => {
    expect(TIER_LABELS.starter).toBe('Starter');
    expect(TIER_LABELS.hobbyist).toBe('Hobbyist');
    expect(TIER_LABELS.creator).toBe('Creator');
    expect(TIER_LABELS.pro).toBe('Pro');
  });
});

// ---------------------------------------------------------------------------
// PANEL_TIER_REQUIREMENTS completeness
// ---------------------------------------------------------------------------

describe('PANEL_TIER_REQUIREMENTS', () => {
  it('only contains valid tier values', () => {
    const validTiers = new Set<string>(['starter', 'hobbyist', 'creator', 'pro']);
    for (const [panelId, tier] of Object.entries(PANEL_TIER_REQUIREMENTS)) {
      expect(validTiers.has(tier as string), `${panelId} has invalid tier: ${tier}`).toBe(true);
    }
  });

  it('does not include core non-AI panels', () => {
    const corePanels = ['scene-viewport', 'scene-hierarchy', 'inspector', 'asset-browser', 'docs', 'audio-mixer'];
    for (const panelId of corePanels) {
      expect(PANEL_TIER_REQUIREMENTS[panelId]).toBeUndefined();
    }
  });
});
