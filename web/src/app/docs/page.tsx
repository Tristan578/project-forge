import { Suspense } from 'react';
import { DocsPage } from '@/components/docs/DocsPage';

export const metadata = {
  title: 'Documentation - GenForge',
  description: 'Learn how to build games with GenForge — guides, tutorials, and API reference.',
};

export default function DocsRoute() {
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
