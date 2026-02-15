'use client';

import { useState, useMemo, useCallback } from 'react';
import { Eye, EyeOff, Trash2, Plus } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';

const DEFAULT_LAYERS = ['Background', 'Default', 'Foreground', 'UI'];

export function SortingLayerPanel() {
  const sortingLayers = useEditorStore((s) => s.sortingLayers);
  const sprites = useEditorStore((s) => s.sprites);
  const [newLayerName, setNewLayerName] = useState('');

  // Count sprites per layer
  const layerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const layer of sortingLayers) {
      counts[layer.name] = 0;
    }
    for (const sprite of Object.values(sprites)) {
      if (counts[sprite.sortingLayer] !== undefined) {
        counts[sprite.sortingLayer]++;
      }
    }
    return counts;
  }, [sortingLayers, sprites]);

  // Sort layers by order
  const sortedLayers = useMemo(() => {
    return [...sortingLayers].sort((a, b) => a.order - b.order);
  }, [sortingLayers]);

  const handleToggleVisibility = useCallback((_layerName: string) => {
    // TODO: dispatch sorting layer visibility toggle
    // dispatchCommand('toggle_sorting_layer_visibility', { layerName: _layerName });
  }, []);

  const handleDeleteLayer = useCallback((layerName: string) => {
    if (DEFAULT_LAYERS.includes(layerName)) {
      return; // Can't delete default layers
    }
    // TODO: dispatch sorting layer deletion
    // dispatchCommand('delete_sorting_layer', { layerName });
  }, []);

  const handleAddLayer = useCallback(() => {
    const trimmed = newLayerName.trim();
    if (!trimmed) return;
    if (sortingLayers.some((l) => l.name === trimmed)) {
      alert(`Layer "${trimmed}" already exists`);
      return;
    }
    // TODO: dispatch sorting layer creation
    // dispatchCommand('add_sorting_layer', { name: trimmed, order: sortingLayers.length });
    setNewLayerName('');
  }, [newLayerName, sortingLayers]);

  return (
    <div className="flex h-full flex-col bg-zinc-900 px-3 py-4 overflow-y-auto">
      <h2 className="mb-4 text-sm font-semibold text-zinc-300">Sorting Layers</h2>

      {/* Layer List */}
      <div className="flex-1 space-y-1">
        {sortedLayers.map((layer) => {
          const isDefault = DEFAULT_LAYERS.includes(layer.name);
          const count = layerCounts[layer.name] ?? 0;

          return (
            <div
              key={layer.name}
              className="flex items-center gap-2 rounded bg-zinc-800 px-2 py-1.5 text-sm"
            >
              {/* Visibility Toggle */}
              <button
                onClick={() => handleToggleVisibility(layer.name)}
                className="shrink-0 text-zinc-400 hover:text-zinc-200"
                title={layer.visible ? 'Hide layer' : 'Show layer'}
              >
                {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>

              {/* Layer Name */}
              <span className="flex-1 text-xs text-zinc-300">{layer.name}</span>

              {/* Entity Count Badge */}
              {count > 0 && (
                <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">
                  {count}
                </span>
              )}

              {/* Delete Button (only for custom layers) */}
              {!isDefault && (
                <button
                  onClick={() => handleDeleteLayer(layer.name)}
                  className="shrink-0 text-zinc-500 hover:text-red-400"
                  title="Delete layer"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Layer */}
      <div className="mt-4 border-t border-zinc-800 pt-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newLayerName}
            onChange={(e) => setNewLayerName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleAddLayer();
              }
            }}
            placeholder="New layer name"
            className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
              focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={handleAddLayer}
            className="flex items-center gap-1 rounded bg-blue-900/30 px-2 py-1 text-xs text-blue-400 hover:bg-blue-900/50"
            title="Add sorting layer"
          >
            <Plus size={12} />
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
