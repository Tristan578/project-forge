'use client';

import { useState, useCallback, useMemo, memo } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import {
  generateAnimation,
  animationToClipData,
  getAnimationTypeInfo,
  ANIMATION_TYPES,
  type AnimationType,
  type AnimationParams,
  type ProceduralAnimation,
} from '@/lib/ai/proceduralAnimation';

// ---------------------------------------------------------------------------
// Animation type metadata for the selector grid
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<AnimationType, string> = {
  walk: '\u{1F6B6}',
  run: '\u{1F3C3}',
  idle: '\u{1F9D8}',
  jump: '\u{1F938}',
  attack_melee: '\u{2694}\uFE0F',
  attack_ranged: '\u{1F3F9}',
  death: '\u{1F480}',
  hit_react: '\u{1F4A5}',
  climb: '\u{1FA78}',
  swim: '\u{1F3CA}',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ProceduralAnimPanel = memo(function ProceduralAnimPanel() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const addClipKeyframe = useEditorStore((s) => s.addClipKeyframe);
  const createAnimationClip = useEditorStore((s) => s.createAnimationClip);
  const setClipProperty = useEditorStore((s) => s.setClipProperty);
  const skeletons2d = useEditorStore((s) => s.skeletons2d);

  const [selectedType, setSelectedType] = useState<AnimationType>('walk');
  const [speed, setSpeed] = useState(1);
  const [amplitude, setAmplitude] = useState(1);
  const [style, setStyle] = useState<AnimationParams['style']>('realistic');
  const [generatedAnim, setGeneratedAnim] = useState<ProceduralAnimation | null>(null);

  // Derive bone names from skeleton data or use a default humanoid set
  const boneNames = useMemo(() => {
    if (primaryId && skeletons2d[primaryId]) {
      const skel = skeletons2d[primaryId];
      if (skel.bones && Array.isArray(skel.bones)) {
        return skel.bones.map((b: { name: string }) => b.name);
      }
    }
    // Default humanoid skeleton for 3D entities
    return [
      'hips', 'spine', 'head', 'neck',
      'left_arm', 'left_forearm', 'left_hand',
      'right_arm', 'right_forearm', 'right_hand',
      'left_leg', 'left_shin', 'left_foot',
      'right_leg', 'right_shin', 'right_foot',
    ];
  }, [primaryId, skeletons2d]);

  const typeInfo = useMemo(() => getAnimationTypeInfo(selectedType), [selectedType]);

  const handleGenerate = useCallback(() => {
    const params: AnimationParams = { speed, amplitude, style, weight: 1 };
    const anim = generateAnimation(selectedType, boneNames, params);
    setGeneratedAnim(anim);
  }, [selectedType, boneNames, speed, amplitude, style]);

  const handleApply = useCallback(() => {
    if (!primaryId || !generatedAnim) return;

    const clip = animationToClipData(generatedAnim);

    // Create the clip on the entity
    createAnimationClip(primaryId, clip.duration, clip.playMode);

    // Add all keyframes
    for (const track of clip.tracks) {
      for (const kf of track.keyframes) {
        addClipKeyframe(primaryId, track.target, kf.time, kf.value, kf.interpolation);
      }
    }

    // Set properties
    setClipProperty(primaryId, clip.duration, clip.playMode, clip.speed, clip.autoplay);
  }, [primaryId, generatedAnim, createAnimationClip, addClipKeyframe, setClipProperty]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-900 text-zinc-200">
      {/* Header */}
      <div className="border-b border-zinc-700 p-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Procedural Animation
        </h2>
        {!primaryId && (
          <p className="mt-1 text-xs text-zinc-500">Select an entity to generate animations</p>
        )}
      </div>

      {/* Animation type selector grid */}
      <div className="border-b border-zinc-700 p-3">
        <label className="mb-2 block text-xs font-medium text-zinc-400">Animation Type</label>
        <div className="grid grid-cols-5 gap-1.5">
          {ANIMATION_TYPES.map((type) => {
            const info = getAnimationTypeInfo(type);
            return (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`flex flex-col items-center rounded p-1.5 text-center transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  selectedType === type
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
                title={info.description}
                aria-label={`Select ${info.label} animation`}
              >
                <span className="text-lg" aria-hidden="true">{TYPE_ICONS[type]}</span>
                <span className="mt-0.5 text-[10px] leading-tight">{info.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-zinc-500">{typeInfo.description}</p>
        <div className="mt-1 flex gap-3 text-xs text-zinc-500">
          <span>Duration: {typeInfo.defaultDuration}s</span>
          <span>{typeInfo.looping ? 'Looping' : 'One-shot'}</span>
        </div>
      </div>

      {/* Style & parameters */}
      <div className="space-y-3 border-b border-zinc-700 p-3">
        <div>
          <label htmlFor="proc-anim-style" className="mb-1 block text-xs font-medium text-zinc-400">
            Style
          </label>
          <select
            id="proc-anim-style"
            value={style}
            onChange={(e) => setStyle(e.target.value as AnimationParams['style'])}
            className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="realistic">Realistic</option>
            <option value="cartoon">Cartoon</option>
            <option value="mechanical">Mechanical</option>
            <option value="ethereal">Ethereal</option>
          </select>
        </div>

        <div>
          <label htmlFor="proc-anim-speed" className="mb-1 block text-xs font-medium text-zinc-400">
            Speed: {speed.toFixed(1)}x
          </label>
          <input
            id="proc-anim-speed"
            type="range"
            min="0.2"
            max="3"
            step="0.1"
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="w-full accent-blue-500"
          />
        </div>

        <div>
          <label htmlFor="proc-anim-amplitude" className="mb-1 block text-xs font-medium text-zinc-400">
            Amplitude: {amplitude.toFixed(1)}x
          </label>
          <input
            id="proc-anim-amplitude"
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={amplitude}
            onChange={(e) => setAmplitude(parseFloat(e.target.value))}
            className="w-full accent-blue-500"
          />
        </div>
      </div>

      {/* Bone mapping display */}
      <div className="border-b border-zinc-700 p-3">
        <label className="mb-1 block text-xs font-medium text-zinc-400">
          Bones ({boneNames.length})
        </label>
        <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
          {boneNames.map((name) => (
            <span
              key={name}
              className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400"
            >
              {name}
            </span>
          ))}
        </div>
      </div>

      {/* Generate button */}
      <div className="p-3">
        <button
          onClick={handleGenerate}
          disabled={!primaryId}
          className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Generate procedural animation"
        >
          Generate Animation
        </button>
      </div>

      {/* Generated animation preview */}
      {generatedAnim && (
        <div className="border-t border-zinc-700 p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-400">Generated</h3>
          <div className="space-y-1 text-xs text-zinc-300">
            <p>Name: {generatedAnim.name}</p>
            <p>Duration: {generatedAnim.duration.toFixed(2)}s</p>
            <p>Keyframes: {generatedAnim.keyframes.length}</p>
            <p>Loop: {generatedAnim.loop ? 'Yes' : 'No'}</p>
            <p>Blend in/out: {generatedAnim.blendIn.toFixed(2)}s / {generatedAnim.blendOut.toFixed(2)}s</p>
          </div>

          {/* Timeline preview */}
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-zinc-400">Keyframe Timeline</label>
            <div className="relative h-4 rounded bg-zinc-800">
              {generatedAnim.keyframes.map((kf, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full w-0.5 rounded bg-blue-400"
                  style={{ left: `${kf.time * 100}%` }}
                  title={`t=${kf.time.toFixed(2)}`}
                />
              ))}
            </div>
          </div>

          {/* Apply button */}
          <button
            onClick={handleApply}
            disabled={!primaryId}
            className="mt-3 w-full rounded bg-green-600 px-3 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-green-500 focus:outline-none focus:ring-2 focus:ring-green-400 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Apply generated animation to selected entity"
          >
            Apply to Entity
          </button>
        </div>
      )}
    </div>
  );
});
