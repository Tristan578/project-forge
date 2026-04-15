import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { PricingPage } from '@/components/pricing/PricingPage';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://spawnforge.ai';

export const metadata: Metadata = {
  title: 'Pricing — SpawnForge',
  description: 'SpawnForge pricing plans — Free, Starter ($9/mo), Creator ($29/mo), and Studio ($79/mo). AI-powered game creation for every budget.',
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: 'Pricing — SpawnForge',
    description: 'SpawnForge pricing plans — Free, Starter ($9/mo), Creator ($29/mo), and Studio ($79/mo).',
  },
};

// Static pricing JSON-LD — safe constant with no user input.
// JSON.stringify output is safe for script[type=application/ld+json].
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
      lowPrice: '0',
      highPrice: '99',
      priceCurrency: 'USD',
      offerCount: 4,
      offers: [
        {
          '@type': 'Offer',
          name: 'Starter (Free)',
          price: '0',
          priceCurrency: 'USD',
          description: 'AI chat (limited), 1 published game, community templates, basic export',
        },
        {
          '@type': 'Offer',
          name: 'Hobbyist',
          price: '9',
          priceCurrency: 'USD',
          description: 'Unlimited AI chat, 5 published games, asset generation, priority support',
        },
        {
          '@type': 'Offer',
          name: 'Creator',
          price: '29',
          priceCurrency: 'USD',
          description: 'Unlimited publishing, custom domain, advanced AI tools, remove branding',
        },
        {
          '@type': 'Offer',
          name: 'Pro',
          price: '99',
          priceCurrency: 'USD',
          description: 'Team collaboration, API access, dedicated support, custom integrations',
        },
      ],
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
      <PricingPage />
    </>
  );
}
