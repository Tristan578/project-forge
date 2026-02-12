'use client';

import { useState } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import { exportGame, downloadBlob } from '@/lib/export/exportEngine';
import { useEditorStore } from '@/stores/editorStore';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExportDialog({ isOpen, onClose }: ExportDialogProps) {
  const sceneName = useEditorStore((s) => s.sceneName);
  const isExporting = useEditorStore((s) => s.isExporting);
  const setExporting = useEditorStore((s) => s.setExporting);

  const [title, setTitle] = useState(sceneName);
  const [mode, setMode] = useState<'single-html' | 'zip'>('single-html');
  const [resolution, setResolution] = useState<'responsive' | '1920x1080' | '1280x720'>('responsive');
  const [bgColor, setBgColor] = useState('#18181b');
  const [includeDebug, setIncludeDebug] = useState(false);

  // Sync title with scene name when dialog opens
  useState(() => {
    setTitle(sceneName);
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportGame({
        title,
        mode,
        resolution,
        bgColor,
        includeDebug,
      });

      const filename = `${title.replace(/[^a-z0-9_-]/gi, '_')}.html`;
      downloadBlob(blob, filename);

      onClose();
    } catch (err) {
      console.error('[Export] Failed to export game:', err);
      alert('Export failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md rounded-lg bg-zinc-900 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
          <h2 className="text-base font-semibold text-zinc-100">Export Game</h2>
          <button
            onClick={onClose}
            disabled={isExporting}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 p-4">
          {/* Title */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">Game Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isExporting}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
              placeholder="Enter game title"
            />
          </div>

          {/* Export Mode */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">Export Mode</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={mode === 'single-html'}
                  onChange={() => setMode('single-html')}
                  disabled={isExporting}
                  className="text-blue-500"
                />
                <span className="text-sm text-zinc-300">Single HTML File</span>
              </label>
              <label className="flex items-center gap-2 opacity-50">
                <input
                  type="radio"
                  checked={mode === 'zip'}
                  onChange={() => setMode('zip')}
                  disabled
                  className="text-blue-500"
                />
                <span className="text-sm text-zinc-300">Zip Bundle</span>
                <span className="text-xs text-zinc-500">(Coming soon)</span>
              </label>
            </div>
          </div>

          {/* Resolution */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">Resolution</label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value as any)}
              disabled={isExporting}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="responsive">Responsive (Fill Window)</option>
              <option value="1920x1080">1920x1080</option>
              <option value="1280x720">1280x720</option>
            </select>
          </div>

          {/* Background Color */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">Background Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                disabled={isExporting}
                className="h-8 w-16 cursor-pointer rounded border border-zinc-700 bg-zinc-800 disabled:opacity-50"
              />
              <input
                type="text"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                disabled={isExporting}
                className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
                placeholder="#18181b"
              />
            </div>
          </div>

          {/* Include Debug Info */}
          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeDebug}
                onChange={(e) => setIncludeDebug(e.target.checked)}
                disabled={isExporting}
                className="rounded text-blue-500"
              />
              <span className="text-sm text-zinc-300">Include Debug Info</span>
            </label>
            <p className="mt-1 text-xs text-zinc-500">Includes console logs and error messages</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-700 px-4 py-3">
          <button
            onClick={onClose}
            disabled={isExporting}
            className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || !title.trim()}
            className="flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isExporting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download size={14} />
                Export
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
