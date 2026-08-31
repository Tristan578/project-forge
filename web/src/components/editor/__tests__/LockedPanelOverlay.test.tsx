/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { LockedPanelOverlay } from '../LockedPanelOverlay';

// Only `getRequiredTier` is stubbed. The labels come from the real module: a
// hand-written copy here read "Hobbyist"/"Pro" — internal billing keys that name
// no plan a user can buy — and the assertions below happily agreed with it.
vi.mock('@/lib/ai/tierAccess', async () => ({
  TIER_LABELS: (await vi.importActual<typeof import('@/lib/ai/tierAccess')>(
    '@/lib/ai/tierAccess'
  )).TIER_LABELS,
  getRequiredTier: vi.fn((panelId: string) => {
    const tiers: Record<string, 'starter' | 'hobbyist' | 'creator' | 'pro'> = {
      'physics-feel': 'pro',
      'accessibility': 'hobbyist',
      'economy': 'creator',
    };
    return tiers[panelId] ?? null;
  }),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

import { getRequiredTier, TIER_LABELS } from '@/lib/ai/tierAccess';

describe('LockedPanelOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish default implementation after clearAllMocks
    vi.mocked(getRequiredTier).mockImplementation((panelId: string) => {
      const tiers: Record<string, 'starter' | 'hobbyist' | 'creator' | 'pro'> = {
        'physics-feel': 'pro',
        'accessibility': 'hobbyist',
        'economy': 'creator',
      };
      return tiers[panelId] ?? null;
    });
  });
  afterEach(() => cleanup());

  it('has role="region" for landmark navigation', () => {
    render(<LockedPanelOverlay panelId="physics-feel" />);
    const region = screen.getByRole('region');
    expect(region).toBeInTheDocument();
    expect(region.getAttribute('aria-label')).toBe('Panel locked — upgrade required');
  });

  it('shows tier label from getRequiredTier lookup', () => {
    render(<LockedPanelOverlay panelId="physics-feel" />);
    expect(screen.getByText(`${TIER_LABELS.pro} plan required`)).toBeInTheDocument();
  });

  it('uses override requiredTier when provided', () => {
    render(<LockedPanelOverlay panelId="unknown-panel" requiredTier="creator" />);
    expect(screen.getByText(`${TIER_LABELS.creator} plan required`)).toBeInTheDocument();
    // getRequiredTier should NOT be called when requiredTier is provided
    expect(vi.mocked(getRequiredTier)).not.toHaveBeenCalled();
  });

  it('shows upgrade link pointing to the billing tab on /settings', () => {
    render(<LockedPanelOverlay panelId="physics-feel" />);
    const link = screen.getByRole('link', { name: `Upgrade to ${TIER_LABELS.pro}` });
    // Was '/settings/billing', a route that has never existed (#9046).
    expect(link.getAttribute('href')).toBe('/settings?tab=billing');
  });

  it('shows fallback "a higher plan" when no tier is found', () => {
    vi.mocked(getRequiredTier).mockReturnValue(null);
    render(<LockedPanelOverlay panelId="nonexistent-panel" />);
    // The component renders "a higher plan" as fallback tier text
    expect(screen.getByText(/plan required/)).toBeInTheDocument();
  });

  it('shows hobbyist tier for accessibility panel', () => {
    render(<LockedPanelOverlay panelId="accessibility" />);
    expect(screen.getByText(`${TIER_LABELS.hobbyist} plan required`)).toBeInTheDocument();
  });

  it('shows creator tier for economy panel', () => {
    render(<LockedPanelOverlay panelId="economy" />);
    expect(screen.getByText(`${TIER_LABELS.creator} plan required`)).toBeInTheDocument();
  });

  it('upgrade link text mentions the tier name', () => {
    render(<LockedPanelOverlay panelId="physics-feel" />);
    // Text is split across JSX nodes: "Upgrade to " + tierLabel
    expect(
      screen.getByRole('link', { name: `Upgrade to ${TIER_LABELS.pro}` })
    ).toBeInTheDocument();
  });

  it('shows descriptive message about upgrading', () => {
    render(<LockedPanelOverlay panelId="physics-feel" />);
    expect(screen.getByText(/Upgrade to unlock this AI feature/)).toBeInTheDocument();
  });
});
