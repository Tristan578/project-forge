'use client';

import { useState, useCallback } from 'react';
import { X, Download, Loader2, Palette } from 'lucide-react';
import { exportGame, downloadBlob } from '@/lib/export/exportEngine';
import { useEditorStore } from '@/stores/editorStore';
import { EXPORT_PRESETS, getPreset } from '@/lib/export/presets';
import type { LoadingScreenConfig } from '@/lib/export/loadingScreen';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExportDialog({ isOpen, onClose }: ExportDialogProps) {
  const sceneName = useEditorStore((s) => s.sceneName);
  const isExporting = useEditorStore((s) => s.isExporting);
  const setExporting = useEditorStore((s) => s.setExporting);

  const [title, setTitle] = useState(sceneName);
  const [mode, setMode] = useState<'single-html' | 'zip' | 'pwa'>('single-html');
  const [resolution, setResolution] = useState<'responsive' | '1920x1080' | '1280x720'>('responsive');
  const [bgColor, setBgColor] = useState('#18181b');
  const [includeDebug, setIncludeDebug] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [showLoadingCustomization, setShowLoadingCustomization] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState<LoadingScreenConfig>({
    backgroundColor: '#1a1a1a',
    progressBarColor: '#6366f1',
    progressStyle: 'bar',
  });

  // Sync title with scene name when it changes (React-documented pattern)
  const [prevSceneName, setPrevSceneName] = useState(sceneName);
  if (prevSceneName !== sceneName) {
    setPrevSceneName(sceneName);
    setTitle(sceneName);
  }

  const applyPreset = useCallback((presetName: string) => {
    const preset = getPreset(presetName);
    if (!preset) return;

    setMode(preset.format);
    setResolution(preset.resolution);
    setBgColor(preset.loadingScreen.backgroundColor);
    setIncludeDebug(preset.includeDebug);
    setLoadingConfig(preset.loadingScreen);
    setSelectedPreset(presetName);
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const preset = selectedPreset ? getPreset(selectedPreset) : undefined;

      const blob = await exportGame({
        title,
        mode,
        resolution,
        bgColor,
        includeDebug,
        preset,
        customLoadingScreen: showLoadingCustomization ? loadingConfig : undefined,
      });

      const extension = mode === 'single-html' ? 'html' : 'zip';
      const filename = `${title.replace(/[^a-z0-9_-]/gi, '_')}.${extension}`;
      downloadBlob(blob, filename);

      onClose();
    } catch (err) {
      console.error('[Export] Failed to export game:', err);
      alert('Export failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setExporting(false);
    }
  }, [title, mode, resolution, bgColor, includeDebug, selectedPreset, showLoadingCustomization, loadingConfig, setExporting, onClose]);

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
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          {/* Export Presets */}
          <div>
            <label className="mb-2 block text-xs font-medium text-zinc-300">Quick Presets</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(EXPORT_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => applyPreset(key)}
                  disabled={isExporting}
                  className={`rounded border px-2 py-1.5 text-left text-xs transition-colors disabled:opacity-50 ${
                    selectedPreset === key
                      ? 'border-blue-500 bg-blue-500/20 text-blue-200'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600'
                  }`}
                >
                  <div className="font-medium">{preset.name}</div>
                  <div className="mt-0.5 text-zinc-500">{preset.description}</div>
                </button>
              ))}
            </div>
          </div>

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
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={mode === 'zip'}
                  onChange={() => setMode('zip')}
                  disabled={isExporting}
                  className="text-blue-500"
                />
                <span className="text-sm text-zinc-300">ZIP Bundle</span>
                <span className="text-xs text-zinc-500">(Assets separated)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={mode === 'pwa'}
                  onChange={() => setMode('pwa')}
                  disabled={isExporting}
                  className="text-blue-500"
                />
                <span className="text-sm text-zinc-300">PWA (Progressive Web App)</span>
                <span className="text-xs text-zinc-500">(Installable)</span>
              </label>
            </div>
          </div>

          {/* Resolution */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">Resolution</label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value as 'responsive' | '1920x1080' | '1280x720')}
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

          {/* Loading Screen Customization */}
          <div>
            <button
              onClick={() => setShowLoadingCustomization(!showLoadingCustomization)}
              disabled={isExporting}
              className="mb-2 flex w-full items-center justify-between rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-600 disabled:opacity-50"
            >
              <span className="flex items-center gap-2">
                <Palette size={16} />
                Customize Loading Screen
              </span>
              <span className="text-xs text-zinc-500">
                {showLoadingCustomization ? 'Hide' : 'Show'}
              </span>
            </button>

            {showLoadingCustomization && (
              <div className="space-y-3 rounded border border-zinc-700 bg-zinc-800/50 p-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-300">Progress Style</label>
                  <select
                    value={loadingConfig.progressStyle}
                    onChange={(e) => setLoadingConfig({ ...loadingConfig, progressStyle: e.target.value as LoadingScreenConfig['progressStyle'] })}
                    disabled={isExporting}
                    className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
                  >
                    <option value="bar">Progress Bar</option>
                    <option value="spinner">Spinner</option>
                    <option value="dots">Animated Dots</option>
                    <option value="none">None</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-300">Loading Title</label>
                  <input
                    type="text"
                    value={loadingConfig.title || ''}
                    onChange={(e) => setLoadingConfig({ ...loadingConfig, title: e.target.value || undefined })}
                    disabled={isExporting}
                    placeholder="Optional"
                    className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-300">Loading Subtitle</label>
                  <input
                    type="text"
                    value={loadingConfig.subtitle || ''}
                    onChange={(e) => setLoadingConfig({ ...loadingConfig, subtitle: e.target.value || undefined })}
                    disabled={isExporting}
                    placeholder="Optional"
                    className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-300">Background</label>
                    <input
                      type="color"
                      value={loadingConfig.backgroundColor}
                      onChange={(e) => setLoadingConfig({ ...loadingConfig, backgroundColor: e.target.value })}
                      disabled={isExporting}
                      className="h-8 w-full cursor-pointer rounded border border-zinc-700 bg-zinc-800 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-300">Progress Color</label>
                    <input
                      type="color"
                      value={loadingConfig.progressBarColor}
                      onChange={(e) => setLoadingConfig({ ...loadingConfig, progressBarColor: e.target.value })}
                      disabled={isExporting}
                      className="h-8 w-full cursor-pointer rounded border border-zinc-700 bg-zinc-800 disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>
            )}
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
