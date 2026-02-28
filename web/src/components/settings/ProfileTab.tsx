'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { useUserStore } from '@/stores/userStore';
import { Check, Pencil, X } from 'lucide-react';

export function ProfileTab() {
  const { user: clerkUser } = useUser();
  const displayName = useUserStore((s) => s.displayName);
  const email = useUserStore((s) => s.email);
  const tier = useUserStore((s) => s.tier);
  const createdAt = useUserStore((s) => s.createdAt);
  const updateDisplayName = useUserStore((s) => s.updateDisplayName);
  const fetchProfile = useUserStore((s) => s.fetchProfile);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleEdit = () => {
    setDraft(displayName ?? '');
    setSaveError(null);
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    const ok = await updateDisplayName(draft);
    setSaving(false);
    if (ok) {
      setEditing(false);
    } else {
      setSaveError('Failed to save. Check your name is 1-50 characters.');
    }
  };

  const getTierColor = (t: string) => {
    switch (t) {
      case 'hobbyist': return 'bg-blue-600';
      case 'creator': return 'bg-purple-600';
      case 'pro': return 'bg-yellow-600';
      default: return 'bg-zinc-600';
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Avatar */}
      <div className="flex items-center gap-4">
        {clerkUser?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={clerkUser.imageUrl}
            alt="Profile avatar"
            className="h-16 w-16 rounded-full border-2 border-zinc-600"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-700 text-2xl font-bold text-zinc-300">
            {(displayName ?? email ?? '?').charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <p className="text-sm text-zinc-500">
            Avatar managed by your Clerk account
          </p>
        </div>
      </div>

      {/* Display Name */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <label className="mb-2 block text-sm font-semibold text-zinc-200">
          Display Name
        </label>
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={50}
              autoFocus
              className="flex-1 rounded border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') handleCancel();
              }}
            />
            <button
              onClick={handleSave}
              disabled={saving || draft.trim().length === 0}
              className="rounded bg-blue-600 p-1.5 text-white hover:bg-blue-500 disabled:opacity-50"
              aria-label="Save"
            >
              <Check size={14} />
            </button>
            <button
              onClick={handleCancel}
              className="rounded bg-zinc-700 p-1.5 text-zinc-300 hover:bg-zinc-600"
              aria-label="Cancel"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-300">
              {displayName || <span className="italic text-zinc-500">Not set</span>}
            </span>
            <button
              onClick={handleEdit}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            >
              <Pencil size={12} />
              Edit
            </button>
          </div>
        )}
        {saveError && (
          <p className="mt-2 text-xs text-red-400">{saveError}</p>
        )}
        <p className="mt-1 text-xs text-zinc-500">
          {draft.length > 0 && editing ? `${draft.length}/50` : '50 characters max'}
        </p>
      </div>

      {/* Email (read-only) */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <label className="mb-2 block text-sm font-semibold text-zinc-200">
          Email
        </label>
        <span className="text-sm text-zinc-400">
          {email ?? 'Loading...'}
        </span>
      </div>

      {/* Tier */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <label className="mb-2 block text-sm font-semibold text-zinc-200">
          Plan
        </label>
        <span className={`inline-block rounded px-2.5 py-1 text-xs font-semibold uppercase text-white ${getTierColor(tier)}`}>
          {tier}
        </span>
      </div>

      {/* Member Since */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <label className="mb-2 block text-sm font-semibold text-zinc-200">
          Member Since
        </label>
        <span className="text-sm text-zinc-400">
          {formatDate(createdAt)}
        </span>
      </div>
    </div>
  );
}
