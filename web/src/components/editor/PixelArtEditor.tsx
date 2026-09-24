/** Manual editor-local pixel layers, drawing history, and flattened PNG export/apply. */
'use client';

import { useState, useRef, useCallback, useEffect, useMemo, memo, useId } from 'react';
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
  Plus,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import {
  type RGBA,
  type Layer,
  TRANSPARENT,
  createGrid,
  cloneGrid,
  colorsEqual,
  createLayer,
  clampOpacity,
  addLayer,
  deleteLayer,
  moveLayerUp,
  moveLayerDown,
  toggleLayerVisibility,
  renameLayer,
  setLayerOpacity,
  compositeLayers,
} from '@/lib/sprites/pixelLayers';

/* ─── Types ──────────────────────────────────────────────────────────────── */

type Tool = 'pencil' | 'eraser' | 'fill' | 'line' | 'rect' | 'eyedropper';

/** Visibility and optional target for the manual pixel editor. */
interface PixelArtEditorProps {
  /** Show the editor; closing retains this mounted component's local state. */
  open: boolean;
  /** Dismiss the editor without persisting a layer-stack format. */
  onClose: () => void;
  /** Entity to apply the texture to. If null, export-only mode. */
  entityId?: string | null;
}

/** Undo/redo snapshot: the whole layer stack plus which layer was active. */
interface LayerSnapshot {
  /** Deep-copied bottom-to-top layer stack. */
  layers: Layer[];
  /** Selected layer index within the saved stack. */
  activeLayerIndex: number;
  /** Pixel dimensions restored together with the saved layer grids. */
  canvasSize: CanvasSize;
  /** Display zoom restored together with pixel dimensions. */
  zoom: number;
}

/* ─── Constants ──────────────────────────────────────────────────────────── */

const CANVAS_SIZES = [8, 16, 32, 64] as const;
type CanvasSize = (typeof CANVAS_SIZES)[number];

const DEFAULT_PALETTE: string[] = [
  '#000000', '#1d2b53', '#7e2553', '#008751',
  '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
  '#ff004d', '#ffa300', '#ffec27', '#00e436',
  '#29adff', '#83769c', '#ff77a8', '#ffccaa',
];

const MAX_HISTORY = 50;

/* ─── Pixel Grid Helpers ─────────────────────────────────────────────────── */

/**
 * Convert a validated editor RGB color to one pixel.
 * @param hex Valid six-digit RGB color beginning with #.
 * @param alpha Alpha channel from 0 to 255, default 255.
 * @returns The parsed RGBA pixel tuple.
 */
function hexToRgba(hex: string, alpha = 255): RGBA {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, alpha];
}

/**
 * Format a pixel color for the editor color input.
 * @param c RGBA pixel with integer color channels from 0 to 255.
 * @returns A six-digit RGB hex string; alpha is omitted.
 */
function rgbaToHex(c: RGBA): string {
  return `#${c[0].toString(16).padStart(2, '0')}${c[1].toString(16).padStart(2, '0')}${c[2].toString(16).padStart(2, '0')}`;
}

/**
 * Flood fill from (x,y) replacing targetColor with fillColor.
 * @param grid Square RGBA grid to copy and fill.
 * @param x Valid integer column of the starting pixel.
 * @param y Valid integer row of the starting pixel.
 * @param fillColor Valid RGBA replacement tuple.
 * @returns A fresh grid replacing connected exact-color pixels; input is unchanged.
 */
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

/**
 * Bresenham line from (x0,y0) to (x1,y1).
 * @param x0 Integer start column.
 * @param y0 Integer start row.
 * @param x1 Integer end column.
 * @param y1 Integer end row.
 * @returns Inclusive integer pixel coordinates along the line.
 */
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

/**
 * Generate PNG data URL from pixel grid.
 * @param grid Square valid RGBA grid to encode; requires a browser 2D canvas context.
 * @returns A flattened PNG data URL with the grid side length as its dimensions.
 */
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

/** Deep-clone a layer including its grid, for undo snapshots. */
function cloneLayer(layer: Layer): Layer {
  return { ...layer, grid: cloneGrid(layer.grid) };
}

/* ─── Component ──────────────────────────────────────────────────────────── */

/**
 * Start a 16x16 transparent layer stack and edit it with manual layer/drawing controls.
 * Undo/redo restores layers, selection, dimensions and zoom; resize starts a fresh stack.
 * Layer names commit on blur/Enter; empty drafts and Escape cancellation stay local.
 * State stays local while mounted. PNG download and sprite application flatten visible
 * layers; durable layer storage and AI parity remain work under #9817.
 * @param props Visibility, dismissal callback and optional sprite entity target.
 * @returns The editor while open, or null while its local state is retained closed.
 */
export const PixelArtEditor = memo(function PixelArtEditor({
  open,
  onClose,
  entityId,
}: PixelArtEditorProps) {
  const loadTexture = useEditorStore((s) => s.loadTexture);
  const colorInputId = useId();

  // Canvas state
  const [canvasSize, setCanvasSize] = useState<CanvasSize>(16);
  const [layers, setLayers] = useState<Layer[]>(() => [
    createLayer(16, { name: 'Layer 1' }),
  ]);
  const [activeLayerIndex, setActiveLayerIndex] = useState(0);
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
  const [undoStack, setUndoStack] = useState<LayerSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<LayerSnapshot[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeLayerButtonRef = useRef<HTMLButtonElement>(null);
  const [nameEdit, setNameEdit] = useState<{ layerId: string; text: string } | null>(null);
  const nameEditRef = useRef<{ layerId: string; text: string } | null>(null);

  // Active layer, clamped so a shrunk stack never dangles the index.
  const activeIndex = Math.min(activeLayerIndex, layers.length - 1);
  const activeLayer = layers[activeIndex];
  const activeGrid = activeLayer.grid;

  // Composite of every visible layer — what the canvas and export both use.
  // While previewing a line/rect the active layer is swapped for the preview.
  const composited = useMemo(() => {
    const src = previewGrid
      ? layers.map((l, i) => (i === activeIndex ? { ...l, grid: previewGrid } : l))
      : layers;
    return compositeLayers(src, canvasSize);
  }, [layers, previewGrid, activeIndex, canvasSize]);

  // Snapshot current layer state onto the undo stack.
  const pushHistory = useCallback(() => {
    setUndoStack((prev) => {
      const next = [
        ...prev,
        { layers: layers.map(cloneLayer), activeLayerIndex: activeIndex, canvasSize, zoom },
      ];
      if (next.length > MAX_HISTORY) next.shift();
      return next;
    });
    setRedoStack([]);
  }, [layers, activeIndex, canvasSize, zoom]);

  // Replace the active layer's grid (draw/erase/fill/clear).
  const setActiveGrid = useCallback(
    (updater: RGBA[][] | ((prev: RGBA[][]) => RGBA[][])) => {
      setLayers((prev) =>
        prev.map((l, i) => {
          if (i !== activeIndex) return l;
          const nextGrid = typeof updater === 'function' ? updater(l.grid) : updater;
          return { ...l, grid: nextGrid };
        })
      );
    },
    [activeIndex]
  );

  // Discrete history transitions stay outside updater functions: StrictMode may
  // replay an updater, but must never push the opposite stack more than once.
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    const current: LayerSnapshot = { layers: layers.map(cloneLayer), activeLayerIndex: activeIndex, canvasSize, zoom };
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack(previous => [...previous, current]);
    setLayers(last.layers);
    setCanvasSize(last.canvasSize);
    setZoom(last.zoom);
    setActiveLayerIndex(Math.min(last.activeLayerIndex, last.layers.length - 1));
    nameEditRef.current = null;
    setNameEdit(null);
    setPreviewGrid(null);
    setLineStart(null);
    setIsDrawing(false);
  }, [undoStack, layers, activeIndex, canvasSize, zoom]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const last = redoStack[redoStack.length - 1];
    const current: LayerSnapshot = { layers: layers.map(cloneLayer), activeLayerIndex: activeIndex, canvasSize, zoom };
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack(previous => [...previous, current]);
    setLayers(last.layers);
    setCanvasSize(last.canvasSize);
    setZoom(last.zoom);
    setActiveLayerIndex(Math.min(last.activeLayerIndex, last.layers.length - 1));
    nameEditRef.current = null;
    setNameEdit(null);
    setPreviewGrid(null);
    setLineStart(null);
    setIsDrawing(false);
  }, [redoStack, layers, activeIndex, canvasSize, zoom]);

  // Resize canvas — replaces the stack with a single fresh layer.
  const handleResize = useCallback((newSize: CanvasSize) => {
    pushHistory();
    nameEditRef.current = null;
    setNameEdit(null);
    setPreviewGrid(null);
    setLineStart(null);
    setIsDrawing(false);
    setCanvasSize(newSize);
    setLayers([createLayer(newSize, { name: 'Layer 1' })]);
    setActiveLayerIndex(0);
    setZoom(Math.max(4, Math.floor(256 / newSize)));
  }, [pushHistory]);

  // Clear the active layer.
  const handleClear = useCallback(() => {
    pushHistory();
    setActiveGrid(createGrid(canvasSize));
  }, [canvasSize, pushHistory, setActiveGrid]);

  /* ─── Layer panel actions ──────────────────────────────────────────────── */

  const handleAddLayer = useCallback(() => {
    pushHistory();
    const next = addLayer(layers, canvasSize);
    setLayers(next);
    setActiveLayerIndex(next.length - 1);
  }, [layers, canvasSize, pushHistory]);

  const handleDeleteLayer = useCallback(() => {
    if (layers.length <= 1) return;
    pushHistory();
    const next = deleteLayer(layers, activeIndex);
    setLayers(next);
    setActiveLayerIndex((i) => Math.min(i, next.length - 1));
  }, [layers, activeIndex, pushHistory]);

  const handleMoveLayerUp = useCallback(() => {
    const next = moveLayerUp(layers, activeIndex);
    if (next === layers) return;
    pushHistory();
    setLayers(next);
    setActiveLayerIndex(activeIndex + 1);
  }, [layers, activeIndex, pushHistory]);

  const handleMoveLayerDown = useCallback(() => {
    const next = moveLayerDown(layers, activeIndex);
    if (next === layers) return;
    pushHistory();
    setLayers(next);
    setActiveLayerIndex(activeIndex - 1);
  }, [layers, activeIndex, pushHistory]);

  const handleToggleVisibility = useCallback(
    (index: number) => {
      pushHistory();
      setLayers((prev) => toggleLayerVisibility(prev, index));
    },
    [pushHistory]
  );

  const handleRenameLayer = useCallback((index: number, name: string) => {
    if (!name.trim() || layers[index].name === name) return;
    pushHistory();
    setLayers((prev) => renameLayer(prev, index, name));
  }, [layers, pushHistory]);

  const handleSetOpacity = useCallback(
    (index: number, opacity: number) => {
      const normalized = clampOpacity(opacity);
      if (layers[index].opacity === normalized) return;
      pushHistory();
      setLayers((prev) => setLayerOpacity(prev, index, normalized));
    },
    [layers, pushHistory]
  );

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

  // Apply a pixel to a grid (writes to the active layer's data).
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
        // Sample the composited pixel the user actually sees.
        const px = composited[y][x];
        if (px[3] > 0) {
          setColor(rgbaToHex(px));
        }
        setTool('pencil');
        return;
      }

      if (tool === 'fill') {
        pushHistory();
        const fillColor = hexToRgba(color);
        setActiveGrid(floodFill(activeGrid, x, y, fillColor));
        return;
      }

      if (tool === 'line' || tool === 'rect') {
        setLineStart([x, y]);
        setIsDrawing(true);
        return;
      }

      // Pencil / eraser
      pushHistory();
      setActiveGrid(applyPixel(x, y, activeGrid));
      setIsDrawing(true);
    },
    [getPixelCoords, tool, composited, activeGrid, pushHistory, color, applyPixel, setActiveGrid]
  );

  // Mouse move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawing) return;
      const coords = getPixelCoords(e);
      if (!coords) return;
      const [x, y] = coords;

      if ((tool === 'line' || tool === 'rect') && lineStart) {
        // Preview against the active layer only.
        const preview = cloneGrid(activeGrid);
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
        setActiveGrid((prev) => applyPixel(x, y, prev));
      }
    },
    [isDrawing, getPixelCoords, tool, lineStart, activeGrid, color, canvasSize, applyPixel, setActiveGrid]
  );

  // Mouse up
  const handleMouseUp = useCallback(() => {
    if ((tool === 'line' || tool === 'rect') && previewGrid) {
      pushHistory();
      setActiveGrid(previewGrid);
      setPreviewGrid(null);
    }
    setIsDrawing(false);
    setLineStart(null);
  }, [tool, previewGrid, pushHistory, setActiveGrid]);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const displayGrid = composited;
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
  }, [composited, canvasSize, zoom, showGrid, open]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      // Don't hijack keys while the user is typing in a field (e.g. renaming a layer).
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
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

  // Export as PNG download (flattened composite of every visible layer).
  const handleExport = useCallback(() => {
    const dataUrl = gridToDataUrl(compositeLayers(layers, canvasSize));
    const link = document.createElement('a');
    link.download = `pixel-art-${canvasSize}x${canvasSize}.png`;
    link.href = dataUrl;
    link.click();
  }, [layers, canvasSize]);

  // Apply to entity sprite (flattened composite).
  const handleApply = useCallback(() => {
    if (!entityId) return;
    const dataUrl = gridToDataUrl(compositeLayers(layers, canvasSize));
    const base64 = dataUrl.split(',')[1];
    loadTexture(base64, `pixel-art-${canvasSize}x${canvasSize}.png`, entityId, 'base_color');
    onClose();
  }, [entityId, layers, canvasSize, loadTexture, onClose]);

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
      <div className="flex max-h-[90vh] w-[900px] max-w-[95vw] flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-200">Pixel Art Editor</h2>
          <div className="flex items-center gap-2">
            {/* Canvas size */}
            <select
              aria-label="Canvas size"
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
        <div className="flex flex-1 flex-wrap overflow-auto sm:flex-nowrap sm:overflow-hidden">
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
                showGrid ? 'text-blue-400' : 'text-zinc-400'
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
              title="Clear layer"
            >
              <Trash2 size={14} />
            </button>
          </div>

          {/* Canvas Area */}
          <div className="flex min-w-0 flex-1 items-center justify-center overflow-auto bg-zinc-950 p-4">
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
          <div className="flex w-full flex-col border-l border-zinc-800 p-3 sm:w-44 sm:shrink-0">
            {/* Current Color */}
            <div className="mb-3">
              <label htmlFor={colorInputId} className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={colorInputId}
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-8 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
                />
                <input
                  type="text"
                  aria-label="Color hex value"
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
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
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
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
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
                        imgData.data[idx] = composited[y][x][0];
                        imgData.data[idx + 1] = composited[y][x][1];
                        imgData.data[idx + 2] = composited[y][x][2];
                        imgData.data[idx + 3] = composited[y][x][3];
                      }
                    }
                    ctx.putImageData(imgData, 0, 0);
                  }}
                />
              </div>
            </div>

            {/* Info */}
            <div className="mt-auto text-[10px] text-zinc-400">
              <p>{canvasSize}x{canvasSize}px</p>
              <p>Zoom: {zoom}x</p>
            </div>
          </div>

          {/* Layers Panel */}
          <div className="flex w-full flex-col border-l border-zinc-800 p-3 sm:w-44 sm:shrink-0">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                Layers
              </label>
              <button
                onClick={handleAddLayer}
                className="flex min-h-11 min-w-11 items-center justify-center rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                title="Add layer"
              >
                <Plus size={14} />
              </button>
            </div>

            {/* Layer list — topmost layer first. */}
            <div className="max-h-48 flex-1 space-y-1 overflow-auto sm:max-h-none">
              {layers
                .map((layer, index) => ({ layer, index }))
                .slice()
                .reverse()
                .map(({ layer, index }) => (
                  <div
                    key={layer.id}
                    className={`flex items-center gap-1 rounded border px-1 py-1 ${
                      index === activeIndex
                        ? 'border-blue-500 bg-blue-600/10'
                        : 'border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <button
                      aria-pressed={layer.visible}
                      onClick={() => handleToggleVisibility(index)}
                      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded p-0.5 text-zinc-400 hover:text-zinc-200"
                      title={`Toggle visibility of ${layer.name}`}
                    >
                      {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                    <button
                      ref={index === activeIndex ? activeLayerButtonRef : undefined}
                      aria-pressed={index === activeIndex}
                      onClick={() => setActiveLayerIndex(index)}
                      className={`min-h-11 min-w-11 flex-1 truncate text-left text-[11px] ${
                        index === activeIndex ? 'text-zinc-100' : 'text-zinc-400'
                      } ${layer.visible ? '' : 'italic'}`}
                      title={`Select ${layer.name}`}
                    >
                      {layer.name}
                    </button>
                  </div>
                ))}
            </div>

            {/* Active layer controls */}
            <div className="mt-2 space-y-2 border-t border-zinc-800 pt-2">
              <input
                type="text"
                value={nameEdit?.layerId === activeLayer.id ? nameEdit.text : activeLayer.name}
                onFocus={() => {
                  const edit = { layerId: activeLayer.id, text: activeLayer.name };
                  nameEditRef.current = edit;
                  setNameEdit(edit);
                }}
                onChange={(e) => {
                  const edit = { layerId: activeLayer.id, text: e.target.value };
                  nameEditRef.current = edit;
                  setNameEdit(edit);
                }}
                onBlur={() => {
                  const edit = nameEditRef.current;
                  nameEditRef.current = null;
                  setNameEdit(null);
                  if (edit?.layerId === activeLayer.id) handleRenameLayer(activeIndex, edit.text);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    nameEditRef.current = null;
                    setNameEdit(null);
                    activeLayerButtonRef.current?.focus();
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    activeLayerButtonRef.current?.focus();
                  }
                }}
                aria-label="Layer name"
                className="min-h-11 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300"
              />
              <div className="flex items-center gap-1">
                <span className="text-[9px] uppercase tracking-wide text-zinc-400">Opacity</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={activeLayer.opacity}
                  onChange={(e) => handleSetOpacity(activeIndex, Number(e.target.value))}
                  aria-label="Layer opacity"
                  className="min-h-11 min-w-11 flex-1 accent-blue-500"
                />
                <span className="w-6 text-right text-[9px] text-zinc-400">
                  {Math.round(activeLayer.opacity * 100)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleMoveLayerUp}
                  disabled={activeIndex >= layers.length - 1}
                  className="min-h-11 min-w-11 flex-1 rounded border border-zinc-700 bg-zinc-800 p-1 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                  title="Move layer up"
                >
                  <ChevronUp size={12} className="mx-auto" />
                </button>
                <button
                  onClick={handleMoveLayerDown}
                  disabled={activeIndex <= 0}
                  className="min-h-11 min-w-11 flex-1 rounded border border-zinc-700 bg-zinc-800 p-1 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                  title="Move layer down"
                >
                  <ChevronDown size={12} className="mx-auto" />
                </button>
                <button
                  onClick={handleDeleteLayer}
                  disabled={layers.length <= 1}
                  className="min-h-11 min-w-11 flex-1 rounded border border-zinc-700 bg-zinc-800 p-1 text-zinc-400 hover:text-red-400 disabled:opacity-30"
                  title="Delete layer"
                >
                  <Trash2 size={12} className="mx-auto" />
                </button>
              </div>
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
