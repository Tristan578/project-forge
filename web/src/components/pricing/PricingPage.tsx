'use client';

import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { TIER_PLANS, isExclusionFeature, type TierKey } from '@/lib/billing/tierPlans';

const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
const hasClerk = clerkKey.startsWith('pk_test_') || clerkKey.startsWith('pk_live_');

function useAuthSafe() {
  if (!hasClerk) return { isSignedIn: false };
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useAuth();
}

/**
 * Per-card presentation. Names, prices, and feature bullets all come from
 * `TIER_PLANS` — only the styling and the "Recommended" flag live here, because
 * those are the only things about a card that aren't a factual claim.
 */
const CARD_STYLES: Record<TierKey, { card: string; button: string; recommended?: boolean }> = {
  starter: {
    card: 'border border-zinc-800',
    button: 'bg-zinc-800 hover:bg-zinc-700',
  },
  hobbyist: {
    card: 'border border-zinc-800',
    button: 'bg-blue-600 hover:bg-blue-700',
  },
  creator: {
    card: 'relative border-2 border-purple-600',
    button: 'bg-purple-600 hover:bg-purple-700',
    recommended: true,
  },
  pro: {
    card: 'border border-yellow-600',
    button: 'bg-yellow-600 hover:bg-yellow-700',
  },
};

export function PricingPage() {
  const { isSignedIn } = useAuthSafe();
  const router = useRouter();

  // Internal billing tier names, not display names: the $9 "Starter" card is
  // the `hobbyist` tier and the "Studio" card is `pro` — these must match the
  // checkout route's z.enum and PRICE_IDS mapping or the POST 422s.
  const handleSubscribe = async (tier: 'hobbyist' | 'creator' | 'pro') => {
    if (!isSignedIn) {
      router.push('/sign-in');
      return;
    }

    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });

      if (!res.ok) {
        // The checkout route returns actionable `error` strings (rate limit,
        // bot check, Stripe failures) — surface them rather than failing silently.
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? 'Checkout failed. Please try again in a moment.');
        return;
      }

      const { url } = await res.json();
      if (typeof url !== 'string' || url.length === 0) {
        // A 200 with no session URL is a Stripe-side failure the route did not
        // catch. Navigating anyway sends the user to `/undefined`.
        toast.error('Checkout failed. Please try again in a moment.');
        return;
      }
      // `assign()` rather than `href =`: assigning to a property of a global is
      // an external mutation the React compiler rejects (react-hooks/immutability).
      window.location.assign(url);
    } catch (err) {
      console.error('Checkout error:', err);
      toast.error('Checkout failed. Please check your connection and try again.');
    }
  };

  const handleGetStarted = () => {
    if (isSignedIn) {
      router.push('/dashboard');
    } else {
      router.push('/sign-up');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <h1 className="text-2xl font-bold">SpawnForge</h1>
          <div className="flex items-center gap-4">
            {isSignedIn ? (
              <button
                onClick={() => router.push('/dashboard')}
                className="text-sm text-zinc-400 hover:text-white"
              >
                Dashboard
              </button>
            ) : (
              <button
                onClick={() => router.push('/sign-in')}
                className="text-sm text-zinc-400 hover:text-white"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="px-6 py-16 text-center">
        <h2 className="mb-4 text-5xl font-bold">Build Games with AI</h2>
        <p className="text-xl text-zinc-400">
          Choose the plan that&apos;s right for you
        </p>
      </div>

      {/* Pricing cards */}
      <div className="mx-auto max-w-7xl px-6 pb-24">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {TIER_PLANS.map((plan) => {
            const style = CARD_STYLES[plan.key];
            const isFree = plan.key === 'starter';

            return (
              <div
                key={plan.key}
                data-testid={`pricing-card-${plan.key}`}
                className={`rounded-lg bg-zinc-900 p-6 ${style.card}`}
              >
                {style.recommended && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-purple-600 px-3 py-1 text-xs font-medium">
                    Recommended
                  </div>
                )}
                <h3 className="mb-2 text-xl font-bold">{plan.name}</h3>
                <div className="mb-4">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-zinc-400">/mo</span>
                </div>
                <button
                  onClick={
                    isFree
                      ? handleGetStarted
                      : () => handleSubscribe(plan.key as 'hobbyist' | 'creator' | 'pro')
                  }
                  className={`mb-6 w-full rounded py-2 text-sm font-medium ${style.button}`}
                >
                  {isFree ? (isSignedIn ? 'Get Started' : 'Join the Waitlist') : 'Subscribe'}
                </button>
                <ul className="space-y-3 text-sm">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      {isExclusionFeature(feature) ? (
                        <X size={16} className="mt-0.5 shrink-0 text-red-500" />
                      ) : (
                        <Check size={16} className="mt-0.5 shrink-0 text-green-500" />
                      )}
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
