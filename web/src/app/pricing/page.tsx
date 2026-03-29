import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { PricingPage } from '@/components/pricing/PricingPage';

export const metadata: Metadata = {
  title: 'Pricing — SpawnForge',
};

export default async function Pricing() {
  'use cache';
  cacheLife('days');
  cacheTag('pricing');
  return <PricingPage />;
}
