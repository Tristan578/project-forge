'use cache';

import { cacheLife } from 'next/cache';
import { cacheTag } from 'next/cache';
import type { Metadata } from 'next';
import { PricingPage } from '@/components/pricing/PricingPage';

export const metadata: Metadata = {
  title: 'Pricing — SpawnForge',
};

export default function Pricing() {
  cacheLife('days');
  cacheTag('pricing');
  return <PricingPage />;
}
