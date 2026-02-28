'use client';

import { useState, useRef, useCallback, useEffect, memo } from 'react';
import {
  Pencil,
  Eraser,
  PaintBucket,
  Pipette,
  Square,
  Minus,
  Undo2,
  Redo2,
  Download,
  ZoomIn,
  ZoomOut,
  Trash2,
  X,
  Grid3X3,
} from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';

/* ─── Types ──────────────────────────────────────────────────────────────── */

type Tool = 'pencil' | 'eraser' | 'fill' | 'line' | 'rect' | 'eyedropper';

interface PixelArtEditorProps {
  open: boolean;
  onClose: () => void;
  /** Entity to apply the texture to. If null, export-only mode. */
  entityId?: string | null;
}

type RGBA = [number, number, number, number];

/* ─── Constants ──────────────────────────────────────────────────────────── */

const CANVAS_SIZES = [8, 16, 32, 64] as const;
type CanvasSize = (typeof CANVAS_SIZES)[number];

const DEFAULT_PALETTE: string[] = [
  '#000000', '#1d2b53', '#7e2553', '#008751',
  '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
  '#ff004d', '#ffa300', '#ffec27', '#00e436',
  '#29adff', '#83769c', '#ff77a8', '#ffccaa',
];

const TRANSPARENT: RGBA = [0, 0, 0, 0];

const MAX_HISTORY = 50;

/* ─── Pixel Grid Helpers ─────────────────────────────────────────────────── */

function createGrid(size: number): RGBA[][] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => [...TRANSPARENT] as RGBA)
  );
}

function cloneGrid(grid: RGBA[][]): RGBA[][] {
  return grid.map((row) => row.map((px) => [...px] as RGBA));
}

function hexToRgba(hex: string, alpha = 255): RGBA {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, alpha];
}

function rgbaToHex(c: RGBA): string {
  return `#${c[0].toString(16).padStart(2, '0')}${c[1].toString(16).padStart(2, '0')}${c[2].toString(16).padStart(2, '0')}`;
}

function colorsEqual(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** Flood fill from (x,y) replacing targetColor with fillColor. */
function floodFill(grid: RGBA[][], x: number, y: number, fillColor: RGBA): RGBA[][] {
  const newGrid = cloneGrid(grid);
  const size = newGrid.length;
  const target = [...newGrid[y][x]] as RGBA;
  if (colorsEqual(target, fillColor)) return newGrid;

  const stack: [number, number][] = [[x, y]];
  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!;
    if (cx < 0 || cx >= size || cy < 0 || cy >= size) continue;
    if (!colorsEqual(newGrid[cy][cx], target)) continue;
    newGrid[cy][cx] = [...fillColor];
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  return newGrid;
}

/** Bresenham line from (x0,y0) to (x1,y1). */
function bresenhamLine(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const points: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0, cy = y0;
  for (;;) {
    points.push([cx, cy]);
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; cy += sy; }
  }
  return points;
}

/** Generate PNG data URL from pixel grid. */
function gridToDataUrl(grid: RGBA[][]): string {
  const size = grid.length;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      imageData.data[i] = grid[y][x][0];
      imageData.data[i + 1] = grid[y][x][1];
      imageData.data[i + 2] = grid[y][x][2];
      imageData.data[i + 3] = grid[y][x][3];
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export const PixelArtEditor = memo(function PixelArtEditor({
  open,
  onClose,
  entityId,
}: PixelArtEditorProps) {
  const loadTexture = useEditorStore((s) => s.loadTexture);

  // Canvas state
  const [canvasSize, setCanvasSize] = useState<CanvasSize>(16);
  const [grid, setGrid] = useState<RGBA[][]>(() => createGrid(16));
  const [zoom, setZoom] = useState(16);
  const [showGrid, setShowGrid] = useState(true);

  // Tool state
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState('#000000');
  const [customPalette, setCustomPalette] = useState<string[]>([...DEFAULT_PALETTE]);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [lineStart, setLineStart] = useState<[number, number] | null>(null);
  const [previewGrid, setPreviewGrid] = useState<RGBA[][] | null>(null);

  // History
  const [undoStack, setUndoStack] = useState<RGBA[][][]>([]);
  const [redoStack, setRedoStack] = useState<RGBA[][][]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Push to undo stack
  const pushHistory = useCallback((currentGrid: RGBA[][]) => {
    setUndoStack((prev) => {
      const next = [...prev, cloneGrid(currentGrid)];
      if (next.length > MAX_HISTORY) next.shift();
      return next;
    });
    setRedoStack([]);
  }, []);

  // Undo
  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const newStack = [...prev];
      const last = newStack.pop()!;
      setRedoStack((r) => [...r, cloneGrid(grid)]);
      setGrid(last);
      return newStack;
    });
  }, [grid]);

  // Redo
  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const newStack = [...prev];
      const last = newStack.pop()!;
      setUndoStack((u) => [...u, cloneGrid(grid)]);
      setGrid(last);
      return newStack;
    });
  }, [grid]);

  // Resize canvas
  const handleResize = useCallback((newSize: CanvasSize) => {
    pushHistory(grid);
    setCanvasSize(newSize);
    setGrid(createGrid(newSize));
    setZoom(Math.max(4, Math.floor(256 / newSize)));
  }, [grid, pushHistory]);

  // Clear canvas
  const handleClear = useCallback(() => {
    pushHistory(grid);
    setGrid(createGrid(canvasSize));
  }, [grid, canvasSize, pushHistory]);

  // Get pixel coords from mouse event
  const getPixelCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): [number, number] | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / zoom);
      const y = Math.floor((e.clientY - rect.top) / zoom);
      if (x < 0 || x >= canvasSize || y < 0 || y >= canvasSize) return null;
      return [x, y];
    },
    [zoom, canvasSize]
  );

  // Apply a pixel to the grid
  const applyPixel = useCallback(
    (x: number, y: number, targetGrid: RGBA[][]): RGBA[][] => {
      const newGrid = cloneGrid(targetGrid);
      if (tool === 'eraser') {
        newGrid[y][x] = [...TRANSPARENT];
      } else {
        newGrid[y][x] = hexToRgba(color);
      }
      return newGrid;
    },
    [tool, color]
  );

  // Mouse down
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const coords = getPixelCoords(e);
      if (!coords) return;
      const [x, y] = coords;

      if (tool === 'eyedropper') {
        const px = grid[y][x];
        if (px[3] > 0) {
          setColor(rgbaToHex(px));
        }
        setTool('pencil');
        return;
      }

      if (tool === 'fill') {
        pushHistory(grid);
        const fillColor = hexToRgba(color);
        setGrid(floodFill(grid, x, y, fillColor));
        return;
      }

      if (tool === 'line' || tool === 'rect') {
        setLineStart([x, y]);
        setIsDrawing(true);
        return;
      }

      // Pencil / eraser
      pushHistory(grid);
      setGrid(applyPixel(x, y, grid));
      setIsDrawing(true);
    },
    [getPixelCoords, tool, grid, pushHistory, color, applyPixel]
  );

  // Mouse move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawing) return;
      const coords = getPixelCoords(e);
      if (!coords) return;
      const [x, y] = coords;

      if ((tool === 'line' || tool === 'rect') && lineStart) {
        // Preview
        const preview = cloneGrid(grid);
        const drawColor = hexToRgba(color);
        if (tool === 'line') {
          const points = bresenhamLine(lineStart[0], lineStart[1], x, y);
          for (const [px, py] of points) {
            if (px >= 0 && px < canvasSize && py >= 0 && py < canvasSize) {
              preview[py][px] = [...drawColor];
            }
          }
        } else {
          // Rectangle
          const x0 = Math.min(lineStart[0], x);
          const y0 = Math.min(lineStart[1], y);
          const x1 = Math.max(lineStart[0], x);
          const y1 = Math.max(lineStart[1], y);
          for (let ry = y0; ry <= y1; ry++) {
            for (let rx = x0; rx <= x1; rx++) {
              if (ry === y0 || ry === y1 || rx === x0 || rx === x1) {
                if (rx >= 0 && rx < canvasSize && ry >= 0 && ry < canvasSize) {
                  preview[ry][rx] = [...drawColor];
                }
              }
            }
          }
        }
        setPreviewGrid(preview);
        return;
      }

      // Pencil / eraser continuous drawing
      if (tool === 'pencil' || tool === 'eraser') {
        setGrid((prev) => applyPixel(x, y, prev));
      }
    },
    [isDrawing, getPixelCoords, tool, lineStart, grid, color, canvasSize, applyPixel]
  );

  // Mouse up
  const handleMouseUp = useCallback(() => {
    if ((tool === 'line' || tool === 'rect') && previewGrid) {
      pushHistory(grid);
      setGrid(previewGrid);
      setPreviewGrid(null);
    }
    setIsDrawing(false);
    setLineStart(null);
  }, [tool, previewGrid, grid, pushHistory]);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const displayGrid = previewGrid || grid;
    const w = canvasSize * zoom;
    const h = canvasSize * zoom;
    canvas.width = w;
    canvas.height = h;

    // Transparency checkerboard
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, w, h);
    const checkSize = zoom / 2;
    ctx.fillStyle = '#3a3a3a';
    for (let y = 0; y < canvasSize; y++) {
      for (let x = 0; x < canvasSize; x++) {
        if ((x + y) % 2 === 0) {
          ctx.fillRect(x * zoom, y * zoom, checkSize, checkSize);
          ctx.fillRect(x * zoom + checkSize, y * zoom + checkSize, checkSize, checkSize);
        } else {
          ctx.fillRect(x * zoom + checkSize, y * zoom, checkSize, checkSize);
          ctx.fillRect(x * zoom, y * zoom + checkSize, checkSize, checkSize);
        }
      }
    }

    // Draw pixels
    for (let y = 0; y < canvasSize; y++) {
      for (let x = 0; x < canvasSize; x++) {
        const px = displayGrid[y][x];
        if (px[3] > 0) {
          ctx.fillStyle = `rgba(${px[0]},${px[1]},${px[2]},${px[3] / 255})`;
          ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
        }
      }
    }

    // Grid lines
    if (showGrid && zoom >= 4) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= canvasSize; i++) {
        ctx.beginPath();
        ctx.moveTo(i * zoom + 0.5, 0);
        ctx.lineTo(i * zoom + 0.5, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * zoom + 0.5);
        ctx.lineTo(w, i * zoom + 0.5);
        ctx.stroke();
      }
    }
  }, [grid, previewGrid, canvasSize, zoom, showGrid]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); handleUndo(); }
      else if (e.ctrlKey && e.key === 'y') { e.preventDefault(); handleRedo(); }
      else if (e.key === 'b') setTool('pencil');
      else if (e.key === 'e') setTool('eraser');
      else if (e.key === 'g') setTool('fill');
      else if (e.key === 'l') setTool('line');
      else if (e.key === 'r') setTool('rect');
      else if (e.key === 'i') setTool('eyedropper');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleUndo, handleRedo]);

  // Export as PNG download
  const handleExport = useCallback(() => {
    const dataUrl = gridToDataUrl(grid);
    const link = document.createElement('a');
    link.download = `pixel-art-${canvasSize}x${canvasSize}.png`;
    link.href = dataUrl;
    link.click();
  }, [grid, canvasSize]);

  // Apply to entity sprite
  const handleApply = useCallback(() => {
    if (!entityId) return;
    const dataUrl = gridToDataUrl(grid);
    const base64 = dataUrl.split(',')[1];
    loadTexture(base64, `pixel-art-${canvasSize}x${canvasSize}.png`, entityId, 'base_color');
    onClose();
  }, [entityId, grid, canvasSize, loadTexture, onClose]);

  // Add color to custom palette
  const handleAddToPalette = useCallback(() => {
    if (!customPalette.includes(color)) {
      setCustomPalette((prev) => [...prev, color]);
    }
  }, [color, customPalette]);

  if (!open) return null;

  const TOOLS: { id: Tool; icon: typeof Pencil; label: string; shortcut: string }[] = [
    { id: 'pencil', icon: Pencil, label: 'Pencil', shortcut: 'B' },
    { id: 'eraser', icon: Eraser, label: 'Eraser', shortcut: 'E' },
    { id: 'fill', icon: PaintBucket, label: 'Fill', shortcut: 'G' },
    { id: 'line', icon: Minus, label: 'Line', shortcut: 'L' },
    { id: 'rect', icon: Square, label: 'Rectangle', shortcut: 'R' },
    { id: 'eyedropper', icon: Pipette, label: 'Eyedropper', shortcut: 'I' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex max-h-[90vh] w-[800px] max-w-[95vw] flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-200">Pixel Art Editor</h2>
          <div className="flex items-center gap-2">
            {/* Canvas size */}
            <select
              value={canvasSize}
              onChange={(e) => handleResize(parseInt(e.target.value) as CanvasSize)}
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
            >
              {CANVAS_SIZES.map((s) => (
                <option key={s} value={s}>{s}x{s}</option>
              ))}
            </select>
            <button
              onClick={onClose}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Tool Sidebar */}
          <div className="flex w-10 flex-col items-center gap-1 border-r border-zinc-800 py-2">
            {TOOLS.map(({ id, icon: Icon, label, shortcut }) => (
              <button
                key={id}
                onClick={() => setTool(id)}
                className={`rounded p-1.5 transition-colors ${
                  tool === id
                    ? 'bg-blue-600 text-white'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                }`}
                title={`${label} (${shortcut})`}
              >
                <Icon size={14} />
              </button>
            ))}
            <div className="my-1 h-px w-6 bg-zinc-800" />
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={14} />
            </button>
            <button
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 size={14} />
            </button>
            <div className="my-1 h-px w-6 bg-zinc-800" />
            <button
              onClick={() => setShowGrid((g) => !g)}
              className={`rounded p-1.5 transition-colors ${
                showGrid ? 'text-blue-400' : 'text-zinc-500'
              } hover:bg-zinc-800`}
              title="Toggle grid"
            >
              <Grid3X3 size={14} />
            </button>
            <button
              onClick={() => setZoom((z) => Math.min(z * 2, 64))}
              className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="Zoom in"
            >
              <ZoomIn size={14} />
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(z / 2, 2))}
              className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="Zoom out"
            >
              <ZoomOut size={14} />
            </button>
            <div className="my-1 h-px w-6 bg-zinc-800" />
            <button
              onClick={handleClear}
              className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
              title="Clear canvas"
            >
              <Trash2 size={14} />
            </button>
          </div>

          {/* Canvas Area */}
          <div className="flex flex-1 items-center justify-center overflow-auto bg-zinc-950 p-4">
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className="cursor-crosshair"
              style={{
                imageRendering: 'pixelated',
                width: canvasSize * zoom,
                height: canvasSize * zoom,
              }}
            />
          </div>

          {/* Color Panel */}
          <div className="flex w-44 flex-col border-l border-zinc-800 p-3">
            {/* Current Color */}
            <div className="mb-3">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-8 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => {
                    if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
                      setColor(e.target.value);
                    }
                  }}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
                  maxLength={7}
                />
              </div>
              <button
                onClick={handleAddToPalette}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
              >
                + Add to palette
              </button>
            </div>

            {/* Palette */}
            <div className="mb-3">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Palette
              </label>
              <div className="grid grid-cols-4 gap-1">
                {customPalette.map((c, i) => (
                  <button
                    key={`${c}-${i}`}
                    onClick={() => setColor(c)}
                    className={`h-6 w-6 rounded border ${
                      color === c ? 'border-blue-400 ring-1 ring-blue-400' : 'border-zinc-700'
                    }`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
            </div>

            {/* Preview */}
            <div className="mb-3">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Preview
              </label>
              <div
                className="flex items-center justify-center rounded border border-zinc-700 bg-zinc-800 p-2"
                style={{
                  backgroundImage: 'repeating-conic-gradient(#404040 0% 25%, transparent 0% 50%) 50% / 8px 8px',
                }}
              >
                <canvas
                  width={canvasSize}
                  height={canvasSize}
                  className="h-16 w-16"
                  style={{ imageRendering: 'pixelated' }}
                  ref={(el) => {
                    if (!el) return;
                    const ctx = el.getContext('2d');
                    if (!ctx) return;
                    const imgData = ctx.createImageData(canvasSize, canvasSize);
                    for (let y = 0; y < canvasSize; y++) {
                      for (let x = 0; x < canvasSize; x++) {
                        const idx = (y * canvasSize + x) * 4;
                        imgData.data[idx] = grid[y][x][0];
                        imgData.data[idx + 1] = grid[y][x][1];
                        imgData.data[idx + 2] = grid[y][x][2];
                        imgData.data[idx + 3] = grid[y][x][3];
                      }
                    }
                    ctx.putImageData(imgData, 0, 0);
                  }}
                />
              </div>
            </div>

            {/* Info */}
            <div className="mt-auto text-[10px] text-zinc-600">
              <p>{canvasSize}x{canvasSize}px</p>
              <p>Zoom: {zoom}x</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-3">
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
          >
            <Download size={12} />
            Export PNG
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            >
              Cancel
            </button>
            {entityId && (
              <button
                onClick={handleApply}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
              >
                Apply to Sprite
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

/* ─── Exported helpers for testing ───────────────────────────────────────── */
export { createGrid, cloneGrid, hexToRgba, rgbaToHex, colorsEqual, floodFill, bresenhamLine, gridToDataUrl };
export type { RGBA, Tool, CanvasSize };
