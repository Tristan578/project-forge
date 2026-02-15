'use client';

import { useCallback } from 'react';
import { Plus, Trash2, Eye, EyeOff, Shield, GripVertical } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';

interface _TilemapLayer {
  name: string;
  visible: boolean;
  opacity: number;
  isCollision: boolean;
}

export function TilemapLayerPanel() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const tilemapData = useEditorStore((s) => primaryId ? s.tilemaps?.[primaryId] : null);
  const activeLayerIndex = useEditorStore((s) => s.tilemapActiveLayerIndex ?? 0);
  const setActiveLayerIndex = useEditorStore((s) => s.setTilemapActiveLayerIndex);

  const handleAddLayer = useCallback(() => {
    if (!primaryId || !tilemapData) return;
    const _layerCount = tilemapData.layers.length;
    // dispatchCommand('add_tilemap_layer', {
    //   tilemap_id: primaryId,
    //   name: `Layer ${_layerCount + 1}`
    // });
    console.log('Add layer');
  }, [primaryId, tilemapData]);

  const handleRemoveLayer = useCallback((layerIndex: number) => {
    if (!primaryId || !tilemapData) return;
    const layer = tilemapData.layers[layerIndex];
    if (confirm(`Remove layer "${layer.name}"?`)) {
      // dispatchCommand('remove_tilemap_layer', {
      //   tilemap_id: primaryId,
      //   layer: layerIndex
      // });
      console.log('Remove layer:', layerIndex);
    }
  }, [primaryId, tilemapData]);

  const handleUpdateLayer = useCallback((layerIndex: number, partial: Partial<_TilemapLayer>) => {
    if (!primaryId || !tilemapData) return;
    // dispatchCommand('set_tilemap_layer', {
    //   tilemap_id: primaryId,
    //   layer: layerIndex,
    //   ...partial
    // });
    console.log('Update layer:', layerIndex, partial);
  }, [primaryId, tilemapData]);

  const handleLayerClick = useCallback((layerIndex: number) => {
    setActiveLayerIndex(layerIndex);
  }, [setActiveLayerIndex]);

  if (!tilemapData) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-900">
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-800 p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Layers
          </h3>
          <button
            onClick={handleAddLayer}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            title="Add Layer"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Layer list */}
      <div className="flex-1 overflow-auto p-2">
        <div className="space-y-1">
          {tilemapData.layers.map((layer, index) => {
            const isActive = index === activeLayerIndex;
            return (
              <div
                key={index}
                onClick={() => handleLayerClick(index)}
                className={`flex cursor-pointer items-center gap-2 rounded border p-2 ${
                  isActive
                    ? 'border-blue-500 bg-blue-900/30'
                    : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                }`}
              >
                {/* Drag handle */}
                <div className="cursor-move text-zinc-600" title="Drag to reorder">
                  <GripVertical size={14} />
                </div>

                {/* Layer name */}
                <input
                  type="text"
                  value={layer.name}
                  onChange={(e) => {
                    e.stopPropagation();
                    handleUpdateLayer(index, { name: e.target.value });
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-0 flex-1 rounded border-0 bg-transparent px-1 py-0.5 text-xs text-zinc-300 focus:bg-zinc-900 focus:outline-none"
                />

                {/* Visibility toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUpdateLayer(index, { visible: !layer.visible });
                  }}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
                  title={layer.visible ? 'Hide layer' : 'Show layer'}
                >
                  {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>

                {/* Collision toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUpdateLayer(index, { isCollision: !layer.isCollision });
                  }}
                  className={`rounded p-1 ${
                    layer.isCollision ? 'text-yellow-500' : 'text-zinc-600'
                  } hover:bg-zinc-700`}
                  title={layer.isCollision ? 'Collision enabled' : 'Collision disabled'}
                >
                  <Shield size={12} />
                </button>

                {/* Opacity display */}
                <div
                  className="text-xs text-zinc-500"
                  title={`Opacity: ${(layer.opacity * 100).toFixed(0)}%`}
                >
                  {(layer.opacity * 100).toFixed(0)}%
                </div>

                {/* Delete button */}
                {tilemapData.layers.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveLayer(index);
                    }}
                    className="rounded p-1 text-zinc-600 hover:bg-zinc-700 hover:text-red-500"
                    title="Delete layer"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Opacity slider for active layer */}
      {tilemapData.layers[activeLayerIndex] && (
        <div className="shrink-0 border-t border-zinc-800 p-3">
          <label className="mb-1 block text-xs text-zinc-500">Layer Opacity</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={tilemapData.layers[activeLayerIndex].opacity}
            onChange={(e) => handleUpdateLayer(activeLayerIndex, { opacity: parseFloat(e.target.value) })}
            className="w-full"
          />
          <div className="mt-1 text-center text-xs text-zinc-500">
            {(tilemapData.layers[activeLayerIndex].opacity * 100).toFixed(0)}%
          </div>
        </div>
      )}
    </div>
  );
}
