/**
 * Render tests for PricingPage component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { PricingPage } from '../PricingPage';

vi.mock('@clerk/nextjs', () => ({
  useAuth: vi.fn(() => ({ isSignedIn: false })),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock('lucide-react', () => ({
  Check: (props: Record<string, unknown>) => <span data-testid="check-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
}));

describe('PricingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders SpawnForge brand heading', () => {
    render(<PricingPage />);
    expect(screen.getByText('SpawnForge')).not.toBeNull();
  });

  it('renders hero headline', () => {
    render(<PricingPage />);
    expect(screen.getByText('Build Games with AI')).not.toBeNull();
  });

  it('renders subtitle', () => {
    render(<PricingPage />);
    expect(screen.getByText('Choose the plan that\'s right for you')).not.toBeNull();
  });

  it('renders Free tier card', () => {
    render(<PricingPage />);
    expect(screen.getByText('Free')).not.toBeNull();
    expect(screen.getByText('$0')).not.toBeNull();
  });

  it('renders Starter tier card', () => {
    render(<PricingPage />);
    expect(screen.getByText('Starter')).not.toBeNull();
    expect(screen.getByText('$9')).not.toBeNull();
  });

  it('renders Creator tier card', () => {
    render(<PricingPage />);
    expect(screen.getByText('Creator')).not.toBeNull();
  });

  it('renders Studio tier card', () => {
    render(<PricingPage />);
    expect(screen.getByText('Studio')).not.toBeNull();
  });

  it('renders Get Started button for Free tier', () => {
    render(<PricingPage />);
    expect(screen.getByText('Get Started')).not.toBeNull();
  });

  it('renders Sign In button when not signed in', () => {
    render(<PricingPage />);
    expect(screen.getByText('Sign In')).not.toBeNull();
  });

  it('renders Dashboard button when signed in', async () => {
    const { useAuth } = await import('@clerk/nextjs');
    vi.mocked(useAuth).mockReturnValue({ isSignedIn: true } as ReturnType<typeof useAuth>);
    render(<PricingPage />);
    expect(screen.getByText('Dashboard')).not.toBeNull();
    // Reset
    vi.mocked(useAuth).mockReturnValue({ isSignedIn: false } as ReturnType<typeof useAuth>);
  });

  it('renders multiple per-month price labels', () => {
    render(<PricingPage />);
    const perMonth = screen.getAllByText('/mo');
    expect(perMonth.length).toBeGreaterThanOrEqual(4);
  });

  it('renders feature check marks', () => {
    render(<PricingPage />);
    const checks = screen.getAllByTestId('check-icon');
    expect(checks.length).toBeGreaterThan(0);
  });
});
