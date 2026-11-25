/**
 * Render tests for TokenDashboard component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { TokenDashboard } from '../TokenDashboard';
import { useUserStore } from '@/stores/userStore';

vi.mock('@/stores/userStore', () => ({
  useUserStore: vi.fn(() => ({})),
}));

vi.mock('@/lib/tokens/pricing', () => ({
  TOKEN_PACKAGES: {
    spark: { tokens: 1000, priceCents: 1200, label: 'Spark' },
    blaze: { tokens: 5000, priceCents: 4900, label: 'Blaze' },
  },
}));

vi.mock('lucide-react', () => ({
  Coins: (props: Record<string, unknown>) => <span data-testid="coins-icon" {...props} />,
  TrendingUp: (props: Record<string, unknown>) => <span data-testid="trending-icon" {...props} />,
  ShoppingCart: (props: Record<string, unknown>) => <span data-testid="cart-icon" {...props} />,
}));

describe('TokenDashboard', () => {
  const mockFetchBalance = vi.fn();

  function setupStore({
    tokenBalance = null as null | {
      total: number;
      monthlyRemaining: number;
      addon: number;
      nextRefillDate?: string;
    },
    tier = 'hobbyist' as string,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useUserStore).mockImplementation((selector: any) => {
      const state = {
        tokenBalance,
        tier,
        fetchBalance: mockFetchBalance,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ usage: [] }),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Token Balance heading', () => {
    setupStore();
    render(<TokenDashboard />);
    expect(screen.getByText('Token Balance')).toBeDefined();
  });

  it('calls fetchBalance on mount', () => {
    setupStore();
    render(<TokenDashboard />);
    expect(mockFetchBalance).toHaveBeenCalled();
  });

  it('shows Loading when tokenBalance is null', () => {
    setupStore({ tokenBalance: null });
    render(<TokenDashboard />);
    expect(screen.getByText('Loading...')).toBeDefined();
  });

  it('renders total available tokens when balance loaded', () => {
    setupStore({
      tokenBalance: { total: 12345, monthlyRemaining: 8000, addon: 4345 },
    });
    render(<TokenDashboard />);
    expect(screen.getByText('12,345')).toBeDefined();
    expect(screen.getByText('Total Available')).toBeDefined();
  });

  it('renders monthly remaining tokens', () => {
    setupStore({
      tokenBalance: { total: 12345, monthlyRemaining: 8000, addon: 4345 },
    });
    render(<TokenDashboard />);
    expect(screen.getByText('8,000')).toBeDefined();
    expect(screen.getByText('Monthly Remaining')).toBeDefined();
  });

  // #7715: the free (`starter`) plan has no monthly allocation, so its
  // balance must read as the one-time trial grant and never promise a refill.
  describe('balance labelling by tier (#7715)', () => {
    const REFILL = '2026-10-01T00:00:00.000Z';

    it('labels a paid tier balance as monthly and shows the next refill', () => {
      setupStore({
        tokenBalance: { total: 300, monthlyRemaining: 300, addon: 0, nextRefillDate: REFILL },
        tier: 'hobbyist',
      });
      render(<TokenDashboard />);
      expect(screen.getByText('Monthly Remaining')).toBeInTheDocument();
      expect(screen.getByText(/^Next refill:/)).toBeInTheDocument();
      expect(screen.queryByText('Trial Remaining')).toBeNull();
      expect(screen.queryByText(/One-time trial grant/)).toBeNull();
    });

    it('labels a starter balance as the one-time trial grant with no refill line', () => {
      setupStore({
        // A refill date can still be present (a cancelled plan's billing
        // cycle); the free plan does not refill, so it must not be shown.
        tokenBalance: { total: 50, monthlyRemaining: 50, addon: 0, nextRefillDate: REFILL },
        tier: 'starter',
      });
      render(<TokenDashboard />);
      expect(screen.getByText('Trial Remaining')).toBeInTheDocument();
      expect(
        screen.getByText('One-time trial grant — does not renew. Upgrade for a monthly allowance.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Monthly Remaining')).toBeNull();
      expect(screen.queryByText(/Next refill/)).toBeNull();
    });
  });

  it('renders addon tokens', () => {
    setupStore({
      tokenBalance: { total: 12345, monthlyRemaining: 8000, addon: 4345 },
    });
    render(<TokenDashboard />);
    expect(screen.getByText('4,345')).toBeDefined();
    expect(screen.getByText('Add-On')).toBeDefined();
  });

  it('shows Buy More Tokens for non-starter tier', () => {
    setupStore({
      tokenBalance: { total: 1000, monthlyRemaining: 1000, addon: 0 },
      tier: 'hobbyist',
    });
    render(<TokenDashboard />);
    expect(screen.getByText('Buy More Tokens')).toBeDefined();
  });

  it('hides Buy More Tokens for starter tier', () => {
    setupStore({
      tokenBalance: { total: 0, monthlyRemaining: 0, addon: 0 },
      tier: 'starter',
    });
    render(<TokenDashboard />);
    expect(screen.queryByText('Buy More Tokens')).toBeNull();
  });

  it('renders token package buttons', () => {
    setupStore({
      tokenBalance: { total: 1000, monthlyRemaining: 1000, addon: 0 },
      tier: 'hobbyist',
    });
    render(<TokenDashboard />);
    expect(screen.getByText('Spark')).toBeDefined();
    expect(screen.getByText('Blaze')).toBeDefined();
  });
});
