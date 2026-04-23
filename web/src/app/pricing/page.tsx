import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { PricingPage } from '@/components/pricing/PricingPage';

export const metadata: Metadata = {
  title: 'Pricing — SpawnForge',
  description: 'SpawnForge pricing plans — Free, Starter ($9/mo), Pro ($29/mo), and Studio ($99/mo). AI-powered game creation for every budget.',
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: 'Pricing — SpawnForge',
    description: 'SpawnForge pricing plans — Free, Starter ($9/mo), Pro ($29/mo), and Studio ($99/mo). AI-powered game creation for every budget.',
  },
};

export default async function Pricing() {
  'use cache';
  cacheLife('days');
  cacheTag('pricing');
  return <PricingPage />;
}
