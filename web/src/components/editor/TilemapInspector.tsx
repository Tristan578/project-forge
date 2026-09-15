'use client';

import { useCallback, useState } from 'react';
import { Plus, Trash2, Eye, EyeOff, Shield } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { TILE_COLLISION_SHAPES } from '@/stores/slices/types';
import type { CollisionShape } from '@/stores/slices/types';

interface _TilemapLayer {
  name: string;
  visible: boolean;
  opacity: number;
  isCollision: boolean;
}

/** Human-readable labels for the collision-shape picker, keyed by wire value. */
const COLLISION_SHAPE_LABELS: Record<CollisionShape, string> = {
  none: 'None (passable)',
  full: 'Full (solid)',
  halfTop: 'Half — Top',
  halfBottom: 'Half — Bottom',
  slopeLeft: 'Slope — Left',
  slopeRight: 'Slope — Right',
};

export function TilemapInspector() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const tilemapData = useEditorStore((s) => primaryId ? s.tilemaps?.[primaryId] : null);
  const tilesets = useEditorStore((s) => s.tilesets ?? {});
  const projectType = useEditorStore((s) => s.projectType);

  const setTilemapData = useEditorStore((s) => s.setTilemapData);
  const removeTilemapData = useEditorStore((s) => s.removeTilemapData);
  const setTileCollisionShape = useEditorStore((s) => s.setTileCollisionShape);
  const { confirm, ConfirmDialogPortal } = useConfirmDialog();

  // Per-tile collision-shape authoring (OP-04). A single cell is targeted by
  // layer + (x, y); Apply dispatches `set_tile_collision_shape` through the
  // shared store action, so the edit is undoable and mirrored back.
  const [shapeLayer, setShapeLayer] = useState(0);
  const [shapeX, setShapeX] = useState(0);
  const [shapeY, setShapeY] = useState(0);
  const [shapeValue, setShapeValue] = useState<CollisionShape>('full');

  const handleApplyCollisionShape = useCallback(() => {
    if (!primaryId) return;
    setTileCollisionShape(primaryId, shapeLayer, shapeX, shapeY, shapeValue);
  }, [primaryId, setTileCollisionShape, shapeLayer, shapeX, shapeY, shapeValue]);

  const handleAddTilemap = useCallback(() => {
    if (!primaryId) return;
    setTilemapData(primaryId, {
      tilesetAssetId: '',
      mapSize: [20, 15],
      tileSize: [32, 32],
      layers: [{ name: 'Layer 1', tiles: Array(20 * 15).fill(null), visible: true, opacity: 1, isCollision: false }],
      origin: 'TopLeft',
    });
  }, [primaryId, setTilemapData]);

  const handleRemoveTilemap = useCallback(async () => {
    if (!primaryId) return;
    if (await confirm('Remove tilemap from this entity?')) {
      removeTilemapData(primaryId);
    }
  }, [primaryId, removeTilemapData, confirm]);

  const handleUpdateTileset = useCallback((tilesetId: string) => {
    if (!primaryId || !tilemapData) return;
    setTilemapData(primaryId, { ...tilemapData, tilesetAssetId: tilesetId });
  }, [primaryId, tilemapData, setTilemapData]);

  const handleUpdateMapSize = useCallback((width: number, height: number) => {
    if (!primaryId || !tilemapData) return;
    setTilemapData(primaryId, { ...tilemapData, mapSize: [width, height] });
  }, [primaryId, tilemapData, setTilemapData]);

  const handleUpdateOrigin = useCallback((origin: 'TopLeft' | 'Center') => {
    if (!primaryId || !tilemapData) return;
    setTilemapData(primaryId, { ...tilemapData, origin });
  }, [primaryId, tilemapData, setTilemapData]);

  const handleAddLayer = useCallback(() => {
    if (!primaryId || !tilemapData) return;
    const layerCount = tilemapData.layers.length;
    const tileCount = tilemapData.mapSize[0] * tilemapData.mapSize[1];
    const newLayer = { name: `Layer ${layerCount + 1}`, tiles: Array(tileCount).fill(null) as (number | null)[], visible: true, opacity: 1, isCollision: false };
    setTilemapData(primaryId, { ...tilemapData, layers: [...tilemapData.layers, newLayer] });
  }, [primaryId, tilemapData, setTilemapData]);

  const handleRemoveLayer = useCallback(async (layerIndex: number) => {
    if (!primaryId || !tilemapData) return;
    if (await confirm(`Remove layer "${tilemapData.layers[layerIndex].name}"?`)) {
      setTilemapData(primaryId, { ...tilemapData, layers: tilemapData.layers.filter((_, i) => i !== layerIndex) });
    }
  }, [primaryId, tilemapData, setTilemapData, confirm]);

  const handleUpdateLayer = useCallback((layerIndex: number, partial: Partial<_TilemapLayer>) => {
    if (!primaryId || !tilemapData) return;
    const updatedLayers = tilemapData.layers.map((layer, i) =>
      i === layerIndex ? { ...layer, ...partial } : layer
    );
    setTilemapData(primaryId, { ...tilemapData, layers: updatedLayers });
  }, [primaryId, tilemapData, setTilemapData]);

  // Only show in 2D projects
  if (projectType !== '2d') return null;

  // Show "Add Tilemap" button if no tilemap exists
  if (!tilemapData) {
    return (
      <div className="border-t border-zinc-800 pt-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Tilemap
        </h3>
        <button
          onClick={handleAddTilemap}
          className="w-full rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
        >
          Add Tilemap
        </button>
      </div>
    );
  }

  const tilesetEntries = Object.entries(tilesets);

  return (
    <div className="border-t border-zinc-800 pt-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Tilemap
      </h3>

      <div className="space-y-4">
        {/* Tileset Settings */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-400">Tileset</label>
          <select
            value={tilemapData.tilesetAssetId}
            onChange={(e) => handleUpdateTileset(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
          >
            <option value="">None</option>
            {tilesetEntries.map(([id, tileset]) => (
              <option key={id} value={id}>
                {tileset.name ?? id}
              </option>
            ))}
          </select>
        </div>

        {/* Map Dimensions */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-400">Map Size (tiles)</label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-400">Width</label>
              <input
                type="number"
                value={tilemapData.mapSize[0]}
                onChange={(e) => handleUpdateMapSize(parseInt(e.target.value, 10), tilemapData.mapSize[1])}
                min={1}
                max={1000}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Height</label>
              <input
                type="number"
                value={tilemapData.mapSize[1]}
                onChange={(e) => handleUpdateMapSize(tilemapData.mapSize[0], parseInt(e.target.value, 10))}
                min={1}
                max={1000}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
              />
            </div>
          </div>
        </div>

        {/* Tile Size (read-only) */}
        <div className="space-y-1">
          <label className="text-xs text-zinc-400">Tile Size (px)</label>
          <div className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-400">
            {tilemapData.tileSize[0]} × {tilemapData.tileSize[1]}
          </div>
        </div>

        {/* Origin */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-400">Origin</label>
          <div className="flex gap-2">
            <label className="flex flex-1 items-center gap-2 text-xs text-zinc-300">
              <input
                type="radio"
                checked={tilemapData.origin === 'TopLeft'}
                onChange={() => handleUpdateOrigin('TopLeft')}
                className="h-3 w-3"
              />
              Top Left
            </label>
            <label className="flex flex-1 items-center gap-2 text-xs text-zinc-300">
              <input
                type="radio"
                checked={tilemapData.origin === 'Center'}
                onChange={() => handleUpdateOrigin('Center')}
                className="h-3 w-3"
              />
              Center
            </label>
          </div>
        </div>

        {/* Layers */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-zinc-400">Layers</label>
            <button
              type="button"
              onClick={handleAddLayer}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
              title="Add Layer"
              aria-label="Add layer"
            >
              <Plus size={12} aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-1">
            {tilemapData.layers.map((layer, index) => (
              <div
                key={index}
                className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-900 p-2"
              >
                {/* Layer name */}
                <input
                  type="text"
                  value={layer.name}
                  onChange={(e) => handleUpdateLayer(index, { name: e.target.value })}
                  className="min-w-0 flex-1 rounded border-0 bg-transparent px-1 py-0.5 text-xs text-zinc-300 focus:bg-zinc-800 focus:outline-none"
                  aria-label={`Name of layer ${index + 1}`}
                />

                {/* Visibility toggle. Every control in this row is icon-only, and
                    `title` alone names them "Hide layer" — identical on all of
                    them — so the layer being acted on has to be in the label. */}
                <button
                  type="button"
                  onClick={() => handleUpdateLayer(index, { visible: !layer.visible })}
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
                  title={layer.visible ? 'Hide layer' : 'Show layer'}
                  aria-label={`${layer.visible ? 'Hide' : 'Show'} layer ${layer.name || index + 1}`}
                  aria-pressed={layer.visible}
                >
                  {layer.visible
                    ? <Eye size={12} aria-hidden="true" />
                    : <EyeOff size={12} aria-hidden="true" />}
                </button>

                {/* Collision toggle */}
                <button
                  type="button"
                  onClick={() => handleUpdateLayer(index, { isCollision: !layer.isCollision })}
                  className={`rounded p-1 ${layer.isCollision ? 'text-yellow-500' : 'text-zinc-400'} hover:bg-zinc-800`}
                  title={layer.isCollision ? 'Collision enabled' : 'Collision disabled'}
                  aria-label={`Collision on layer ${layer.name || index + 1}`}
                  aria-pressed={layer.isCollision}
                >
                  <Shield size={12} aria-hidden="true" />
                </button>

                {/* Opacity slider */}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={layer.opacity}
                  onChange={(e) => handleUpdateLayer(index, { opacity: parseFloat(e.target.value) })}
                  className="w-12"
                  title={`Opacity: ${(layer.opacity * 100).toFixed(0)}%`}
                  aria-label={`Opacity of layer ${layer.name || index + 1}`}
                />

                {/* Delete button */}
                <button
                  type="button"
                  onClick={() => handleRemoveLayer(index)}
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-red-500"
                  title="Delete layer"
                  aria-label={`Delete layer ${layer.name || index + 1}`}
                >
                  <Trash2 size={12} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Per-tile collision shape (OP-04) */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-400">Tile Collision Shape</label>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label htmlFor="tcs-layer" className="text-xs text-zinc-400">Layer</label>
              <select
                id="tcs-layer"
                value={shapeLayer}
                onChange={(e) => setShapeLayer(parseInt(e.target.value, 10))}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
              >
                {tilemapData.layers.map((layer, i) => (
                  <option key={i} value={i}>{layer.name || `Layer ${i + 1}`}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tcs-x" className="text-xs text-zinc-400">X</label>
              <input
                id="tcs-x"
                type="number"
                value={shapeX}
                onChange={(e) => setShapeX(parseInt(e.target.value, 10) || 0)}
                min={0}
                max={Math.max(0, tilemapData.mapSize[0] - 1)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
              />
            </div>
            <div>
              <label htmlFor="tcs-y" className="text-xs text-zinc-400">Y</label>
              <input
                id="tcs-y"
                type="number"
                value={shapeY}
                onChange={(e) => setShapeY(parseInt(e.target.value, 10) || 0)}
                min={0}
                max={Math.max(0, tilemapData.mapSize[1] - 1)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
              />
            </div>
          </div>
          <select
            aria-label="Collision shape"
            value={shapeValue}
            onChange={(e) => setShapeValue(e.target.value as CollisionShape)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
          >
            {TILE_COLLISION_SHAPES.map((shape) => (
              <option key={shape} value={shape}>{COLLISION_SHAPE_LABELS[shape]}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleApplyCollisionShape}
            className="w-full rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
          >
            Apply Collision Shape
          </button>
        </div>

        {/* Grid & Collision Preview */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              className="h-3 w-3"
              // onChange={(e) => setShowGrid(e.target.checked)}
            />
            Show Grid
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              className="h-3 w-3"
              // onChange={(e) => setShowCollision(e.target.checked)}
            />
            Show Collision Preview
          </label>
        </div>

        {/* Remove Tilemap */}
        <button
          onClick={handleRemoveTilemap}
          className="w-full rounded bg-red-600/20 px-3 py-1.5 text-xs text-red-400 hover:bg-red-600/30"
        >
          Remove Tilemap
        </button>
      </div>
      <ConfirmDialogPortal />
    </div>
  );
}
