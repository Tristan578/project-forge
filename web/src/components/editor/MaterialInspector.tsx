'use client';

import { useCallback, useRef } from 'react';
import { Image, X } from 'lucide-react';
import { useEditorStore, type MaterialData } from '@/stores/editorStore';

/** Convert linear RGB [0-1] to sRGB hex string. */
function linearToHex(r: number, g: number, b: number): string {
  const toSrgb = (c: number) => Math.round(Math.pow(Math.max(0, Math.min(1, c)), 1 / 2.2) * 255);
  const rr = toSrgb(r).toString(16).padStart(2, '0');
  const gg = toSrgb(g).toString(16).padStart(2, '0');
  const bb = toSrgb(b).toString(16).padStart(2, '0');
  return `#${rr}${gg}${bb}`;
}

/** Convert sRGB hex string to linear RGB [0-1] array. */
function hexToLinear(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => Math.pow(c, 2.2);
  return [toLinear(r), toLinear(g), toLinear(b)];
}

interface SliderRowProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, min = 0, max = 1, step = 0.01, onChange }: SliderRowProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-24 shrink-0 text-xs text-zinc-400">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
          [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-zinc-300"
      />
      <span className="w-10 text-right text-xs tabular-nums text-zinc-500">
        {value.toFixed(2)}
      </span>
    </div>
  );
}

interface TextureSlotProps {
  label: string;
  slot: string;
  textureRef: string | null | undefined;
  entityId: string;
}

function TextureSlot({ label, slot, textureRef, entityId }: TextureSlotProps) {
  const loadTexture = useEditorStore((s) => s.loadTexture);
  const removeTexture = useEditorStore((s) => s.removeTexture);
  const assetRegistry = useEditorStore((s) => s.assetRegistry);
  const fileRef = useRef<HTMLInputElement>(null);

  const assetName = textureRef ? assetRegistry[textureRef]?.name : null;

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      loadTexture(base64, file.name, entityId, slot);
    };
    reader.readAsDataURL(file);
  }, [loadTexture, entityId, slot]);

  return (
    <div className="flex items-center gap-2">
      <label className="w-24 shrink-0 text-xs text-zinc-400">{label}</label>
      <button
        className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        onClick={() => fileRef.current?.click()}
        title={`Select ${label.toLowerCase()} texture`}
      >
        <Image size={12} />
        <span>Select</span>
      </button>
      {textureRef && (
        <button
          className="rounded p-0.5 text-zinc-500 hover:text-red-400"
          onClick={() => removeTexture(entityId, slot)}
          title="Remove texture"
        >
          <X size={12} />
        </button>
      )}
      <span className="truncate text-[10px] text-zinc-600">
        {assetName ?? (textureRef ? textureRef.slice(0, 8) + '...' : 'none')}
      </span>
      <input
        ref={fileRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files)}
      />
    </div>
  );
}

export function MaterialInspector() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const primaryMaterial = useEditorStore((s) => s.primaryMaterial);
  const updateMaterial = useEditorStore((s) => s.updateMaterial);

  const handleUpdate = useCallback(
    (partial: Partial<MaterialData>) => {
      if (primaryId && primaryMaterial) {
        updateMaterial(primaryId, { ...primaryMaterial, ...partial });
      }
    },
    [primaryId, primaryMaterial, updateMaterial]
  );

  if (!primaryMaterial || !primaryId) return null;

  const baseColorHex = linearToHex(
    primaryMaterial.baseColor[0],
    primaryMaterial.baseColor[1],
    primaryMaterial.baseColor[2]
  );

  const emissiveHex = linearToHex(
    primaryMaterial.emissive[0],
    primaryMaterial.emissive[1],
    primaryMaterial.emissive[2]
  );

  return (
    <div className="border-t border-zinc-800 pt-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Material
      </h3>

      <div className="space-y-3">
        {/* Base Color */}
        <div className="flex items-center gap-2">
          <label className="w-24 shrink-0 text-xs text-zinc-400">Color</label>
          <input
            type="color"
            value={baseColorHex}
            onChange={(e) => {
              const [r, g, b] = hexToLinear(e.target.value);
              handleUpdate({ baseColor: [r, g, b, primaryMaterial.baseColor[3]] });
            }}
            className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
          />
          <span className="text-xs text-zinc-500">{baseColorHex}</span>
        </div>

        {/* Alpha (opacity) */}
        <SliderRow
          label="Opacity"
          value={primaryMaterial.baseColor[3]}
          onChange={(v) =>
            handleUpdate({
              baseColor: [
                primaryMaterial.baseColor[0],
                primaryMaterial.baseColor[1],
                primaryMaterial.baseColor[2],
                v,
              ],
              alphaMode: v < 1 ? 'blend' : 'opaque',
            })
          }
        />

        {/* Metallic */}
        <SliderRow
          label="Metallic"
          value={primaryMaterial.metallic}
          onChange={(v) => handleUpdate({ metallic: v })}
        />

        {/* Roughness */}
        <SliderRow
          label="Roughness"
          value={primaryMaterial.perceptualRoughness}
          onChange={(v) => handleUpdate({ perceptualRoughness: v })}
        />

        {/* Reflectance */}
        <SliderRow
          label="Reflectance"
          value={primaryMaterial.reflectance}
          onChange={(v) => handleUpdate({ reflectance: v })}
        />

        {/* Emissive */}
        <div className="flex items-center gap-2">
          <label className="w-24 shrink-0 text-xs text-zinc-400">Emissive</label>
          <input
            type="color"
            value={emissiveHex}
            onChange={(e) => {
              const [r, g, b] = hexToLinear(e.target.value);
              handleUpdate({ emissive: [r, g, b, primaryMaterial.emissive[3]] });
            }}
            className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
          />
          <span className="text-xs text-zinc-500">{emissiveHex}</span>
        </div>

        {/* Emissive intensity */}
        <SliderRow
          label="Emissive Str."
          value={primaryMaterial.emissive[3]}
          min={0}
          max={10}
          step={0.1}
          onChange={(v) =>
            handleUpdate({
              emissive: [
                primaryMaterial.emissive[0],
                primaryMaterial.emissive[1],
                primaryMaterial.emissive[2],
                v,
              ],
            })
          }
        />

        {/* Double Sided */}
        <div className="flex items-center gap-2">
          <label className="w-24 shrink-0 text-xs text-zinc-400">Double Sided</label>
          <input
            type="checkbox"
            checked={primaryMaterial.doubleSided}
            onChange={(e) => handleUpdate({ doubleSided: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
              focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
          />
        </div>

        {/* Unlit */}
        <div className="flex items-center gap-2">
          <label className="w-24 shrink-0 text-xs text-zinc-400">Unlit</label>
          <input
            type="checkbox"
            checked={primaryMaterial.unlit}
            onChange={(e) => handleUpdate({ unlit: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
              focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
          />
        </div>

        {/* Texture Slots */}
        <div className="mt-2 border-t border-zinc-800 pt-2">
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
            Textures
          </h4>
          <div className="space-y-2">
            <TextureSlot label="Base Color" slot="base_color" textureRef={primaryMaterial.baseColorTexture} entityId={primaryId} />
            <TextureSlot label="Normal Map" slot="normal_map" textureRef={primaryMaterial.normalMapTexture} entityId={primaryId} />
            <TextureSlot label="Metal/Rough" slot="metallic_roughness" textureRef={primaryMaterial.metallicRoughnessTexture} entityId={primaryId} />
            <TextureSlot label="Emissive" slot="emissive" textureRef={primaryMaterial.emissiveTexture} entityId={primaryId} />
            <TextureSlot label="Occlusion" slot="occlusion" textureRef={primaryMaterial.occlusionTexture} entityId={primaryId} />
          </div>
        </div>
      </div>
    </div>
  );
}
