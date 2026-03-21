'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { X, Upload, Grid, Image as ImageIcon } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import {
  loadImageFile,
  detectGridDimensions,
  sliceSheet,
  generateDefaultClips,
  buildSpriteSheetData,
  drawGridOverlay,
  renderFrame,
} from '@/lib/sprites/sheetImporter';
import type { SpriteSheetImportResult } from '@/lib/sprites/sheetImporter';
import type { FrameRect } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SpriteSheetImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SpriteSheetImportDialog({ isOpen, onClose }: SpriteSheetImportDialogProps) {
  const primaryId = useEditorStore((s) => s.primaryId);
  const setSpriteSheet = useEditorStore((s) => s.setSpriteSheet);

  // Image state
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageWidth, setImageWidth] = useState(0);
  const [imageHeight, setImageHeight] = useState(0);
  const [fileName, setFileName] = useState('');

  // Grid state
  const [rows, setRows] = useState(1);
  const [cols, setCols] = useState(1);
  const [frames, setFrames] = useState<FrameRect[]>([]);

  // UI state
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null);

  // Canvas refs
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const frameStripRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // -----------------------------------------------------------------------
  // Reset when dialog closes / re-opens
  // -----------------------------------------------------------------------
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setImage(null);
      setImageWidth(0);
      setImageHeight(0);
      setFileName('');
      setRows(1);
      setCols(1);
      setFrames([]);
      setError(null);
      setSelectedFrameIndex(null);
    }
  }

  // -----------------------------------------------------------------------
  // Recompute frames when rows/cols change
  // -----------------------------------------------------------------------
  const recomputeFrames = useCallback((w: number, h: number, r: number, c: number) => {
    const newFrames = sliceSheet(w, h, r, c);
    setFrames(newFrames);
    setSelectedFrameIndex(null);
  }, []);

  // -----------------------------------------------------------------------
  // Canvas preview rendering
  // -----------------------------------------------------------------------
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !image) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fit image into a max 400x400 preview area
    const maxSize = 400;
    const scale = Math.min(maxSize / image.naturalWidth, maxSize / image.naturalHeight, 1);
    const displayW = Math.round(image.naturalWidth * scale);
    const displayH = Math.round(image.naturalHeight * scale);

    canvas.width = displayW;
    canvas.height = displayH;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, displayW, displayH);
    ctx.drawImage(image, 0, 0, displayW, displayH);

    // Draw grid overlay
    drawGridOverlay(ctx, displayW, displayH, rows, cols);

    // Highlight selected frame
    if (selectedFrameIndex !== null && selectedFrameIndex < frames.length) {
      const frame = frames[selectedFrameIndex];
      const fx = (frame.x / image.naturalWidth) * displayW;
      const fy = (frame.y / image.naturalHeight) * displayH;
      const fw = (frame.width / image.naturalWidth) * displayW;
      const fh = (frame.height / image.naturalHeight) * displayH;

      ctx.strokeStyle = 'rgba(255, 200, 0, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(fx + 1, fy + 1, fw - 2, fh - 2);
    }
  }, [image, rows, cols, selectedFrameIndex, frames]);

  // -----------------------------------------------------------------------
  // File handling
  // -----------------------------------------------------------------------
  const processFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const img = await loadImageFile(file);
      const w = img.naturalWidth;
      const h = img.naturalHeight;

      setImage(img);
      setImageWidth(w);
      setImageHeight(h);
      setFileName(file.name);

      const grid = detectGridDimensions(w, h);
      setRows(grid.rows);
      setCols(grid.columns);
      recomputeFrames(w, h, grid.rows, grid.columns);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load image.');
    }
  }, [recomputeFrames]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  // -----------------------------------------------------------------------
  // Grid input changes
  // -----------------------------------------------------------------------
  const handleRowsChange = useCallback((value: number) => {
    const clamped = Math.max(1, Math.min(value, 64));
    setRows(clamped);
    if (image) recomputeFrames(imageWidth, imageHeight, clamped, cols);
  }, [image, imageWidth, imageHeight, cols, recomputeFrames]);

  const handleColsChange = useCallback((value: number) => {
    const clamped = Math.max(1, Math.min(value, 64));
    setCols(clamped);
    if (image) recomputeFrames(imageWidth, imageHeight, rows, clamped);
  }, [image, imageWidth, imageHeight, rows, recomputeFrames]);

  // -----------------------------------------------------------------------
  // Import action
  // -----------------------------------------------------------------------
  const handleImport = useCallback(() => {
    if (!image || !primaryId) return;

    const assetId = `spritesheet_${Date.now()}`;
    const importResult: SpriteSheetImportResult = {
      image,
      width: imageWidth,
      height: imageHeight,
      grid: {
        columns: cols,
        rows,
        frameWidth: Math.floor(imageWidth / cols),
        frameHeight: Math.floor(imageHeight / rows),
      },
      frames,
    };

    const sheetData = buildSpriteSheetData(assetId, importResult, fileName.replace(/\.[^.]+$/, ''));
    setSpriteSheet(primaryId, sheetData);
    onClose();
  }, [image, primaryId, imageWidth, imageHeight, cols, rows, frames, fileName, setSpriteSheet, onClose]);

  // -----------------------------------------------------------------------
  // Frame strip rendering
  // -----------------------------------------------------------------------
  const renderFrameThumbnail = useCallback((frame: FrameRect): string | null => {
    if (!image) return null;
    const canvas = renderFrame(image, frame, 1);
    return canvas.toDataURL();
  }, [image]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  if (!isOpen) return null;

  const totalFrames = rows * cols;
  const frameWidth = imageWidth > 0 ? Math.floor(imageWidth / cols) : 0;
  const frameHeight = imageHeight > 0 ? Math.floor(imageHeight / rows) : 0;
  const clips = frames.length > 0 ? generateDefaultClips(frames, fileName) : {};
  const clipCount = Object.keys(clips).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-2xl rounded-lg bg-zinc-900 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
          <h2 className="text-base font-semibold text-zinc-100">Import Sprite Sheet</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[75vh] space-y-4 overflow-y-auto p-4">

          {/* Drop zone / file select */}
          {!image && (
            <div
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
                isDragging
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <Upload size={32} className="mb-3 text-zinc-400" />
              <p className="mb-1 text-sm text-zinc-300">
                Drop a sprite sheet image here
              </p>
              <p className="mb-3 text-xs text-zinc-400">PNG, JPG, or WebP</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                Browse Files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="rounded bg-red-900/50 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          {/* Image loaded: preview + controls */}
          {image && (
            <>
              {/* Image info bar */}
              <div className="flex items-center gap-3 rounded bg-zinc-800 px-3 py-2">
                <ImageIcon size={14} className="text-zinc-400" />
                <span className="text-xs text-zinc-300">{fileName}</span>
                <span className="text-xs text-zinc-400">
                  {imageWidth} x {imageHeight} px
                </span>
                <button
                  onClick={() => {
                    setImage(null);
                    setFileName('');
                    setFrames([]);
                    setError(null);
                  }}
                  className="ml-auto text-xs text-zinc-400 hover:text-zinc-300"
                >
                  Change
                </button>
              </div>

              {/* Preview canvas + grid controls side by side */}
              <div className="flex gap-4">
                {/* Canvas preview */}
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                    Preview
                  </label>
                  <div className="flex items-center justify-center rounded border border-zinc-700 bg-zinc-950 p-2">
                    <canvas
                      ref={previewCanvasRef}
                      className="max-w-full"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </div>
                </div>

                {/* Grid controls */}
                <div className="w-48 shrink-0 space-y-3">
                  <div>
                    <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
                      <Grid size={12} /> Grid Configuration
                    </label>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-zinc-400">Columns</label>
                    <input
                      type="number"
                      min={1}
                      max={64}
                      value={cols}
                      onChange={(e) => handleColsChange(parseInt(e.target.value) || 1)}
                      className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-zinc-400">Rows</label>
                    <input
                      type="number"
                      min={1}
                      max={64}
                      value={rows}
                      onChange={(e) => handleRowsChange(parseInt(e.target.value) || 1)}
                      className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* Computed info */}
                  <div className="space-y-1 rounded bg-zinc-800 px-2 py-2 text-xs text-zinc-400">
                    <div>Total Frames: <span className="text-zinc-200">{totalFrames}</span></div>
                    <div>Frame Size: <span className="text-zinc-200">{frameWidth} x {frameHeight}</span></div>
                    <div>Auto Clips: <span className="text-zinc-200">{clipCount}</span></div>
                    {clipCount > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {Object.entries(clips).map(([name, clip]) => (
                          <div key={name} className="text-zinc-400">
                            {name}: frames {clip.frames[0]}-{clip.frames[clip.frames.length - 1]}
                            {clip.looping ? ' (loop)' : ''}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Frame strip */}
              {frames.length > 0 && frames.length <= 128 && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                    Frames ({frames.length})
                  </label>
                  <div
                    ref={frameStripRef}
                    className="flex gap-1 overflow-x-auto rounded border border-zinc-700 bg-zinc-950 p-2"
                  >
                    {frames.map((frame) => {
                      const dataUrl = renderFrameThumbnail(frame);
                      if (!dataUrl) return null;

                      return (
                        <button
                          key={frame.index}
                          onClick={() => setSelectedFrameIndex(
                            selectedFrameIndex === frame.index ? null : frame.index
                          )}
                          className={`flex shrink-0 flex-col items-center rounded p-1 transition-colors ${
                            selectedFrameIndex === frame.index
                              ? 'bg-blue-600/30 ring-1 ring-blue-500'
                              : 'hover:bg-zinc-800'
                          }`}
                          title={`Frame ${frame.index}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={dataUrl}
                            alt={`Frame ${frame.index}`}
                            className="h-12 w-12 object-contain"
                            style={{ imageRendering: 'pixelated' }}
                          />
                          <span className="mt-0.5 text-[10px] text-zinc-400">{frame.index}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {frames.length > 128 && (
                <div className="rounded bg-zinc-800 px-3 py-2 text-xs text-zinc-400">
                  {frames.length} frames detected. Frame preview hidden for performance.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-700 px-4 py-3">
          <p className="text-xs text-zinc-400">
            {!primaryId && 'Select an entity to import to.'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={!image || !primaryId || frames.length === 0}
              className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Import ({totalFrames} frames)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
