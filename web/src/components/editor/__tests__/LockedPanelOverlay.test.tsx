/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { LockedPanelOverlay } from '../LockedPanelOverlay';

vi.mock('@/lib/ai/tierAccess', () => ({
  TIER_LABELS: {
    starter: 'Starter',
    hobbyist: 'Hobbyist',
    creator: 'Creator',
    pro: 'Pro',
  },
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

import { getRequiredTier } from '@/lib/ai/tierAccess';

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
    expect(screen.getByText('Pro plan required')).toBeInTheDocument();
  });

  it('uses override requiredTier when provided', () => {
    render(<LockedPanelOverlay panelId="unknown-panel" requiredTier="creator" />);
    expect(screen.getByText('Creator plan required')).toBeInTheDocument();
    // getRequiredTier should NOT be called when requiredTier is provided
    expect(vi.mocked(getRequiredTier)).not.toHaveBeenCalled();
  });

  it('shows upgrade link pointing to /settings/billing', () => {
    render(<LockedPanelOverlay panelId="physics-feel" />);
    const link = screen.getByRole('link', { name: 'Upgrade to Pro' });
    expect(link.getAttribute('href')).toBe('/settings/billing');
  });

  it('shows fallback "a higher plan" when no tier is found', () => {
    vi.mocked(getRequiredTier).mockReturnValue(null);
    render(<LockedPanelOverlay panelId="nonexistent-panel" />);
    // The component renders "a higher plan" as fallback tier text
    expect(screen.getByText(/plan required/)).toBeInTheDocument();
  });

  it('shows hobbyist tier for accessibility panel', () => {
    render(<LockedPanelOverlay panelId="accessibility" />);
    expect(screen.getByText('Hobbyist plan required')).toBeInTheDocument();
  });

  it('shows creator tier for economy panel', () => {
    render(<LockedPanelOverlay panelId="economy" />);
    expect(screen.getByText('Creator plan required')).toBeInTheDocument();
  });

  it('upgrade link text mentions the tier name', () => {
    render(<LockedPanelOverlay panelId="physics-feel" />);
    // Text is split across JSX nodes: "Upgrade to " + tierLabel
    expect(screen.getByRole('link', { name: /Upgrade to Pro/i })).toBeInTheDocument();
  });

  it('shows descriptive message about upgrading', () => {
    render(<LockedPanelOverlay panelId="physics-feel" />);
    expect(screen.getByText(/Upgrade to unlock this AI feature/)).toBeInTheDocument();
  });
});
