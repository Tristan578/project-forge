'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { EditorLayout } from '@/components/editor/EditorLayout';

/**
 * Local development editor — bypasses auth and database.
 * Access at: http://localhost:3000/dev
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
