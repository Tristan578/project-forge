import { safeAuth } from '@/lib/auth/safe-auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
import { AdminDashboard } from '@/components/admin/AdminDashboard';

export default async function AdminEconomicsPage() {
  const { userId } = await safeAuth();
  if (!userId) redirect('/sign-in');

  const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!adminIds.includes(userId)) redirect('/');

  return <AdminDashboard />;
}
