import type { Metadata } from 'next';
import { PricingPage } from '@/components/pricing/PricingPage';

export const metadata: Metadata = {
  title: 'Pricing — SpawnForge',
};

export default function Pricing() {
  return <PricingPage />;
}
