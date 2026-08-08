import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { PricingPage } from '@/components/pricing/PricingPage';
import { Breadcrumbs } from '@/components/marketing/Breadcrumbs';
import { TIER_PLANS, tierSummary } from '@/lib/billing/tierPlans';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://spawnforge.ai';

// Every plan name and price comes from TIER_PLANS. Restating them here is what
// let this page advertise a $99 tier that the cards below sold for $79, and
// name plans ("Hobbyist", "Pro") that appear on no card at all.
const planSummaries = TIER_PLANS.map(tierSummary).join(', ');

export const metadata: Metadata = {
  title: 'Pricing — SpawnForge',
  description: `SpawnForge pricing plans — ${planSummaries}. AI-powered game creation for every budget.`,
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: 'Pricing — SpawnForge',
    description: `SpawnForge pricing plans — ${planSummaries}.`,
  },
};

// Static pricing JSON-LD — safe constant with no user input.
// JSON.stringify output is safe for script[type=application/ld+json].
//
// Structured data is a machine-readable copy of the offer, so it has to say
// exactly what the cards say. Each offer's description is the plan's own
// feature list, which is derived from the limits the server enforces.
const pricingJsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'SpawnForge Pricing',
  url: `${SITE_URL}/pricing`,
  mainEntity: {
    '@type': 'SoftwareApplication',
    name: 'SpawnForge',
    applicationCategory: ['GameApplication', 'DeveloperApplication'],
    operatingSystem: 'Web Browser',
    offers: {
      '@type': 'AggregateOffer',
      lowPrice: String(Math.min(...TIER_PLANS.map((p) => p.priceCents)) / 100),
      highPrice: String(Math.max(...TIER_PLANS.map((p) => p.priceCents)) / 100),
      priceCurrency: 'USD',
      offerCount: TIER_PLANS.length,
      offers: TIER_PLANS.map((plan) => ({
        '@type': 'Offer',
        name: plan.name,
        price: String(plan.priceCents / 100),
        priceCurrency: 'USD',
        description: plan.features.join(', '),
      })),
    },
  },
});

export default async function Pricing() {
  'use cache';
  cacheLife('days');
  cacheTag('pricing');
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: pricingJsonLd }}
      />
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
        <Breadcrumbs items={[{ label: 'Pricing', href: '/pricing' }]} />
        <PricingPage />
      </div>
    </>
  );
}
