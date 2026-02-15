'use client';

import { useCallback } from 'react';
import { Paintbrush, Eraser, PaintBucket, Square, Pipette } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';

type TilemapTool = 'paint' | 'erase' | 'fill' | 'rectangle' | 'picker';

export function TilemapToolbar() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const tilemapData = useEditorStore((s) => primaryId ? s.tilemaps?.[primaryId] : null);
  const projectType = useEditorStore((s) => s.projectType);
  const activeTool = useEditorStore((s) => s.tilemapActiveTool ?? 'paint');
  const setActiveTool = useEditorStore((s) => s.setTilemapActiveTool);
  const activeLayerIndex = useEditorStore((s) => s.tilemapActiveLayerIndex ?? 0);
  const setActiveLayerIndex = useEditorStore((s) => s.setTilemapActiveLayerIndex);

  const handleToolClick = useCallback((tool: TilemapTool) => {
    setActiveTool(tool);
  }, [setActiveTool]);

  // Only show when a tilemap entity is selected and project is 2D
  if (projectType !== '2d' || !tilemapData) {
    return null;
  }

  const tools: Array<{ id: TilemapTool; icon: typeof Paintbrush; label: string }> = [
    { id: 'paint', icon: Paintbrush, label: 'Paint (B)' },
    { id: 'erase', icon: Eraser, label: 'Erase (E)' },
    { id: 'fill', icon: PaintBucket, label: 'Fill (G)' },
    { id: 'rectangle', icon: Square, label: 'Rectangle (R)' },
    { id: 'picker', icon: Pipette, label: 'Tile Picker (Alt+Click)' },
  ];

  return (
    <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-3 py-2">
      {/* Tool buttons */}
      <div className="flex items-center gap-1">
        {tools.map((tool) => {
          const Icon = tool.icon;
          const isActive = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              onClick={() => handleToolClick(tool.id)}
              className={`rounded p-1.5 ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
              title={tool.label}
            >
              <Icon size={16} />
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="h-6 w-px bg-zinc-700" />

      {/* Layer selector */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-zinc-500">Layer:</label>
        <select
          value={activeLayerIndex}
          onChange={(e) => setActiveLayerIndex(parseInt(e.target.value, 10))}
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
        >
          {tilemapData.layers.map((layer, index) => (
            <option key={index} value={index}>
              {layer.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
