import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { AdminDashboard } from '@/components/admin/AdminDashboard';

export default async function AdminEconomicsPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');
  // In production, check if user is admin. For now, just require auth.
  return <AdminDashboard />;
}
