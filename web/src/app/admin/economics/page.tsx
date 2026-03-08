import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { AdminDashboard } from '@/components/admin/AdminDashboard';

export default async function AdminEconomicsPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!adminIds.includes(userId)) redirect('/');

  return <AdminDashboard />;
}
