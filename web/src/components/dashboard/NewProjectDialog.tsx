'use client';

import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

interface NewProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<string | null>;
}

export function NewProjectDialog({ isOpen, onClose, onCreate }: NewProjectDialogProps) {
  const [name, setName] = useState('My Game');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    if (creating) return;
    setName('My Game');
    setError(null);
    onClose();
  }, [onClose, creating]);

  const handleSubmit = useCallback(async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const err = await onCreate(name.trim());
      if (err) {
        setError(err);
      }
    } catch (e) {
      // Log error for debugging purposes and show a user-friendly message
      console.error('Failed to create project:', e);
      setError('Failed to create project. Please try again.');
    } finally {
      setCreating(false);
    }
  }, [name, creating, onCreate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
      if (e.key === 'Enter' && name.trim() && !creating) {
        e.preventDefault();
        void handleSubmit();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }
  }, [isOpen, name, creating, handleClose, handleSubmit]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[400px] rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
          <h2 className="font-semibold text-zinc-200">New Project</h2>
          <button
            onClick={handleClose}
            disabled={creating}
            className="text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <label className="mb-2 block text-sm text-zinc-400">
            Project Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={creating}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            autoFocus
            placeholder="My Game"
          />
          {error && (
            <p className="mt-2 text-sm text-red-400">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-zinc-700 px-4 py-3">
          <button
            onClick={handleClose}
            disabled={creating}
            className="rounded px-4 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || creating}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
