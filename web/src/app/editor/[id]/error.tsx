'use client';
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function EditorError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-zinc-200 p-8">
      <h1 className="text-2xl font-bold mb-4">Editor Error</h1>
      <p className="text-zinc-400 mb-6">Something went wrong. Your scene was auto-saved.</p>
      <button onClick={reset} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white">
        Reload Editor
      </button>
    </div>
  );
}
