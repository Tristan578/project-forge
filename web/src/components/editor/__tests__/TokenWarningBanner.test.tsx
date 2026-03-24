/**
 * Tests for TokenWarningBanner component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { TokenWarningBanner } from '../TokenWarningBanner';

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  AlertTriangle: (props: Record<string, unknown>) => <span data-testid="alert-icon" {...props} />,
  CreditCard: (props: Record<string, unknown>) => <span data-testid="card-icon" {...props} />,
}));

const mockState = {
  tokenBalance: null as null | { monthlyRemaining: number; monthlyTotal: number; addon: number; total: number; nextRefillDate: string | null },
  billingStatus: null as null | { tier: string; stripeCustomerId: string | null; billingCycleStart: string | null; subscriptionStatus: string | null },
};

vi.mock('@/stores/userStore', () => ({
  useUserStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

describe('TokenWarningBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.tokenBalance = null;
    mockState.billingStatus = null;
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when no token balance or billing status', () => {
    const { container } = render(<TokenWarningBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when token balance is above 20%', () => {
    mockState.tokenBalance = { monthlyRemaining: 5000, monthlyTotal: 10000, addon: 0, total: 5000, nextRefillDate: null };
    const { container } = render(<TokenWarningBanner />);
    expect(container.querySelector('[data-testid="token-warning-banner"]')).toBeNull();
  });

  it('shows token warning when balance is below 20%', () => {
    mockState.tokenBalance = { monthlyRemaining: 500, monthlyTotal: 10000, addon: 0, total: 500, nextRefillDate: null };
    render(<TokenWarningBanner />);
    const banner = screen.getByTestId('token-warning-banner');
    expect(banner).not.toBeUndefined();
    expect(banner.getAttribute('role')).toBe('alert');
    expect(screen.getByText(/below 20%/)).not.toBeNull();
  });

  it('shows remaining token count in the banner', () => {
    mockState.tokenBalance = { monthlyRemaining: 500, monthlyTotal: 10000, addon: 0, total: 500, nextRefillDate: null };
    render(<TokenWarningBanner />);
    expect(screen.getByText(/500/)).not.toBeNull();
    expect(screen.getByText(/10,000/)).not.toBeNull();
  });

  it('shows Buy Tokens link pointing to billing', () => {
    mockState.tokenBalance = { monthlyRemaining: 100, monthlyTotal: 10000, addon: 0, total: 100, nextRefillDate: null };
    render(<TokenWarningBanner />);
    const link = screen.getByText('Buy Tokens');
    expect(link.getAttribute('href')).toBe('/settings/billing');
  });

  it('dismisses token warning when X is clicked', () => {
    mockState.tokenBalance = { monthlyRemaining: 100, monthlyTotal: 10000, addon: 0, total: 100, nextRefillDate: null };
    render(<TokenWarningBanner />);
    const dismissBtn = screen.getByLabelText('Dismiss token warning');
    fireEvent.click(dismissBtn);
    expect(screen.queryByTestId('token-warning-banner')).toBeNull();
    expect(localStorage.getItem('forge-token-warning-dismissed')).toBe('1');
  });

  it('does not show token warning when previously dismissed', () => {
    localStorage.setItem('forge-token-warning-dismissed', '1');
    mockState.tokenBalance = { monthlyRemaining: 100, monthlyTotal: 10000, addon: 0, total: 100, nextRefillDate: null };
    render(<TokenWarningBanner />);
    expect(screen.queryByTestId('token-warning-banner')).toBeNull();
  });

  it('shows payment recovery banner when subscription is past_due', () => {
    mockState.billingStatus = { tier: 'creator', stripeCustomerId: 'cus_123', billingCycleStart: null, subscriptionStatus: 'past_due' };
    render(<TokenWarningBanner />);
    const banner = screen.getByTestId('payment-warning-banner');
    expect(banner).not.toBeUndefined();
    expect(banner.getAttribute('role')).toBe('alert');
    expect(screen.getByText(/payment method has failed/)).not.toBeNull();
  });

  it('shows Update Payment link in payment recovery banner', () => {
    mockState.billingStatus = { tier: 'creator', stripeCustomerId: 'cus_123', billingCycleStart: null, subscriptionStatus: 'past_due' };
    render(<TokenWarningBanner />);
    const link = screen.getByText('Update Payment');
    expect(link.getAttribute('href')).toBe('/settings/billing');
  });

  it('dismisses payment warning when X is clicked', () => {
    mockState.billingStatus = { tier: 'creator', stripeCustomerId: 'cus_123', billingCycleStart: null, subscriptionStatus: 'past_due' };
    render(<TokenWarningBanner />);
    const dismissBtn = screen.getByLabelText('Dismiss payment warning');
    fireEvent.click(dismissBtn);
    expect(screen.queryByTestId('payment-warning-banner')).toBeNull();
    expect(localStorage.getItem('forge-payment-warning-dismissed')).toBe('1');
  });

  it('does not show payment banner when subscription is active', () => {
    mockState.billingStatus = { tier: 'creator', stripeCustomerId: 'cus_123', billingCycleStart: null, subscriptionStatus: 'active' };
    const { container } = render(<TokenWarningBanner />);
    expect(container.querySelector('[data-testid="payment-warning-banner"]')).toBeNull();
  });

  it('shows both banners simultaneously when applicable', () => {
    mockState.tokenBalance = { monthlyRemaining: 100, monthlyTotal: 10000, addon: 0, total: 100, nextRefillDate: null };
    mockState.billingStatus = { tier: 'creator', stripeCustomerId: 'cus_123', billingCycleStart: null, subscriptionStatus: 'past_due' };
    render(<TokenWarningBanner />);
    expect(screen.getByTestId('token-warning-banner')).not.toBeNull();
    expect(screen.getByTestId('payment-warning-banner')).not.toBeNull();
  });

  it('handles zero monthlyTotal without crashing', () => {
    mockState.tokenBalance = { monthlyRemaining: 0, monthlyTotal: 0, addon: 0, total: 0, nextRefillDate: null };
    const { container } = render(<TokenWarningBanner />);
    expect(container.querySelector('[data-testid="token-warning-banner"]')).toBeNull();
  });

  it('shows warning below 20% boundary', () => {
    mockState.tokenBalance = { monthlyRemaining: 1999, monthlyTotal: 10000, addon: 0, total: 1999, nextRefillDate: null };
    render(<TokenWarningBanner />);
    expect(screen.getByTestId('token-warning-banner')).not.toBeNull();
  });

  it('does not show warning at exactly 20%', () => {
    mockState.tokenBalance = { monthlyRemaining: 2000, monthlyTotal: 10000, addon: 0, total: 2000, nextRefillDate: null };
    const { container } = render(<TokenWarningBanner />);
    expect(container.querySelector('[data-testid="token-warning-banner"]')).toBeNull();
  });

  it('renders without crashing when localStorage.getItem throws SecurityError', () => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new DOMException('SecurityError', 'SecurityError'); };
    try {
      mockState.tokenBalance = { monthlyRemaining: 100, monthlyTotal: 10000, addon: 0, total: 100, nextRefillDate: null };
      // Should not throw; defaults to false (not dismissed), so banner should appear
      render(<TokenWarningBanner />);
      expect(screen.getByTestId('token-warning-banner')).not.toBeNull();
    } finally {
      Storage.prototype.getItem = originalGetItem;
    }
  });

  it('shows payment banner without crashing when localStorage.getItem throws', () => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new DOMException('SecurityError', 'SecurityError'); };
    try {
      mockState.billingStatus = { tier: 'creator', stripeCustomerId: 'cus_123', billingCycleStart: null, subscriptionStatus: 'past_due' };
      render(<TokenWarningBanner />);
      expect(screen.getByTestId('payment-warning-banner')).not.toBeNull();
    } finally {
      Storage.prototype.getItem = originalGetItem;
    }
  });
});
