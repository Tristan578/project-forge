import { Suspense } from 'react';
import { cacheLife, cacheTag } from 'next/cache';
import { DocsPage } from '@/components/docs/DocsPage';

export const metadata = {
  title: 'Documentation - SpawnForge',
  description: 'Learn how to build games with SpawnForge — guides, tutorials, and API reference.',
};

export default async function DocsRoute() {
  'use cache';
  cacheLife('days');
  cacheTag('docs');
  return (
    <Suspense fallback={<DocsLoadingFallback />}>
      <DocsPage />
    </Suspense>
  );
}

function DocsLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
      Loading documentation...
    </div>
  );
}
