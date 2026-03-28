// @vitest-environment jsdom
/**
 * Tests for TokenBalance component.
 *
 * The component has three render branches:
 *   1. No Clerk configured (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY missing/invalid) → returns null
 *   2. Clerk configured + starter tier → returns null (no token display for free tier)
 *   3. Clerk configured + paid tier + signed in → renders token balance
 *
 * Because `hasClerk` is evaluated at module load time, the "no Clerk" tests
 * use vi.resetModules() + dynamic import to test the branch where the env key
 * is not present. The remaining tests stub a valid pk_test_ key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock lucide-react (used in all variants)
// ---------------------------------------------------------------------------
vi.mock('lucide-react', () => ({
  Coins: (props: Record<string, unknown>) => <span data-testid="coins-icon" {...props} />,
}));

// ---------------------------------------------------------------------------
// Shared mutable state for store/clerk — updated per test
// ---------------------------------------------------------------------------
let mockIsSignedIn = true;
let mockTier = 'pro';
let mockTokenBalance: { total: number } | null = { total: 5000 };
const mockFetchBalance = vi.fn();

vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({ isSignedIn: mockIsSignedIn }),
}));

vi.mock('@/stores/userStore', () => ({
  useUserStore: () => ({
    tier: mockTier,
    tokenBalance: mockTokenBalance,
    fetchBalance: mockFetchBalance,
  }),
}));

// ---------------------------------------------------------------------------
// Import the component AFTER mocks (Clerk and userStore are mocked above)
// The component reads NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY at module load time,
// so we patch process.env before the import and use vi.resetModules() for
// the "no-Clerk" branch tests.
// ---------------------------------------------------------------------------
describe('TokenBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSignedIn = true;
    mockTier = 'pro';
    mockTokenBalance = { total: 5000 };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  // --------------------------------------------------------------------------
  // No-Clerk branch (module loads WITHOUT a valid publishable key)
  // --------------------------------------------------------------------------
  it('renders null when NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not set', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '');
    vi.resetModules();
    const { TokenBalance } = await import('../TokenBalance');
    const { container } = render(<TokenBalance />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is invalid (no pk_ prefix)', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'some-random-value');
    vi.resetModules();
    const { TokenBalance } = await import('../TokenBalance');
    const { container } = render(<TokenBalance />);
    expect(container.firstChild).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Clerk configured branch (module loads WITH a valid publishable key)
  // --------------------------------------------------------------------------
  it('renders null for starter tier even when signed in', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_validkey');
    vi.resetModules();
    mockIsSignedIn = true;
    mockTier = 'starter';
    mockTokenBalance = { total: 0 };
    const { TokenBalance } = await import('../TokenBalance');
    const { container } = render(<TokenBalance />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when user is not signed in', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_validkey');
    vi.resetModules();
    mockIsSignedIn = false;
    mockTier = 'pro';
    const { TokenBalance } = await import('../TokenBalance');
    const { container } = render(<TokenBalance />);
    expect(container.firstChild).toBeNull();
  });

  it('renders token balance for signed-in pro tier user', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_validkey');
    vi.resetModules();
    mockIsSignedIn = true;
    mockTier = 'pro';
    mockTokenBalance = { total: 12500 };
    const { TokenBalance } = await import('../TokenBalance');
    render(<TokenBalance />);

    expect(screen.getByTestId('coins-icon')).toBeDefined();
    expect(screen.getByText('12,500')).toBeDefined();
  });

  it('renders 0 tokens when tokenBalance is null', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_validkey');
    vi.resetModules();
    mockIsSignedIn = true;
    mockTier = 'pro';
    mockTokenBalance = null;
    const { TokenBalance } = await import('../TokenBalance');
    render(<TokenBalance />);

    expect(screen.getByText('0')).toBeDefined();
  });

  it('works with pk_live_ prefix (production key)', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_live_productionkey');
    vi.resetModules();
    mockIsSignedIn = true;
    mockTier = 'studio';
    mockTokenBalance = { total: 9999 };
    const { TokenBalance } = await import('../TokenBalance');
    render(<TokenBalance />);

    expect(screen.getByText('9,999')).toBeDefined();
  });

  it('calls fetchBalance when user is signed in', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_validkey');
    vi.resetModules();
    mockIsSignedIn = true;
    mockTier = 'pro';
    mockTokenBalance = { total: 1000 };
    const { TokenBalance } = await import('../TokenBalance');
    render(<TokenBalance />);

    expect(mockFetchBalance).toHaveBeenCalled();
  });
});
