import type { Metadata } from 'next';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';

export const metadata: Metadata = {
  title: 'Dashboard — SpawnForge',
};

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  return <DashboardLayout />;
}
