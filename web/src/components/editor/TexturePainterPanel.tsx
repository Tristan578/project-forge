'use client';

import { useState, useCallback } from 'react';
import { Paintbrush, Check } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { getCommandDispatcher } from '@/stores/editorStore';
import {
  TEXTURE_STYLES,
  VALID_TEXTURE_SLOTS,
  VALID_BLEND_MODES,
  generateTexturePrompt,
  applyMaterialChanges,
  clampIntensity,
  type TextureSlot,
  type BlendMode,
  type TextureStyle,
} from '@/lib/ai/texturePainter';

const SLOT_LABELS: Record<TextureSlot, string> = {
  base_color: 'Base Color',
  normal: 'Normal',
  metallic_roughness: 'Metallic/Roughness',
  emissive: 'Emissive',
  occlusion: 'Occlusion',
};

const BLEND_LABELS: Record<BlendMode, string> = {
  replace: 'Replace',
  overlay: 'Overlay',
  multiply: 'Multiply',
  add: 'Add',
};

export function TexturePainterPanel() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const primaryMaterial = useEditorStore((s) => s.primaryMaterial);

  const [selectedStyle, setSelectedStyle] = useState<TextureStyle | null>(null);
  const [description, setDescription] = useState('');
  const [intensity, setIntensity] = useState(0.7);
  const [targetSlot, setTargetSlot] = useState<TextureSlot>('base_color');
  const [blendMode, setBlendMode] = useState<BlendMode>('replace');
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);

  const handleApply = useCallback(() => {
    if (!primaryId) return;

    const dispatch = getCommandDispatcher();
    if (!dispatch) return;

    const clampedIntensity = clampIntensity(intensity);

    // Generate prompt for texture generation
    const prompt = generateTexturePrompt(
      {
        description: description || selectedStyle?.description || 'custom texture',
        targetSlot,
        intensity: clampedIntensity,
        blendMode,
      },
      selectedStyle ?? undefined,
    );
    setLastPrompt(prompt);

    // Apply material changes if a style is selected
    if (selectedStyle) {
      const currentBaseColor = primaryMaterial?.baseColor
        ? [primaryMaterial.baseColor[0], primaryMaterial.baseColor[1], primaryMaterial.baseColor[2], primaryMaterial.baseColor[3] ?? 1] as [number, number, number, number]
        : undefined;
      const emissiveRgb = primaryMaterial?.emissive;
      const currentEmissive = emissiveRgb
        ? Math.max(emissiveRgb[0], emissiveRgb[1], emissiveRgb[2])
        : 0.0;
      applyMaterialChanges(
        selectedStyle, primaryId, dispatch, clampedIntensity, currentBaseColor,
        primaryMaterial?.perceptualRoughness ?? 0.5,
        primaryMaterial?.metallic ?? 0.0,
        currentEmissive,
      );
    }
  }, [primaryId, description, selectedStyle, targetSlot, intensity, blendMode, primaryMaterial]);

  if (!primaryId) {
    return (
      <div className="p-4 text-sm text-zinc-400">
        Select an entity to paint textures.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-200">
        <Paintbrush className="h-4 w-4" />
        AI Texture Painter
      </div>

      {/* Style gallery */}
      <div className="mb-3">
        <label className="mb-1.5 block text-xs font-medium text-zinc-400">Style Presets</label>
        <div className="grid grid-cols-3 gap-1.5">
          {TEXTURE_STYLES.map((style) => (
            <button
              key={style.name}
              onClick={() => setSelectedStyle(selectedStyle?.name === style.name ? null : style)}
              className={`rounded border px-2 py-1.5 text-left text-xs transition-colors ${
                selectedStyle?.name === style.name
                  ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                  : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600'
              }`}
              title={style.description}
            >
              {style.name.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        {selectedStyle && (
          <p className="mt-1.5 text-xs text-zinc-400">{selectedStyle.description}</p>
        )}
      </div>

      {/* Description input */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-zinc-400">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the texture you want..."
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
          rows={2}
        />
      </div>

      {/* Target slot */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-zinc-400">
          Target Map
        </label>
        <select
          value={targetSlot}
          onChange={(e) => setTargetSlot(e.target.value as TextureSlot)}
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 focus:border-blue-500 focus:outline-none"
        >
          {VALID_TEXTURE_SLOTS.map((slot) => (
            <option key={slot} value={slot}>
              {SLOT_LABELS[slot]}
            </option>
          ))}
        </select>
      </div>

      {/* Blend mode */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-zinc-400">
          Blend Mode
        </label>
        <select
          value={blendMode}
          onChange={(e) => setBlendMode(e.target.value as BlendMode)}
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 focus:border-blue-500 focus:outline-none"
        >
          {VALID_BLEND_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {BLEND_LABELS[mode]}
            </option>
          ))}
        </select>
      </div>

      {/* Intensity slider */}
      <div className="mb-4">
        <label className="mb-1 flex items-center justify-between text-xs font-medium text-zinc-400">
          <span>Intensity</span>
          <span className="text-zinc-400">{Math.round(intensity * 100)}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
          className="w-full accent-blue-500"
        />
      </div>

      {/* Apply button */}
      <button
        onClick={handleApply}
        disabled={!primaryId || (!description && !selectedStyle)}
        className="flex items-center justify-center gap-1.5 rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Check className="h-3.5 w-3.5" />
        Apply Texture Style
      </button>

      {/* Generated prompt display */}
      {lastPrompt && (
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-zinc-400">
            Generated Prompt
          </label>
          <div className="rounded border border-zinc-700 bg-zinc-800/50 p-2 text-xs text-zinc-400">
            {lastPrompt}
          </div>
        </div>
      )}
    </div>
  );
}
