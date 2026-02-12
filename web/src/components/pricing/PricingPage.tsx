'use client';

import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';

export function PricingPage() {
  const { isSignedIn } = useAuth();
  const router = useRouter();

  const handleSubscribe = async (tier: string) => {
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

      if (res.ok) {
        const { url } = await res.json();
        window.location.href = url;
      }
    } catch (err) {
      console.error('Checkout error:', err);
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
          <h1 className="text-2xl font-bold">Project Forge</h1>
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
          Choose the plan that's right for you
        </p>
      </div>

      {/* Pricing cards */}
      <div className="mx-auto max-w-7xl px-6 pb-24">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {/* Free */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
            <h3 className="mb-2 text-xl font-bold">Free</h3>
            <div className="mb-4">
              <span className="text-4xl font-bold">$0</span>
              <span className="text-zinc-400">/mo</span>
            </div>
            <button
              onClick={handleGetStarted}
              className="mb-6 w-full rounded bg-zinc-800 py-2 text-sm font-medium hover:bg-zinc-700"
            >
              Get Started
            </button>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-green-500" />
                <span>1 project</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-green-500" />
                <span>50 entities per project</span>
              </li>
              <li className="flex items-start gap-2">
                <X size={16} className="mt-0.5 shrink-0 text-red-500" />
                <span>No AI features</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-green-500" />
                <span>Local save only</span>
              </li>
            </ul>
          </div>

          {/* Starter */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
            <h3 className="mb-2 text-xl font-bold">Starter</h3>
            <div className="mb-4">
              <span className="text-4xl font-bold">$9</span>
              <span className="text-zinc-400">/mo</span>
            </div>
            <button
              onClick={() => handleSubscribe('starter')}
              className="mb-6 w-full rounded bg-blue-600 py-2 text-sm font-medium hover:bg-blue-700"
            >
              Subscribe
            </button>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-green-500" />
                <span>10 projects</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-green-500" />
                <span>500 entities per project</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-green-500" />
                <span>BYOK AI (your API keys)</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-green-500" />
                <span>Cloud save</span>
              </li>
            </ul>
          </div>

          {/* Creator (Recommended) */}
          <div className="relative rounded-lg border-2 border-purple-600 bg-zinc-900 p-6">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-purple-600 px-3 py-1 text-xs font-medium">
              Recommended
            </div>
            <h3 className="mb-2 text-xl font-bold">Creator</h3>
            <div className="mb-4">
              <span className="text-4xl font-bold">$29</span>
              <span className="text-zinc-400">/mo</span>
            </div>
            <button
              onClick={() => handleSubscribe('creator')}
              className="mb-6 w-full rounded bg-purple-600 py-2 text-sm font-medium hover:bg-purple-700"
            >
              Subscribe
            </button>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-green-500" />
                <span>50 projects</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-green-500" />
                <span>2000 entities per project</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-green-500" />
                <span>BYOK AI + MCP</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-green-500" />
                <span>Game export</span>
              </li>
            </ul>
          </div>

          {/* Studio */}
          <div className="rounded-lg border border-yellow-600 bg-zinc-900 p-6">
            <h3 className="mb-2 text-xl font-bold">Studio</h3>
            <div className="mb-4">
              <span className="text-4xl font-bold">$79</span>
              <span className="text-zinc-400">/mo</span>
            </div>
            <button
              onClick={() => handleSubscribe('studio')}
              className="mb-6 w-full rounded bg-yellow-600 py-2 text-sm font-medium hover:bg-yellow-700"
            >
              Subscribe
            </button>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-green-500" />
                <span>Unlimited projects</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-green-500" />
                <span>10,000 entities per project</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-green-500" />
                <span>Platform AI keys</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-green-500" />
                <span>5,000 tokens/mo included</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
