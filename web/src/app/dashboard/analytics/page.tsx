import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CreatorAnalyticsPanel } from '@/components/dashboard/CreatorAnalyticsPanel';
import { safeAuth } from '@/lib/auth/safe-auth';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Creator analytics — SpawnForge',
};

/**
 * Creator analytics (#8352). The panel fetches `/api/creator/stats` itself; this
 * server wrapper only guards the page, as `app/dashboard/page.tsx` does.
 */
export default async function CreatorAnalyticsPage() {
  const { userId } = await safeAuth();

  // Defense-in-depth: middleware should redirect unauthenticated users, but
  // bot crawlers sometimes bypass it (SPAWNFORGE-AI-1).
  if (!userId) {
    redirect('/sign-in');
  }

  return <CreatorAnalyticsPanel />;
}
