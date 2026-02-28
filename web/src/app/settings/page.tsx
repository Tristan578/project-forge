import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { SettingsPage } from '@/components/settings/SettingsPage';

export default async function SettingsRoute() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  return (
    <Suspense fallback={<SettingsLoadingFallback />}>
      <SettingsPage />
    </Suspense>
  );
}

function SettingsLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
      Loading settings...
    </div>
  );
}
