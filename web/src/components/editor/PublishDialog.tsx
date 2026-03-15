'use client';

import { useState, useCallback } from 'react';
import { X, Globe, Loader2, Check, AlertCircle, Copy, Tag } from 'lucide-react';
import { usePublishStore } from '@/stores/publishStore';
import { useEditorStore } from '@/stores/editorStore';
import { captureCanvasThumbnail } from '@/lib/thumbnail/captureCanvas';

interface PublishDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PublishDialog({ isOpen, onClose }: PublishDialogProps) {
  const sceneName = useEditorStore((s) => s.sceneName);
  const projectId = useEditorStore((s) => s.projectId);

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isPublishing = usePublishStore((s) => s.isPublishing);
  const publishError = usePublishStore((s) => s.publishError);
  const publishGame = usePublishStore((s) => s.publishGame);
  const checkSlug = usePublishStore((s) => s.checkSlug);

  // Initialize from scene name using prev-value pattern
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen && sceneName) {
      setTitle(sceneName);
      setSlug(sceneName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-game');
      setTags([]);
      setTagInput('');
      setPublishedUrl(null);
      setCopied(false);
    }
  }

  const handleSlugChange = useCallback(async (value: string) => {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setSlug(cleaned);
    setSlugAvailable(null);
    if (cleaned.length >= 3) {
      const available = await checkSlug(cleaned);
      setSlugAvailable(available);
    }
  }, [checkSlug]);

  const handleAddTag = useCallback(() => {
    const cleaned = tagInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (cleaned && tags.length < 5 && !tags.includes(cleaned)) {
      setTags((prev) => [...prev, cleaned]);
    }
    setTagInput('');
  }, [tagInput, tags]);

  const handleRemoveTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const handleCopyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
    }
  }, []);

  const handlePublish = useCallback(async () => {
    if (!projectId || !title || !slug) return;
    const thumbnail = await captureCanvasThumbnail('game-canvas');
    const result = await publishGame(projectId, title, slug, description, tags, thumbnail);
    if (result) {
      setPublishedUrl(result.url);
    }
  }, [projectId, title, slug, description, tags, publishGame]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-200">
            <Globe size={20} />
            Publish Game
          </h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:text-zinc-300">
            <X size={18} />
          </button>
        </div>

        {publishedUrl ? (
          // Success state
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-green-900/30 p-4 text-green-400">
              <Check size={20} />
              <span>Game published successfully!</span>
            </div>
            <div className="rounded bg-zinc-800 p-3">
              <p className="mb-1 text-xs text-zinc-500">Share this URL:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm text-blue-400 break-all">{window.location.origin}{publishedUrl}</code>
                <button
                  onClick={() => handleCopyUrl(`${window.location.origin}${publishedUrl}`)}
                  className="shrink-0 rounded p-1.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                  title="Copy URL"
                >
                  {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
            <button onClick={onClose}
              className="w-full rounded bg-zinc-700 py-2 text-sm text-zinc-300 hover:bg-zinc-600">
              Close
            </button>
          </div>
        ) : (
          // Form
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Title</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 focus:border-blue-500 focus:outline-none"
                placeholder="My Awesome Game" />
            </div>

            <div>
              <label className="mb-1 block text-xs text-zinc-400">URL Slug</label>
              <div className="flex items-center gap-2">
                <input type="text" value={slug} onChange={(e) => handleSlugChange(e.target.value)}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 focus:border-blue-500 focus:outline-none"
                  placeholder="my-awesome-game" />
                {slugAvailable === true && <Check size={16} className="text-green-400" />}
                {slugAvailable === false && <AlertCircle size={16} className="text-red-400" />}
              </div>
              <p className="mt-1 text-[10px] text-zinc-600">
                3-50 characters, lowercase letters, numbers, and hyphens
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs text-zinc-400">Description (optional)</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 focus:border-blue-500 focus:outline-none"
                rows={2} placeholder="A brief description of your game" />
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1 text-xs text-zinc-400">
                <Tag size={12} />
                Tags (up to 5)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 focus:border-blue-500 focus:outline-none"
                  placeholder="e.g. platformer, puzzle"
                  disabled={tags.length >= 5}
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  disabled={!tagInput.trim() || tags.length >= 5}
                  className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-40"
                >
                  Add
                </button>
              </div>
              {tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <span key={tag} className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                      {tag}
                      <button onClick={() => handleRemoveTag(tag)} className="text-zinc-500 hover:text-zinc-300">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {publishError && (
              <div className="rounded bg-red-900/30 p-2 text-xs text-red-400">
                {publishError}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={onClose}
                className="flex-1 rounded border border-zinc-700 py-2 text-sm text-zinc-400 hover:bg-zinc-800">
                Cancel
              </button>
              <button onClick={handlePublish}
                disabled={isPublishing || !title || slug.length < 3 || slugAvailable === false}
                className="flex flex-1 items-center justify-center gap-2 rounded bg-blue-600 py-2 text-sm text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
                {isPublishing ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
                {isPublishing ? 'Publishing...' : 'Publish'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
