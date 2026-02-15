'use client';

import { useCallback, useRef } from 'react';
import { X, Image as ImageIcon } from 'lucide-react';
import { useEditorStore, type SpriteData, type SpriteAnchor } from '@/stores/editorStore';

/** Anchor point grid positions */
const ANCHOR_GRID: SpriteAnchor[][] = [
  ['top_left', 'top_center', 'top_right'],
  ['middle_left', 'center', 'middle_right'],
  ['bottom_left', 'bottom_center', 'bottom_right'],
];

export function SpriteInspector() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const spriteData = useEditorStore((s) => primaryId ? s.sprites[primaryId] : null);
  const sortingLayers = useEditorStore((s) => s.sortingLayers);
  const assetRegistry = useEditorStore((s) => s.assetRegistry);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpdate = useCallback(
    (_partial: Partial<SpriteData>) => {
      if (primaryId && spriteData) {
        // TODO: dispatch sprite update command
        // dispatchCommand('update_sprite', { entityId: primaryId, ...partial });
      }
    },
    [primaryId, spriteData]
  );

  const handleTextureUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0 || !primaryId) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const _base64 = result.split(',')[1];
      // TODO: dispatch texture load + sprite texture update
      // dispatchCommand('load_texture', { dataBase64: _base64, name: file.name, entityId: primaryId, slot: 'sprite' });
    };
    reader.readAsDataURL(file);
  }, [primaryId]);

  const handleSelectTexture = useCallback((assetId: string) => {
    if (!primaryId) return;
    handleUpdate({ textureAssetId: assetId });
  }, [primaryId, handleUpdate]);

  const handleClearTexture = useCallback(() => {
    handleUpdate({ textureAssetId: null });
  }, [handleUpdate]);

  if (!spriteData || !primaryId) return null;

  const textureAssets = Object.values(assetRegistry).filter((a) => a.kind === 'texture');
  const currentAsset = spriteData.textureAssetId
    ? assetRegistry[spriteData.textureAssetId]
    : null;

  return (
    <div className="border-t border-zinc-800 pt-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Sprite
      </h3>

      <div className="space-y-3">
        {/* Texture Section */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-400">Texture</label>

          {/* Texture Preview */}
          {spriteData.textureAssetId && (
            <div
              className="h-12 w-12 rounded border border-zinc-700 bg-zinc-800"
              style={{
                backgroundImage: 'repeating-conic-gradient(#606060 0% 25%, transparent 0% 50%) 50% / 8px 8px',
              }}
              title={currentAsset?.name ?? 'Texture'}
            />
          )}

          {/* Texture Selector */}
          {textureAssets.length > 0 ? (
            <div className="flex items-center gap-2">
              <select
                value={spriteData.textureAssetId ?? '__none__'}
                onChange={(e) => {
                  if (e.target.value === '__upload__') {
                    fileRef.current?.click();
                  } else if (e.target.value === '__none__') {
                    handleClearTexture();
                  } else {
                    handleSelectTexture(e.target.value);
                  }
                }}
                className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
              >
                <option value="__none__">None</option>
                {textureAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>{asset.name}</option>
                ))}
                <option value="__upload__">Upload new...</option>
              </select>
              {spriteData.textureAssetId && (
                <button
                  onClick={handleClearTexture}
                  className="rounded bg-zinc-700 p-1 text-zinc-400 hover:bg-zinc-600 hover:text-red-400"
                  title="Clear texture"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              >
                <ImageIcon size={12} />
                <span>Upload Texture</span>
              </button>
              {spriteData.textureAssetId && (
                <button
                  onClick={handleClearTexture}
                  className="rounded p-1 text-zinc-500 hover:text-red-400"
                  title="Clear texture"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(e) => handleTextureUpload(e.target.files)}
          />
        </div>

        {/* Appearance Section */}
        <div className="border-t border-zinc-800 pt-2">
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
            Appearance
          </h4>

          {/* Color Tint */}
          <div className="mb-2 space-y-1">
            <label className="text-xs text-zinc-400">Color Tint</label>
            <div className="grid grid-cols-4 gap-1">
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={spriteData.colorTint[0]}
                onChange={(e) =>
                  handleUpdate({
                    colorTint: [parseFloat(e.target.value), spriteData.colorTint[1], spriteData.colorTint[2], spriteData.colorTint[3]],
                  })
                }
                className="w-full rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-xs text-white"
                title="Red"
              />
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={spriteData.colorTint[1]}
                onChange={(e) =>
                  handleUpdate({
                    colorTint: [spriteData.colorTint[0], parseFloat(e.target.value), spriteData.colorTint[2], spriteData.colorTint[3]],
                  })
                }
                className="w-full rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-xs text-white"
                title="Green"
              />
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={spriteData.colorTint[2]}
                onChange={(e) =>
                  handleUpdate({
                    colorTint: [spriteData.colorTint[0], spriteData.colorTint[1], parseFloat(e.target.value), spriteData.colorTint[3]],
                  })
                }
                className="w-full rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-xs text-white"
                title="Blue"
              />
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={spriteData.colorTint[3]}
                onChange={(e) =>
                  handleUpdate({
                    colorTint: [spriteData.colorTint[0], spriteData.colorTint[1], spriteData.colorTint[2], parseFloat(e.target.value)],
                  })
                }
                className="w-full rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-xs text-white"
                title="Alpha"
              />
            </div>
          </div>

          {/* Flip Controls */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={spriteData.flipX}
                onChange={(e) => handleUpdate({ flipX: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 accent-blue-500"
              />
              <span className="text-xs text-zinc-400">Flip X</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={spriteData.flipY}
                onChange={(e) => handleUpdate({ flipY: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 accent-blue-500"
              />
              <span className="text-xs text-zinc-400">Flip Y</span>
            </label>
          </div>

          {/* Custom Size */}
          <div className="mt-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={spriteData.customSize !== null}
                onChange={(e) => handleUpdate({ customSize: e.target.checked ? [1, 1] : null })}
                className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 accent-blue-500"
              />
              <span className="text-xs text-zinc-400">Custom Size</span>
            </label>
            {spriteData.customSize && (
              <div className="mt-1 flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Width</label>
                <input
                  type="number"
                  min={0.01}
                  step={0.1}
                  value={spriteData.customSize[0]}
                  onChange={(e) =>
                    handleUpdate({
                      customSize: [parseFloat(e.target.value), spriteData.customSize![1]],
                    })
                  }
                  className="flex-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-white"
                />
              </div>
            )}
            {spriteData.customSize && (
              <div className="mt-1 flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Height</label>
                <input
                  type="number"
                  min={0.01}
                  step={0.1}
                  value={spriteData.customSize[1]}
                  onChange={(e) =>
                    handleUpdate({
                      customSize: [spriteData.customSize![0], parseFloat(e.target.value)],
                    })
                  }
                  className="flex-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-white"
                />
              </div>
            )}
          </div>
        </div>

        {/* Sorting Section */}
        <div className="border-t border-zinc-800 pt-2">
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
            Sorting
          </h4>

          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Layer</label>
            <select
              value={spriteData.sortingLayer}
              onChange={(e) => handleUpdate({ sortingLayer: e.target.value })}
              className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
            >
              {sortingLayers.map((layer) => (
                <option key={layer.name} value={layer.name}>
                  {layer.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400" title="Higher order = drawn on top within the same layer">
              Order
            </label>
            <input
              type="number"
              min={-1000}
              max={1000}
              step={1}
              value={spriteData.sortingOrder}
              onChange={(e) => handleUpdate({ sortingOrder: parseInt(e.target.value, 10) })}
              className="flex-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-white"
            />
          </div>
        </div>

        {/* Anchor Section */}
        <div className="border-t border-zinc-800 pt-2">
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
            Anchor
          </h4>

          <div className="grid grid-cols-3 gap-1">
            {ANCHOR_GRID.map((row, _rowIdx) =>
              row.map((anchor, _colIdx) => {
                const isActive = spriteData.anchor === anchor;
                return (
                  <button
                    key={anchor}
                    onClick={() => handleUpdate({ anchor })}
                    className={`h-8 rounded border text-[10px] transition-colors ${
                      isActive
                        ? 'border-blue-500 bg-blue-900/30 text-blue-400'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-500 hover:border-zinc-600 hover:bg-zinc-700'
                    }`}
                    title={anchor}
                  >
                    <span className="sr-only">{anchor}</span>
                    <div className="flex h-full items-center justify-center">
                      <div className={`h-1 w-1 rounded-full ${isActive ? 'bg-blue-400' : 'bg-zinc-600'}`} />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
