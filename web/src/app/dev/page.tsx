'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const EditorLayout = dynamic(
  () => import('@/components/editor/EditorLayout').then((m) => m.EditorLayout),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="text-zinc-400">Loading editor...</div>
      </div>
    ),
  }
);

/**
 * Local development editor — bypasses auth and database.
 * Access at: https://spawnforge.localhost/dev (with portless, npm run dev)
 *            http://localhost:3000/dev (npm run dev:raw)
 * Redirects to /sign-in in production builds.
 */
export default function DevEditorPage() {
  const router = useRouter();

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') {
      router.replace('/sign-in');
    }
  }, [router]);

  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  return <EditorLayout />;
}
