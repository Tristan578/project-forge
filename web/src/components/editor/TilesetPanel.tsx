'use client';

import { useCallback, useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';

interface TileSelection {
  tilesetId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export function TilesetPanel() {
  const tilesets = useEditorStore((s) => s.tilesets ?? {});
  const activeTilesetId = useEditorStore((s) => s.activeTilesetId);
  const setActiveTileset = useEditorStore((s) => s.setActiveTileset);

  const [selection, setSelection] = useState<TileSelection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeTileset = activeTilesetId ? tilesets[activeTilesetId] : null;
  const tilesetEntries = Object.entries(tilesets);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // TODO: Show tileset import dialog with tile size/spacing/margin options
      // For now, default to 32x32 tiles with no spacing/margin
      const _assetId = `tileset_${Date.now()}`;
      // dispatchCommand('import_tileset', {
      //   asset_id: _assetId,
      //   image_data: dataUrl,
      //   tile_size: [32, 32],
      //   spacing: 0,
      //   margin: 0
      // });
      console.log('Import tileset:', file.name, dataUrl.substring(0, 50));
    };
    reader.readAsDataURL(file);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleTileMouseDown = useCallback((tilesetId: string, tileX: number, tileY: number) => {
    setIsDragging(true);
    setSelection({
      tilesetId,
      startX: tileX,
      startY: tileY,
      endX: tileX,
      endY: tileY,
    });
  }, []);

  const handleTileMouseMove = useCallback((tileX: number, tileY: number) => {
    if (!isDragging || !selection) return;
    setSelection((prev) => prev ? { ...prev, endX: tileX, endY: tileY } : null);
  }, [isDragging, selection]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  if (tilesetEntries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-xs text-zinc-500">No tilesets imported yet</p>
        <button
          onClick={handleImportClick}
          className="flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
        >
          <Upload size={14} />
          Import Tileset
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Tileset
          </h3>
          <button
            onClick={handleImportClick}
            className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
            title="Import Tileset"
          >
            <Upload size={14} />
          </button>
        </div>

        {/* Tileset selector */}
        <select
          value={activeTilesetId ?? ''}
          onChange={(e) => setActiveTileset(e.target.value || null)}
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
        >
          <option value="">Select tileset...</option>
          {tilesetEntries.map(([id, tileset]) => (
            <option key={id} value={id}>
              {tileset.name ?? id}
            </option>
          ))}
        </select>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Tileset grid */}
      {activeTileset && (
        <div className="flex-1 overflow-auto p-3">
          <div
            className="grid gap-0.5"
            style={{
              gridTemplateColumns: `repeat(${activeTileset.gridSize[0]}, 32px)`,
            }}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {Array.from({ length: activeTileset.gridSize[0] * activeTileset.gridSize[1] }).map((_, i) => {
              const tileX = i % activeTileset.gridSize[0];
              const tileY = Math.floor(i / activeTileset.gridSize[0]);
              const tileId = i;

              // Check if this tile is in the selection
              const isSelected = selection &&
                selection.tilesetId === activeTilesetId &&
                tileX >= Math.min(selection.startX, selection.endX) &&
                tileX <= Math.max(selection.startX, selection.endX) &&
                tileY >= Math.min(selection.startY, selection.endY) &&
                tileY <= Math.max(selection.startY, selection.endY);

              return (
                <div
                  key={tileId}
                  className={`h-8 w-8 cursor-pointer border ${
                    isSelected ? 'border-blue-500 bg-blue-900/30' : 'border-zinc-700 bg-zinc-800'
                  } hover:border-zinc-500`}
                  title={`Tile ${tileId}`}
                  onMouseDown={() => activeTilesetId && handleTileMouseDown(activeTilesetId, tileX, tileY)}
                  onMouseMove={() => handleTileMouseMove(tileX, tileY)}
                  style={{
                    backgroundImage: activeTileset.assetId
                      ? `url(${activeTileset.assetId})`
                      : 'none',
                    backgroundPosition: `-${tileX * activeTileset.tileSize[0]}px -${tileY * activeTileset.tileSize[1]}px`,
                    backgroundSize: `${activeTileset.gridSize[0] * activeTileset.tileSize[0]}px ${activeTileset.gridSize[1] * activeTileset.tileSize[1]}px`,
                    imageRendering: 'pixelated',
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
