'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { GitFork, Loader2 } from 'lucide-react';

interface RemixButtonProps {
  userId: string;
  slug: string;
  isAuthenticated: boolean;
}

export function RemixButton({ userId, slug, isAuthenticated }: RemixButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRemix = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/play/${encodeURIComponent(userId)}/${encodeURIComponent(slug)}/remix`, {
        method: 'POST',
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to remix');
        setLoading(false);
        return;
      }

      // Redirect to the editor with the new project
      router.push(`/editor?project=${data.projectId}`);
    } catch {
      setError('Network error');
      setLoading(false);
    }
  }, [userId, slug, router]);

  if (!isAuthenticated) {
    return (
      <a
        href={`/sign-in?redirect_url=/play/${encodeURIComponent(userId)}/${encodeURIComponent(slug)}`}
        className="flex items-center gap-1.5 rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
      >
        <GitFork size={14} />
        Sign up to remix
      </a>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleRemix}
        disabled={loading}
        className="flex items-center gap-1.5 rounded bg-orange-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-orange-500 disabled:opacity-50"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <GitFork size={14} />}
        Remix
      </button>
      {error && (
        <span className="text-xs text-red-400">{error}</span>
      )}
    </div>
  );
}
