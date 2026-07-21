/**
 * Render tests for PricingPage component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@/test/utils/componentTestUtils';
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

// vi.hoisted so the mock fn exists when the hoisted factory runs during the
// top-of-file PricingPage import (a plain const would still be in TDZ then).
const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }));
vi.mock('sonner', () => ({
  toast: { error: toastErrorMock },
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
    expect(screen.getByText('SpawnForge')).toBeDefined();
  });

  it('renders hero headline', () => {
    render(<PricingPage />);
    expect(screen.getByText('Build Games with AI')).toBeDefined();
  });

  it('renders subtitle', () => {
    render(<PricingPage />);
    expect(screen.getByText('Choose the plan that\'s right for you')).toBeDefined();
  });

  it('renders Free tier card', () => {
    render(<PricingPage />);
    expect(screen.getByText('Free')).toBeDefined();
    expect(screen.getByText('$0')).toBeDefined();
  });

  it('renders Starter tier card', () => {
    render(<PricingPage />);
    expect(screen.getByText('Starter')).toBeDefined();
    expect(screen.getByText('$9')).toBeDefined();
  });

  it('renders Creator tier card', () => {
    render(<PricingPage />);
    expect(screen.getByText('Creator')).toBeDefined();
  });

  it('renders Studio tier card', () => {
    render(<PricingPage />);
    expect(screen.getByText('Studio')).toBeDefined();
  });

  it('renders the Free tier CTA as a waitlist prompt when not signed in', () => {
    render(<PricingPage />);
    // Sign-ups are disabled pre-launch, so the logged-out Free-tier CTA invites
    // joining the waitlist rather than starting immediately.
    expect(screen.getByText('Join the Waitlist')).toBeDefined();
  });

  it('renders Sign In button when not signed in', () => {
    render(<PricingPage />);
    expect(screen.getByText('Sign In')).toBeDefined();
  });

  it('renders Dashboard button when signed in', async () => {
    // hasClerk is a module-level constant in PricingPage — must stub the env
    // and reset modules so the constant re-evaluates to true before rendering.
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_stub');
    vi.resetModules();

    // Re-mock @clerk/nextjs after resetModules so the fresh module picks it up.
    vi.doMock('@clerk/nextjs', () => ({
      useAuth: vi.fn(() => ({ isSignedIn: true })),
    }));

    const { render: localRender } = await import('@/test/utils/componentTestUtils');
    const { PricingPage: FreshPricingPage } = await import('../PricingPage');

    localRender(<FreshPricingPage />);
    expect(screen.getByText('Dashboard')).toBeDefined();

    vi.unstubAllEnvs();
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

  describe('handleSubscribe failure feedback', () => {
    // Signed-in render via the same stubEnv + resetModules + doMock pattern as
    // the Dashboard test above — hasClerk is a module-level constant.
    async function renderSignedIn() {
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_stub');
      vi.resetModules();
      vi.doMock('@clerk/nextjs', () => ({
        useAuth: vi.fn(() => ({ isSignedIn: true })),
      }));
      const { render: localRender } = await import('@/test/utils/componentTestUtils');
      const { PricingPage: FreshPricingPage } = await import('../PricingPage');
      localRender(<FreshPricingPage />);
    }

    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    it('posts the internal billing tier names, not the display names', async () => {
      // The checkout route validates z.enum(['hobbyist', 'creator', 'pro']) —
      // the "Starter" ($9) card must post 'hobbyist' and the "Studio" card
      // 'pro', or those subscriptions 422 before ever reaching Stripe.
      const fetchMock = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ url: 'about:blank' }), { status: 200 })),
      );
      vi.stubGlobal('fetch', fetchMock);
      await renderSignedIn();

      const subscribeButtons = screen.getAllByText('Subscribe');
      expect(subscribeButtons).toHaveLength(3);
      for (const button of subscribeButtons) {
        fireEvent.click(button);
      }

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(3);
      });
      const postedTiers = (fetchMock.mock.calls as unknown as [unknown, RequestInit][]).map(
        ([, init]) => JSON.parse(init.body as string).tier,
      );
      expect(postedTiers).toEqual(['hobbyist', 'creator', 'pro']);
    });

    it('toasts the server error message when checkout responds non-ok with an error body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({ error: 'Too many checkout attempts. Try again in a minute.' }),
              { status: 429 },
            ),
          ),
        ),
      );
      await renderSignedIn();

      fireEvent.click(screen.getAllByText('Subscribe')[0]);

      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenCalledWith(
          'Too many checkout attempts. Try again in a minute.',
        );
      });
    });

    it('toasts a generic retry message when the failure body is unparseable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response('internal error', { status: 500 }))),
      );
      await renderSignedIn();

      fireEvent.click(screen.getAllByText('Subscribe')[0]);

      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenCalledWith(
          'Checkout failed. Please try again in a moment.',
        );
      });
    });

    it('toasts a connection message when fetch itself rejects', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('network down'))),
      );
      await renderSignedIn();

      fireEvent.click(screen.getAllByText('Subscribe')[0]);

      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenCalledWith(
          'Checkout failed. Please check your connection and try again.',
        );
      });
    });
  });
});
