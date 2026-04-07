'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { X, Download, Loader2, Palette, Code, Check, AlertTriangle } from 'lucide-react';
import { exportGame, downloadBlob } from '@/lib/export/exportEngine';
import { useEditorStore } from '@/stores/editorStore';
import { EXPORT_PRESETS, getPreset, type ExportFormat } from '@/lib/export/presets';
import { generateResponsiveEmbedSnippet, generateEmbedSnippet } from '@/lib/export/embedGenerator';
import type { LoadingScreenConfig } from '@/lib/export/loadingScreen';
import { COMPRESSION_PRESETS, estimateCompression, type CompressionConfig, type CompressionFormat } from '@/lib/export/textureCompression';
import { showError } from '@/lib/toast';

function parseResolution(res: string): [number, number] {
  const parts = res.split('x');
  return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
}

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExportDialog({ isOpen, onClose }: ExportDialogProps) {
  const sceneName = useEditorStore((s) => s.sceneName);
  const isExporting = useEditorStore((s) => s.isExporting);
  const setExporting = useEditorStore((s) => s.setExporting);

  const [title, setTitle] = useState(sceneName);
  const [mode, setMode] = useState<ExportFormat>('single-html');
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
  const [orientationLock, setOrientationLock] = useState<'none' | 'landscape' | 'portrait'>('none');
  const [compressionPreset, setCompressionPreset] = useState<string>('original');
  const [compressionQuality, setCompressionQuality] = useState(85);
  const [embedSnippet, setEmbedSnippet] = useState<string | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape key + focus trap
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isExporting) {
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isExporting, onClose]);

  // Auto-focus dialog on open
  useEffect(() => {
    if (isOpen && dialogRef.current) {
      requestAnimationFrame(() => {
        dialogRef.current?.focus();
      });
    }
  }, [isOpen]);

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

  const handleCancel = useCallback(() => {
    if (isExporting && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    } else {
      onClose();
    }
  }, [isExporting, onClose]);

  const handleExport = useCallback(async () => {
    if (abortRef.current) return; // Guard against rapid double-click before re-render
    const controller = new AbortController();
    abortRef.current = controller;
    setExporting(true);
    setExportError(null);
    try {
      const preset = selectedPreset ? getPreset(selectedPreset) : undefined;

      // Build texture compression config from selected preset + quality override
      let textureCompressionConfig: CompressionConfig | undefined;
      if (compressionPreset !== 'original') {
        const baseConfig = COMPRESSION_PRESETS[compressionPreset] ?? COMPRESSION_PRESETS.balanced;
        textureCompressionConfig = { ...baseConfig, quality: compressionQuality };
      }

      const blob = await exportGame({
        title,
        mode,
        resolution,
        bgColor,
        includeDebug,
        preset,
        customLoadingScreen: showLoadingCustomization ? loadingConfig : undefined,
        orientationLock: orientationLock === 'none' ? undefined : orientationLock,
        textureCompressionConfig,
        signal: controller.signal,
      });

      // If user cancelled during export, skip download
      if (controller.signal.aborted) return;

      const extension = mode === 'single-html' ? 'html' : 'zip';
      const filename = `${title.replace(/[^a-z0-9_-]/gi, '_')}.${extension}`;
      downloadBlob(blob, filename);

      // Track export event
      try { const { trackGameExported } = await import('@/lib/analytics/events'); trackGameExported(mode); } catch { /* analytics non-critical */ }

      // Show embed snippet for embed mode
      if (mode === 'embed') {
        const snippet = resolution === 'responsive'
          ? generateResponsiveEmbedSnippet(title)
          : generateEmbedSnippet(title, ...parseResolution(resolution));
        setEmbedSnippet(snippet);
      } else {
        onClose();
      }
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        // User cancelled — not an error
        return;
      }
      console.error('[Export] Failed to export game:', err);
      const message = err instanceof Error ? err.message : String(err);
      setExportError(message);
      showError(`Export failed: ${message}`);
    } finally {
      abortRef.current = null;
      setExporting(false);
    }
  }, [title, mode, resolution, bgColor, includeDebug, selectedPreset, showLoadingCustomization, loadingConfig, orientationLock, compressionPreset, compressionQuality, setExporting, onClose]);

  const handleCopySnippet = useCallback(() => {
    if (!embedSnippet) return;
    navigator.clipboard.writeText(embedSnippet).then(() => {
      setSnippetCopied(true);
      setTimeout(() => setSnippetCopied(false), 2000);
    });
  }, [embedSnippet]);

  if (!isOpen) return null;

  // Show embed snippet after successful embed export
  if (embedSnippet) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={(e) => { if (e.target === e.currentTarget) { setEmbedSnippet(null); onClose(); } }}>
        <div role="dialog" aria-labelledby="embed-dialog-title" aria-modal="true" className="w-full max-w-md rounded-lg bg-zinc-900 shadow-xl">
          <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
            <h2 id="embed-dialog-title" className="text-base font-semibold text-zinc-100">Embed Code</h2>
            <button
              onClick={() => { setEmbedSnippet(null); onClose(); }}
              aria-label="Close embed dialog"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              <X size={18} />
            </button>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-zinc-400">
              Game exported! Copy the embed code below to add it to your website:
            </p>
            <pre className="rounded bg-zinc-800 p-3 text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap border border-zinc-700">
              {embedSnippet}
            </pre>
            <button
              onClick={handleCopySnippet}
              className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {snippetCopied ? <><Check size={14} /> Copied!</> : <><Code size={14} /> Copy Embed Code</>}
            </button>
          </div>
          <div className="flex items-center justify-end border-t border-zinc-700 px-4 py-3">
            <button
              onClick={() => { setEmbedSnippet(null); onClose(); }}
              className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="export-dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={(e) => { if (e.target === e.currentTarget && !isExporting) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-labelledby="export-dialog-title" aria-modal="true" tabIndex={-1} className="w-full max-w-md rounded-lg bg-zinc-900 shadow-xl focus:outline-none">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
          <h2 id="export-dialog-title" className="text-base font-semibold text-zinc-100">Export Game</h2>
          <button
            onClick={onClose}
            disabled={isExporting}
            aria-label="Close export dialog"
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
                  <div className="mt-0.5 text-zinc-400">{preset.description}</div>
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
                <span className="text-xs text-zinc-400">(Assets separated)</span>
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
                <span className="text-xs text-zinc-400">(Installable)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={mode === 'embed'}
                  onChange={() => setMode('embed')}
                  disabled={isExporting}
                  className="text-blue-500"
                />
                <span className="text-sm text-zinc-300">Embed (iframe)</span>
                <span className="text-xs text-zinc-400">(For websites)</span>
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

          {/* Orientation Lock — not applicable to embeds (inherits parent orientation) */}
          {mode !== 'embed' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-300">Orientation Lock</label>
              <select
                value={orientationLock}
                onChange={(e) => setOrientationLock(e.target.value as 'none' | 'landscape' | 'portrait')}
                disabled={isExporting}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
              >
                <option value="none">Auto (no lock)</option>
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
              <p className="mt-1 text-xs text-zinc-400">Lock screen orientation on mobile devices</p>
            </div>
          )}

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
            <p className="mt-1 text-xs text-zinc-400">Includes console logs and error messages</p>
          </div>

          {/* Texture Compression */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">Texture Compression</label>
            <select
              value={compressionPreset}
              onChange={(e) => {
                const key = e.target.value;
                setCompressionPreset(key);
                if (key !== 'original' && COMPRESSION_PRESETS[key]) {
                  setCompressionQuality(COMPRESSION_PRESETS[key].quality);
                }
              }}
              disabled={isExporting}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="original">None (original textures)</option>
              <option value="fast_load">Fast Load (WebP, 75%, max 1024px)</option>
              <option value="balanced">Balanced (WebP, 85%, max 2048px)</option>
              <option value="high_quality">High Quality (WebP, 95%, max 4096px)</option>
            </select>
            {compressionPreset !== 'original' && (
              <div className="mt-2 space-y-2 rounded border border-zinc-700 bg-zinc-800/50 p-3">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-300">Quality</label>
                    <span className="text-xs text-zinc-400">{compressionQuality}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={compressionQuality}
                    onChange={(e) => setCompressionQuality(parseInt(e.target.value, 10))}
                    disabled={isExporting}
                    className="mt-1 w-full accent-blue-500"
                  />
                </div>
                <p className="text-xs text-zinc-400">
                  Est. size reduction: ~{Math.round((1 - estimateCompression(1000, COMPRESSION_PRESETS[compressionPreset]?.format as CompressionFormat ?? 'webp', compressionQuality) / 1000) * 100)}%
                </p>
              </div>
            )}
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
              <span className="text-xs text-zinc-400">
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

        {/* Error display */}
        {exportError && (
          <div role="alert" className="mx-4 mb-0 flex items-start gap-2 rounded border border-red-900/50 bg-red-950/20 p-3">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-400" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-red-400">Export failed</p>
              <p className="mt-0.5 text-xs text-red-400/70 break-all line-clamp-3">{exportError}</p>
            </div>
            <button
              onClick={() => setExportError(null)}
              aria-label="Dismiss error"
              className="shrink-0 rounded p-0.5 text-red-400/50 hover:text-red-400"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Title validation hint */}
        {!title.trim() && !isExporting && (
          <div className="mx-4 mb-0 mt-1">
            <p className="text-xs text-amber-500/70">A game title is required to export</p>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-700 px-4 py-3">
          <button
            onClick={handleCancel}
            className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            {isExporting ? 'Cancel Export' : 'Cancel'}
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
