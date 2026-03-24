/**
 * Render tests for BillingTab component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { waitFor } from '@testing-library/react';
import { BillingTab } from '../BillingTab';
import { useUserStore } from '@/stores/userStore';

vi.mock('@/stores/userStore', () => ({
  useUserStore: vi.fn(() => ({})),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock('lucide-react', () => ({
  CreditCard: (props: Record<string, unknown>) => <span data-testid="credit-card-icon" {...props} />,
  ExternalLink: (props: Record<string, unknown>) => <span data-testid="external-link-icon" {...props} />,
}));

function setupUserStore(tier = 'starter', tokenBalance = { total: 1000, monthlyRemaining: 800, monthlyTotal: 1000, addon: 0 }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useUserStore).mockImplementation((selector: any) => {
    const state = { tier, tokenBalance };
    return typeof selector === 'function' ? selector(state) : state;
  });
}

describe('BillingTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupUserStore();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        tier: 'starter',
        stripeCustomerId: null,
        billingCycleStart: null,
        nextRefillDate: null,
      }),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows loading state initially', () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<BillingTab />);
    expect(screen.getByText('Loading billing information...')).not.toBeNull();
  });

  it('renders Current Plan heading after loading', async () => {
    render(<BillingTab />);
    await waitFor(() => {
      expect(screen.getByText('Current Plan')).not.toBeNull();
    });
  });

  it('renders tier name for starter tier', async () => {
    render(<BillingTab />);
    await waitFor(() => {
      expect(screen.getAllByText(/starter/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders Upgrade Plan button for starter tier', async () => {
    render(<BillingTab />);
    await waitFor(() => {
      expect(screen.getByText('Upgrade Plan')).not.toBeNull();
    });
  });

  it('renders Manage Subscription button for non-starter tiers', async () => {
    setupUserStore('hobbyist');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        tier: 'hobbyist',
        stripeCustomerId: 'cus_123',
        billingCycleStart: '2024-01-01',
        nextRefillDate: '2024-02-01',
      }),
    });
    render(<BillingTab />);
    await waitFor(() => {
      expect(screen.getByText('Manage Subscription')).not.toBeNull();
    });
  });

  it('shows upgrade message for starter tier', async () => {
    render(<BillingTab />);
    await waitFor(() => {
      expect(screen.getByText('Upgrade to unlock more features')).not.toBeNull();
    });
  });

  it('shows Token Usage section for paid tiers', async () => {
    setupUserStore('creator', { total: 5000, monthlyRemaining: 4200, monthlyTotal: 5000, addon: 0 });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        tier: 'creator',
        stripeCustomerId: 'cus_456',
        billingCycleStart: '2024-01-01',
        nextRefillDate: null,
      }),
    });
    render(<BillingTab />);
    await waitFor(() => {
      expect(screen.getByText('Token Usage')).not.toBeNull();
    });
  });

  it('shows monthly token balance for paid tiers', async () => {
    setupUserStore('creator', { total: 5000, monthlyRemaining: 4200, monthlyTotal: 5000, addon: 0 });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tier: 'creator', stripeCustomerId: null, billingCycleStart: null, nextRefillDate: null }),
    });
    render(<BillingTab />);
    await waitFor(() => {
      expect(screen.getByText(/Monthly tokens/)).not.toBeNull();
    });
  });

  it('shows add-on tokens when addon > 0', async () => {
    setupUserStore('pro', { total: 10200, monthlyRemaining: 10000, monthlyTotal: 10000, addon: 200 });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tier: 'pro', stripeCustomerId: null, billingCycleStart: null, nextRefillDate: null }),
    });
    render(<BillingTab />);
    await waitFor(() => {
      expect(screen.getByText(/Add-on tokens/)).not.toBeNull();
    });
  });

  it('shows billing cycle start for paid tiers with billing data', async () => {
    setupUserStore('hobbyist', { total: 2000, monthlyRemaining: 1800, monthlyTotal: 2000, addon: 0 });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        tier: 'hobbyist',
        stripeCustomerId: 'cus_123',
        billingCycleStart: '2024-01-01',
        nextRefillDate: '2024-02-01',
      }),
    });
    render(<BillingTab />);
    await waitFor(() => {
      expect(screen.getByText('Started:')).not.toBeNull();
      expect(screen.getByText('Next renewal:')).not.toBeNull();
    });
  });
});
