'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClerk } from '@clerk/nextjs';
import { AlertTriangle } from 'lucide-react';

export function AccountTab() {
  const router = useRouter();
  const { signOut } = useClerk();
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (confirmText !== 'DELETE') return;
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch('/api/user/delete', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Failed to delete account');
        setDeleting(false);
        return;
      }
      // Sign out and redirect to home
      await signOut();
      router.push('/');
    } catch {
      setError('An unexpected error occurred');
      setDeleting(false);
    }
  };

  return (
    <div className="p-6">
      {/* Danger Zone */}
      <div className="rounded-lg border border-red-800/50 bg-red-950/30 p-6">
        <div className="mb-4 flex items-center gap-2 text-red-400">
          <AlertTriangle size={20} />
          <h3 className="text-lg font-semibold">Danger Zone</h3>
        </div>

        <p className="mb-4 text-sm text-zinc-400">
          Permanently delete your account and all associated data. This includes
          your projects, published games, tokens, API keys, community activity,
          and marketplace data. <strong className="text-red-400">This action cannot be undone.</strong>
        </p>

        {!showConfirm ? (
          <button
            onClick={() => setShowConfirm(true)}
            className="rounded border border-red-700 bg-red-900/50 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-900 hover:text-red-200 transition-colors"
          >
            Delete Account
          </button>
        ) : (
          <div className="space-y-3 rounded-lg border border-red-800/50 bg-zinc-900 p-4">
            <p className="text-sm text-zinc-300">
              Type <strong className="font-mono text-red-400">DELETE</strong> to confirm:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type DELETE"
              aria-label="Confirm account deletion by typing DELETE"
              autoFocus
              className="w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-red-500"
            />
            {error && (
              <p role="alert" className="text-xs text-red-400">
                {error} Please try again or contact support if the issue persists.
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                disabled={confirmText !== 'DELETE' || deleting}
                className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? 'Deleting...' : 'Permanently Delete'}
              </button>
              <button
                onClick={() => {
                  setShowConfirm(false);
                  setConfirmText('');
                  setError(null);
                }}
                className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
