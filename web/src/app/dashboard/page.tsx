import type { Metadata } from 'next';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';

export const metadata: Metadata = {
  title: 'Dashboard — SpawnForge',
};

export default function DashboardPage() {
  return <DashboardLayout />;
}
