/**
 * Render tests for PricingPage component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@/test/utils/componentTestUtils';
import { PricingPage } from '../PricingPage';
import {
  TIER_PLANS,
  PROJECT_LIMITS,
  PUBLISH_LIMITS,
  formatLimit,
} from '@/lib/billing/tierPlans';

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

  describe('claims match what the code enforces', () => {
    it('quotes each tier\'s project and publish limits from the maps that enforce them', () => {
      render(<PricingPage />);

      for (const plan of TIER_PLANS) {
        const card = screen.getByTestId(`pricing-card-${plan.key}`);
        const projects = PROJECT_LIMITS[plan.key];
        const published = PUBLISH_LIMITS[plan.key];

        expect(card.textContent).toContain(
          `${formatLimit(projects)} ${projects === 1 ? 'cloud project' : 'cloud projects'}`,
        );
        expect(card.textContent).toContain(
          `${formatLimit(published)} ${published === 1 ? 'published game' : 'published games'}`,
        );
      }
    });

    it('does not sell a feature no code path implements', () => {
      const { container } = render(<PricingPage />);
      const copy = container.textContent ?? '';

      // Each of these shipped on a pricing surface with nothing behind it:
      // no gate, no route, no flag. Selling them is the defect PF-1021 exists
      // to fix, so the page must never carry them again.
      for (const claim of [
        'Custom domain',
        'Remove branding',
        'Team collaboration',
        'Custom integrations',
        'Unlimited AI chat',
        'dedicated support',
      ]) {
        expect(copy).not.toContain(claim);
      }
    });

    it('does not quote an entity cap, because nothing enforces one', () => {
      // ENTITY_LIMITS is declared but read by no code path, so a per-project
      // entity cap is not a limit we can honestly put on a card.
      const { container } = render(<PricingPage />);
      expect(container.textContent ?? '').not.toContain('entities');
    });

    it('marks the free tier\'s AI exclusion as an absence, not a feature', () => {
      render(<PricingPage />);
      const card = screen.getByTestId('pricing-card-starter');
      expect(card.textContent).toContain('No AI features');
      expect(card.querySelectorAll('[data-testid="x-icon"]')).toHaveLength(1);
    });
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

    it('sends the user to the Stripe session URL on success', async () => {
      // `assign()` rather than `href =` — assigning to a property of a global
      // is an external mutation the React compiler rejects. Asserting on the
      // method keeps that constraint from being silently reverted.
      const assignMock = vi.fn();
      // jsdom marks Location#assign non-configurable and non-writable, so
      // vi.spyOn cannot redefine it. The `location` slot on `window` IS
      // configurable, so replacing the whole object is what works.
      // `vi.unstubAllGlobals()` in afterEach puts the real one back.
      vi.stubGlobal('location', { ...window.location, assign: assignMock });
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify({ url: 'https://checkout.stripe.test/c/pay/cs_test_1' }), {
              status: 200,
            }),
          ),
        ),
      );
      await renderSignedIn();

      fireEvent.click(screen.getAllByText('Subscribe')[0]);

      await waitFor(() => {
        expect(assignMock).toHaveBeenCalledWith('https://checkout.stripe.test/c/pay/cs_test_1');
      });
      expect(toastErrorMock).not.toHaveBeenCalled();
    });

    it.each([
      ['omits the url entirely', {}],
      ['returns a null url', { url: null }],
      ['returns an empty url', { url: '' }],
    ])('toasts and stays put when a 200 %s', async (_case, body) => {
      // A 200 with no session URL is a Stripe-side failure the route did not
      // catch. Navigating on it sends the user to `/undefined` — a dead page
      // that reads as "checkout is broken" with no way back.
      const assignMock = vi.fn();
      vi.stubGlobal('location', { ...window.location, assign: assignMock });
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))),
      );
      await renderSignedIn();

      fireEvent.click(screen.getAllByText('Subscribe')[0]);

      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenCalledWith(
          'Checkout failed. Please try again in a moment.',
        );
      });
      expect(assignMock).not.toHaveBeenCalled();
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
