'use client';

import { useCallback, useRef, useState, useMemo, memo } from 'react';
import { Image as ImageIcon, X, ChevronDown, ChevronRight, BookmarkPlus, Sparkles, HelpCircle } from 'lucide-react';
import { useEditorStore, type MaterialData } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { MATERIAL_PRESETS, ALL_CATEGORIES, getPresetById, saveCustomMaterial, type MaterialPreset } from '@/lib/materialPresets';
import { GenerateTextureDialog } from './GenerateTextureDialog';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

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
  tooltipTerm?: string;
  tooltipText?: string;
}

function SliderRow({ label, value, min = 0, max = 1, step = 0.01, onChange, tooltipTerm, tooltipText }: SliderRowProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-20 shrink-0 text-xs text-zinc-400">
        {label}
        {tooltipTerm && <InfoTooltip term={tooltipTerm} />}
        {tooltipText && <InfoTooltip text={tooltipText} />}
      </label>
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
  tooltipTerm?: string;
}

function TextureSlot({ label, slot, textureRef, entityId, tooltipTerm }: TextureSlotProps) {
  const loadTexture = useEditorStore((s) => s.loadTexture);
  const removeTexture = useEditorStore((s) => s.removeTexture);
  const assetRegistry = useEditorStore((s) => s.assetRegistry);
  const fileRef = useRef<HTMLInputElement>(null);

  const assetName = textureRef ? assetRegistry[textureRef]?.name : null;

  // Get available texture assets from registry
  const textureAssets = useMemo(
    () => Object.values(assetRegistry).filter((a) => a.kind === 'texture'),
    [assetRegistry]
  );

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

  const handleSelectChange = useCallback((value: string) => {
    if (value === '__upload__') {
      fileRef.current?.click();
    } else if (value === '__none__') {
      removeTexture(entityId, slot);
    } else {
      // value is an asset ID — load it into this slot
      // For existing assets, we fire loadTexture with the asset's data
      // But the asset is already loaded; we need to assign it to this slot
      // The texture is referenced by asset ID
      loadTexture('', value, entityId, slot);
    }
  }, [loadTexture, removeTexture, entityId, slot]);

  return (
    <div className="flex items-center gap-2">
      <label className="w-20 shrink-0 text-xs text-zinc-400">
        {label}
        {tooltipTerm && <InfoTooltip term={tooltipTerm} />}
      </label>
      {textureAssets.length > 0 ? (
        <>
          <select
            value={textureRef ?? '__none__'}
            onChange={(e) => handleSelectChange(e.target.value)}
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300"
          >
            <option value="__none__">None</option>
            {textureAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>{asset.name}</option>
            ))}
            <option value="__upload__">Upload new...</option>
          </select>
          {textureRef && (
            <button
              className="shrink-0 rounded p-0.5 text-zinc-500 hover:text-red-400"
              onClick={() => removeTexture(entityId, slot)}
              title="Remove texture"
            >
              <X size={12} />
            </button>
          )}
        </>
      ) : (
        <>
          <button
            className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            onClick={() => fileRef.current?.click()}
            title={`Upload ${label.toLowerCase()} texture`}
          >
            <ImageIcon size={12} />
            <span>Upload</span>
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
        </>
      )}
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

function CollapsibleSection({ title, children, defaultOpen = false }: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-2 border-t border-zinc-800 pt-2">
      <button
        className="mb-2 flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 hover:text-zinc-400"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {title}
      </button>
      {open && <div className="space-y-2">{children}</div>}
    </div>
  );
}

function PresetSelector({ onApply, onSaveToLibrary }: { onApply: (preset: MaterialPreset) => void; onSaveToLibrary: () => void }) {
  const [selectedId, setSelectedId] = useState<string>('');

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="w-20 shrink-0 text-xs text-zinc-400">Preset<InfoTooltip term="materialPreset" /></label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300"
        >
          <option value="">(Custom)</option>
          {ALL_CATEGORIES.map((cat) => {
            const presets = MATERIAL_PRESETS.filter((p) => p.category === cat);
            if (presets.length === 0) return null;
            return (
              <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </div>
      <div className="flex items-center gap-2 pl-20">
        <button
          className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:border-blue-500 hover:text-blue-400 disabled:opacity-40 transition-colors"
          disabled={!selectedId}
          onClick={() => {
            const preset = getPresetById(selectedId);
            if (preset) {
              onApply(preset);
              setSelectedId('');
            }
          }}
        >
          Apply Preset
        </button>
        <button
          className="shrink-0 rounded border border-zinc-700 bg-zinc-800 p-1 text-zinc-400 hover:border-zinc-500 hover:text-purple-400"
          onClick={onSaveToLibrary}
          title="Save current material to library"
        >
          <BookmarkPlus size={12} />
        </button>
      </div>
    </div>
  );
}

/** IOR reference labels */
const IOR_HINTS: Record<string, number> = {
  'Air': 1.0, 'Water': 1.33, 'Ice': 1.45, 'Glass': 1.5, 'Sapphire': 1.77, 'Diamond': 2.42,
};

export const MaterialInspector = memo(function MaterialInspector() {
  const [generateTextureOpen, setGenerateTextureOpen] = useState(false);

  const primaryId = useEditorStore((s) => s.primaryId);
  const primaryMaterial = useEditorStore((s) => s.primaryMaterial);
  const updateMaterial = useEditorStore((s) => s.updateMaterial);
  const primaryShaderEffect = useEditorStore((s) => s.primaryShaderEffect);
  const updateShaderEffect = useEditorStore((s) => s.updateShaderEffect);
  const removeShaderEffect = useEditorStore((s) => s.removeShaderEffect);
  const navigateDocs = useWorkspaceStore((s) => s.navigateDocs);

  const handleUpdate = useCallback(
    (partial: Partial<MaterialData>) => {
      if (primaryId && primaryMaterial) {
        updateMaterial(primaryId, { ...primaryMaterial, ...partial });
      }
    },
    [primaryId, primaryMaterial, updateMaterial]
  );

  const handleApplyPreset = useCallback(
    (preset: MaterialPreset) => {
      if (primaryId) {
        updateMaterial(primaryId, preset.data);
      }
    },
    [primaryId, updateMaterial]
  );

  const handleSaveToLibrary = useCallback(() => {
    if (!primaryMaterial) return;
    const name = window.prompt('Material name:');
    if (name && name.trim()) {
      saveCustomMaterial(name.trim(), primaryMaterial);
    }
  }, [primaryMaterial]);

  const handleShaderTypeChange = useCallback((newType: string) => {
    if (!primaryId) return;
    if (newType === 'none') {
      removeShaderEffect(primaryId);
    } else {
      // Apply default values for the selected shader
      updateShaderEffect(primaryId, {
        shaderType: newType,
        customColor: [1, 0.5, 0.2, 1],
        noiseScale: 5.0,
        emissionStrength: 2.0,
        dissolveThreshold: 0.5,
        dissolveEdgeWidth: 0.05,
        scanLineFrequency: 50.0,
        scanLineSpeed: 2.0,
        scrollSpeed: [0.1, 0.2],
        distortionStrength: 0.1,
        toonBands: 4,
        fresnelPower: 3.0,
      });
    }
  }, [primaryId, updateShaderEffect, removeShaderEffect]);

  const handleShaderParamChange = useCallback((param: string, value: unknown) => {
    if (!primaryId || !primaryShaderEffect) return;
    updateShaderEffect(primaryId, {
      ...primaryShaderEffect,
      [param]: value,
    });
  }, [primaryId, primaryShaderEffect, updateShaderEffect]);

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

  const attColorHex = primaryMaterial.attenuationColor
    ? linearToHex(primaryMaterial.attenuationColor[0], primaryMaterial.attenuationColor[1], primaryMaterial.attenuationColor[2])
    : '#ffffff';

  const shaderType = primaryShaderEffect?.shaderType ?? 'none';

  return (
    <div className="border-t border-zinc-800 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Material
        </h3>
        <button onClick={() => navigateDocs('features/materials')} className="rounded p-0.5 text-zinc-600 hover:text-zinc-400" title="Documentation">
          <HelpCircle size={12} />
        </button>
      </div>

      <div className="space-y-3">
        {/* Shader Effect */}
        <CollapsibleSection title="Shader Effect" defaultOpen={shaderType !== 'none'}>
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Type<InfoTooltip term="shaderType" /></label>
            <select
              value={shaderType}
              onChange={(e) => handleShaderTypeChange(e.target.value)}
              className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300"
            >
              <option value="none">Standard PBR</option>
              <option value="dissolve">Dissolve</option>
              <option value="hologram">Hologram</option>
              <option value="force_field">Force Field</option>
              <option value="lava_flow">Lava / Flow</option>
              <option value="toon">Toon</option>
              <option value="fresnel_glow">Fresnel Glow</option>
            </select>
          </div>

          {shaderType !== 'none' && primaryShaderEffect && (
            <>
              {/* Common params */}
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Color<InfoTooltip text="The color applied to this shader effect" /></label>
                <input
                  type="color"
                  value={linearToHex(primaryShaderEffect.customColor[0], primaryShaderEffect.customColor[1], primaryShaderEffect.customColor[2])}
                  onChange={(e) => {
                    const [r, g, b] = hexToLinear(e.target.value);
                    handleShaderParamChange('customColor', [r, g, b, primaryShaderEffect.customColor[3]]);
                  }}
                  className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
                />
              </div>
              <SliderRow
                label="Emission"
                value={primaryShaderEffect.emissionStrength}
                min={0}
                max={10}
                step={0.1}
                onChange={(v) => handleShaderParamChange('emissionStrength', v)}
                tooltipTerm="shaderEmission"
              />

              {/* Dissolve-specific */}
              {shaderType === 'dissolve' && (
                <>
                  <SliderRow label="Threshold" value={primaryShaderEffect.dissolveThreshold} min={0} max={1} step={0.01} onChange={(v) => handleShaderParamChange('dissolveThreshold', v)} tooltipTerm="dissolveThreshold" />
                  <SliderRow label="Edge Width" value={primaryShaderEffect.dissolveEdgeWidth} min={0} max={0.2} step={0.005} onChange={(v) => handleShaderParamChange('dissolveEdgeWidth', v)} tooltipTerm="dissolveEdgeWidth" />
                  <SliderRow label="Noise Scale" value={primaryShaderEffect.noiseScale} min={0.5} max={20} step={0.5} onChange={(v) => handleShaderParamChange('noiseScale', v)} tooltipTerm="noiseScale" />
                </>
              )}

              {/* Hologram-specific */}
              {shaderType === 'hologram' && (
                <>
                  <SliderRow label="Scan Freq" value={primaryShaderEffect.scanLineFrequency} min={10} max={200} step={1} onChange={(v) => handleShaderParamChange('scanLineFrequency', v)} tooltipTerm="scanFreq" />
                  <SliderRow label="Scan Speed" value={primaryShaderEffect.scanLineSpeed} min={0.5} max={10} step={0.1} onChange={(v) => handleShaderParamChange('scanLineSpeed', v)} tooltipTerm="scanSpeed" />
                </>
              )}

              {/* Force Field-specific */}
              {shaderType === 'force_field' && (
                <>
                  <SliderRow label="Fresnel" value={primaryShaderEffect.fresnelPower} min={1} max={10} step={0.1} onChange={(v) => handleShaderParamChange('fresnelPower', v)} tooltipTerm="fresnelPower" />
                  <SliderRow label="Noise Scale" value={primaryShaderEffect.noiseScale} min={0.5} max={20} step={0.5} onChange={(v) => handleShaderParamChange('noiseScale', v)} tooltipTerm="noiseScale" />
                </>
              )}

              {/* Lava/Flow-specific */}
              {shaderType === 'lava_flow' && (
                <>
                  <SliderRow label="Scroll X" value={primaryShaderEffect.scrollSpeed[0]} min={-2} max={2} step={0.1} onChange={(v) => handleShaderParamChange('scrollSpeed', [v, primaryShaderEffect.scrollSpeed[1]])} tooltipTerm="scrollX" />
                  <SliderRow label="Scroll Y" value={primaryShaderEffect.scrollSpeed[1]} min={-2} max={2} step={0.1} onChange={(v) => handleShaderParamChange('scrollSpeed', [primaryShaderEffect.scrollSpeed[0], v])} tooltipTerm="scrollY" />
                  <SliderRow label="Distortion" value={primaryShaderEffect.distortionStrength} min={0} max={1} step={0.01} onChange={(v) => handleShaderParamChange('distortionStrength', v)} tooltipTerm="distortion" />
                  <SliderRow label="Noise Scale" value={primaryShaderEffect.noiseScale} min={0.5} max={20} step={0.5} onChange={(v) => handleShaderParamChange('noiseScale', v)} tooltipTerm="noiseScale" />
                </>
              )}

              {/* Toon-specific */}
              {shaderType === 'toon' && (
                <SliderRow label="Bands" value={primaryShaderEffect.toonBands} min={2} max={8} step={1} onChange={(v) => handleShaderParamChange('toonBands', v)} tooltipTerm="toonBands" />
              )}

              {/* Fresnel Glow-specific */}
              {shaderType === 'fresnel_glow' && (
                <SliderRow label="Fresnel" value={primaryShaderEffect.fresnelPower} min={1} max={10} step={0.1} onChange={(v) => handleShaderParamChange('fresnelPower', v)} tooltipTerm="fresnelPower" />
              )}
            </>
          )}
        </CollapsibleSection>

        {/* Preset Selector */}
        <PresetSelector onApply={handleApplyPreset} onSaveToLibrary={handleSaveToLibrary} />


        {/* Base Color */}
        <div className="flex items-center gap-2">
          <label className="w-20 shrink-0 text-xs text-zinc-400">Color<InfoTooltip term="baseColor" /></label>
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
          tooltipTerm="opacity"
        />

        {/* Metallic */}
        <div className="flex items-center gap-2">
          <label className="w-20 shrink-0 text-xs text-zinc-400">Metallic<InfoTooltip term="metallic" /></label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={primaryMaterial.metallic}
            onChange={(e) => handleUpdate({ metallic: parseFloat(e.target.value) })}
            className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
              [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-zinc-300"
          />
          <span className="w-10 text-right text-xs tabular-nums text-zinc-500">
            {primaryMaterial.metallic.toFixed(2)}
          </span>
        </div>

        {/* Roughness */}
        <div className="flex items-center gap-2">
          <label className="w-20 shrink-0 text-xs text-zinc-400">Roughness<InfoTooltip term="roughness" /></label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={primaryMaterial.perceptualRoughness}
            onChange={(e) => handleUpdate({ perceptualRoughness: parseFloat(e.target.value) })}
            className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
              [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-zinc-300"
          />
          <span className="w-10 text-right text-xs tabular-nums text-zinc-500">
            {primaryMaterial.perceptualRoughness.toFixed(2)}
          </span>
        </div>

        {/* Reflectance */}
        <div className="flex items-center gap-2">
          <label className="w-20 shrink-0 text-xs text-zinc-400">Reflectance<InfoTooltip term="reflectance" /></label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={primaryMaterial.reflectance}
            onChange={(e) => handleUpdate({ reflectance: parseFloat(e.target.value) })}
            className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
              [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-zinc-300"
          />
          <span className="w-10 text-right text-xs tabular-nums text-zinc-500">
            {primaryMaterial.reflectance.toFixed(2)}
          </span>
        </div>

        {/* Emissive */}
        <div className="flex items-center gap-2">
          <label className="w-20 shrink-0 text-xs text-zinc-400">Emissive<InfoTooltip term="emissive" /></label>
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
          tooltipTerm="emissiveStrength"
        />

        {/* Double Sided */}
        <div className="flex items-center gap-2">
          <label className="w-20 shrink-0 text-xs text-zinc-400">Double Sided<InfoTooltip term="doubleSided" /></label>
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
          <label className="w-20 shrink-0 text-xs text-zinc-400">Unlit<InfoTooltip term="unlit" /></label>
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
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
              Textures<InfoTooltip term="textures" />
            </h4>
            <button
              onClick={() => setGenerateTextureOpen(true)}
              className="flex items-center gap-1 rounded bg-purple-900/30 px-2 py-0.5 text-[10px] text-purple-400 hover:bg-purple-900/50"
              title="Generate texture with AI"
            >
              <Sparkles size={10} />
              Generate
            </button>
          </div>
          <div className="space-y-2">
            <TextureSlot label="Base Color" slot="base_color" textureRef={primaryMaterial.baseColorTexture} entityId={primaryId} tooltipTerm="baseColorTexture" />
            <TextureSlot label="Normal Map" slot="normal_map" textureRef={primaryMaterial.normalMapTexture} entityId={primaryId} tooltipTerm="normalMap" />
            <TextureSlot label="Metal/Rough" slot="metallic_roughness" textureRef={primaryMaterial.metallicRoughnessTexture} entityId={primaryId} tooltipTerm="metalRoughTexture" />
            <TextureSlot label="Emissive" slot="emissive" textureRef={primaryMaterial.emissiveTexture} entityId={primaryId} tooltipTerm="emissiveTexture" />
            <TextureSlot label="Occlusion" slot="occlusion" textureRef={primaryMaterial.occlusionTexture} entityId={primaryId} tooltipTerm="occlusionTexture" />
          </div>
        </div>

        {/* UV Transform (E-1a) */}
        <CollapsibleSection title="UV Transform">
          <SliderRow label="Offset X" value={primaryMaterial.uvOffset?.[0] ?? 0} min={-10} max={10} step={0.01} onChange={(v) => handleUpdate({ uvOffset: [v, primaryMaterial.uvOffset?.[1] ?? 0] })} tooltipTerm="uvOffsetX" />
          <SliderRow label="Offset Y" value={primaryMaterial.uvOffset?.[1] ?? 0} min={-10} max={10} step={0.01} onChange={(v) => handleUpdate({ uvOffset: [primaryMaterial.uvOffset?.[0] ?? 0, v] })} tooltipTerm="uvOffsetY" />
          <SliderRow label="Scale X" value={primaryMaterial.uvScale?.[0] ?? 1} min={0.01} max={20} step={0.01} onChange={(v) => handleUpdate({ uvScale: [v, primaryMaterial.uvScale?.[1] ?? 1] })} tooltipTerm="uvScaleX" />
          <SliderRow label="Scale Y" value={primaryMaterial.uvScale?.[1] ?? 1} min={0.01} max={20} step={0.01} onChange={(v) => handleUpdate({ uvScale: [primaryMaterial.uvScale?.[0] ?? 1, v] })} tooltipTerm="uvScaleY" />
          <SliderRow
            label="Rotation"
            value={Math.round((primaryMaterial.uvRotation ?? 0) * 180 / Math.PI)}
            min={0} max={360} step={1}
            onChange={(v) => handleUpdate({ uvRotation: v * Math.PI / 180 })}
            tooltipTerm="uvRotation"
          />
        </CollapsibleSection>

        {/* Parallax Mapping (E-1b) */}
        <CollapsibleSection title="Parallax Mapping">
          <TextureSlot label="Depth Map" slot="depth_map" textureRef={primaryMaterial.depthMapTexture} entityId={primaryId} tooltipTerm="depthMap" />
          <SliderRow label="Depth Scale" value={primaryMaterial.parallaxDepthScale ?? 0.1} min={0} max={0.5} step={0.005} onChange={(v) => handleUpdate({ parallaxDepthScale: v })} tooltipTerm="depthScale" />
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Method<InfoTooltip term="parallaxMethod" /></label>
            <select
              value={primaryMaterial.parallaxMappingMethod ?? 'occlusion'}
              onChange={(e) => handleUpdate({ parallaxMappingMethod: e.target.value as 'occlusion' | 'relief' })}
              className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300"
            >
              <option value="occlusion">Occlusion</option>
              <option value="relief">Relief</option>
            </select>
          </div>
          <SliderRow label="Max Layers" value={primaryMaterial.maxParallaxLayerCount ?? 16} min={1} max={128} step={1} onChange={(v) => handleUpdate({ maxParallaxLayerCount: v })} tooltipTerm="parallaxMaxLayers" />
          {(primaryMaterial.parallaxMappingMethod === 'relief') && (
            <SliderRow label="Relief Steps" value={primaryMaterial.parallaxReliefMaxSteps ?? 5} min={1} max={32} step={1} onChange={(v) => handleUpdate({ parallaxReliefMaxSteps: v })} tooltipTerm="parallaxReliefSteps" />
          )}
        </CollapsibleSection>

        {/* Clearcoat (E-1c) */}
        <CollapsibleSection title="Clearcoat">
          <SliderRow label="Intensity" value={primaryMaterial.clearcoat ?? 0} onChange={(v) => handleUpdate({ clearcoat: v })} tooltipTerm="clearcoatIntensity" />
          <SliderRow label="Roughness" value={primaryMaterial.clearcoatPerceptualRoughness ?? 0.5} onChange={(v) => handleUpdate({ clearcoatPerceptualRoughness: v })} tooltipTerm="clearcoatRoughness" />
          <TextureSlot label="Coat Map" slot="clearcoat" textureRef={primaryMaterial.clearcoatTexture} entityId={primaryId} tooltipTerm="clearcoatMap" />
          <TextureSlot label="Rough Map" slot="clearcoat_roughness" textureRef={primaryMaterial.clearcoatRoughnessTexture} entityId={primaryId} tooltipTerm="clearcoatRoughMap" />
          <TextureSlot label="Normal Map" slot="clearcoat_normal" textureRef={primaryMaterial.clearcoatNormalTexture} entityId={primaryId} tooltipTerm="clearcoatNormal" />
        </CollapsibleSection>

        {/* Transmission (E-1d) */}
        <CollapsibleSection title="Transmission">
          <SliderRow label="Specular" value={primaryMaterial.specularTransmission ?? 0} onChange={(v) => handleUpdate({ specularTransmission: v })} tooltipTerm="specularTransmission" />
          <SliderRow label="Diffuse" value={primaryMaterial.diffuseTransmission ?? 0} onChange={(v) => handleUpdate({ diffuseTransmission: v })} tooltipTerm="diffuseTransmission" />
          <div>
            <SliderRow label="IOR" value={primaryMaterial.ior ?? 1.5} min={1.0} max={3.0} step={0.01} onChange={(v) => handleUpdate({ ior: v })} tooltipTerm="ior" />
            <div className="ml-24 mt-0.5 flex flex-wrap gap-x-2 text-[9px] text-zinc-600">
              {Object.entries(IOR_HINTS).map(([name, val]) => (
                <span key={name}>{name} {val}</span>
              ))}
            </div>
          </div>
          <SliderRow label="Thickness" value={primaryMaterial.thickness ?? 0} min={0} max={10} step={0.01} onChange={(v) => handleUpdate({ thickness: v })} tooltipTerm="transmissionThickness" />
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Atten. Dist.<InfoTooltip term="attenuationDist" /></label>
            <input
              type="checkbox"
              checked={primaryMaterial.attenuationDistance == null}
              onChange={(e) => handleUpdate({ attenuationDistance: e.target.checked ? null : 10 })}
              className="h-3 w-3 rounded border-zinc-600 bg-zinc-800 text-blue-500"
              title="Infinite attenuation distance"
            />
            <span className="text-[10px] text-zinc-500">Infinite</span>
            {primaryMaterial.attenuationDistance != null && (
              <input
                type="range"
                min={0.01}
                max={1000}
                step={0.1}
                value={primaryMaterial.attenuationDistance}
                onChange={(e) => handleUpdate({ attenuationDistance: parseFloat(e.target.value) })}
                className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
                  [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-zinc-300"
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-zinc-400">Atten. Color<InfoTooltip term="attenuationColor" /></label>
            <input
              type="color"
              value={attColorHex}
              onChange={(e) => {
                const [r, g, b] = hexToLinear(e.target.value);
                handleUpdate({ attenuationColor: [r, g, b] });
              }}
              className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
            />
            <span className="text-xs text-zinc-500">{attColorHex}</span>
          </div>
          {/* Tooltip warning for alpha mode */}
          {(primaryMaterial.specularTransmission ?? 0) > 0 && primaryMaterial.alphaMode === 'opaque' && (
            <p className="ml-24 text-[10px] text-amber-500">
              Tip: Set alpha mode to Blend for correct transmission rendering.
            </p>
          )}
        </CollapsibleSection>
      </div>

      {/* Generation dialog */}
      {primaryId && (
        <GenerateTextureDialog
          isOpen={generateTextureOpen}
          onClose={() => setGenerateTextureOpen(false)}
          entityId={primaryId}
        />
      )}
    </div>
  );
});
