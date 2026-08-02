'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { e2eHooksEnabled } from '@/lib/e2e/testHooks';

const EditorLayout = dynamic(
  () => import('@/components/editor/EditorLayout').then((m) => m.EditorLayout),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-zinc-950">
        <div className="text-zinc-400">Loading editor...</div>
      </div>
    ),
  }
);

/**
 * Local development editor — bypasses auth and database.
 * Access at: https://spawnforge.localhost/dev (with portless, npm run dev)
 *            http://localhost:3000/dev (npm run dev:raw)
 * Renders in local dev and the NEXT_PUBLIC_E2E_HOOKS=true journey-gate build;
 * redirects to /sign-in in normal production builds (flag unset). The gate is
 * the same one that exposes the editor stores, so render + store exposure stay
 * in lockstep — see e2eHooksEnabled().
 */
export default function DevEditorPage() {
  const router = useRouter();

  useEffect(() => {
    if (!e2eHooksEnabled()) {
      router.replace('/sign-in');
    }
  }, [router]);

  if (!e2eHooksEnabled()) {
    return null;
  }

  return <EditorLayout />;
}
