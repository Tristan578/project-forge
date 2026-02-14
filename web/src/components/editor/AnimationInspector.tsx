'use client';

import { useCallback, useState } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { Play, Pause, Square, RotateCcw } from 'lucide-react';

export function AnimationInspector() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const animation = useEditorStore((s) => s.primaryAnimation);
  const playAnimation = useEditorStore((s) => s.playAnimation);
  const pauseAnimation = useEditorStore((s) => s.pauseAnimation);
  const resumeAnimation = useEditorStore((s) => s.resumeAnimation);
  const stopAnimation = useEditorStore((s) => s.stopAnimation);
  const seekAnimation = useEditorStore((s) => s.seekAnimation);
  const setAnimationSpeed = useEditorStore((s) => s.setAnimationSpeed);
  const setAnimationLoop = useEditorStore((s) => s.setAnimationLoop);
  const setAnimationBlendWeight = useEditorStore((s) => s.setAnimationBlendWeight);

  const [crossfadeDuration, setCrossfadeDuration] = useState(0.3);

  const handlePlayClip = useCallback(
    (clipName: string) => {
      if (primaryId) {
        playAnimation(primaryId, clipName, crossfadeDuration);
      }
    },
    [primaryId, playAnimation, crossfadeDuration]
  );

  const handlePause = useCallback(() => {
    if (primaryId) pauseAnimation(primaryId);
  }, [primaryId, pauseAnimation]);

  const handleResume = useCallback(() => {
    if (primaryId) resumeAnimation(primaryId);
  }, [primaryId, resumeAnimation]);

  const handleStop = useCallback(() => {
    if (primaryId) stopAnimation(primaryId);
  }, [primaryId, stopAnimation]);

  const handleSeek = useCallback(
    (timeSecs: number) => {
      if (primaryId) seekAnimation(primaryId, timeSecs);
    },
    [primaryId, seekAnimation]
  );

  const handleSpeedChange = useCallback(
    (speed: number) => {
      if (primaryId) setAnimationSpeed(primaryId, speed);
    },
    [primaryId, setAnimationSpeed]
  );

  const handleLoopChange = useCallback(
    (looping: boolean) => {
      if (primaryId) setAnimationLoop(primaryId, looping);
    },
    [primaryId, setAnimationLoop]
  );

  // Don't render if no animation data or entity doesn't have animations
  if (!animation || animation.availableClips.length === 0) {
    return null;
  }

  // Find duration of active clip
  const activeClip = animation.availableClips.find(
    (c) => c.name === animation.activeClipName
  );
  const duration = activeClip?.durationSecs ?? 0;

  return (
    <div className="border-t border-zinc-800 pt-4 mt-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Animation
      </h3>

      {/* Clip selector */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-zinc-400">Clip</label>
        <select
          value={animation.activeClipName ?? ''}
          onChange={(e) => {
            if (e.target.value) handlePlayClip(e.target.value);
          }}
          className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none
            focus:ring-1 focus:ring-blue-500"
        >
          <option value="">-- Select clip --</option>
          {animation.availableClips.map((clip) => (
            <option key={clip.name} value={clip.name}>
              {clip.name} ({clip.durationSecs.toFixed(1)}s)
            </option>
          ))}
        </select>
      </div>

      {/* Crossfade duration */}
      <div className="mb-3 flex items-center gap-2">
        <label className="w-20 shrink-0 text-xs text-zinc-400">Crossfade</label>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={crossfadeDuration}
          onChange={(e) => setCrossfadeDuration(parseFloat(e.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
            [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-zinc-300"
        />
        <span className="w-10 text-right text-xs tabular-nums text-zinc-500">
          {crossfadeDuration.toFixed(1)}s
        </span>
      </div>

      {/* Transport controls */}
      <div className="mb-3 flex items-center gap-1">
        {animation.isPlaying && !animation.isPaused ? (
          <button
            onClick={handlePause}
            className="rounded bg-zinc-800 p-1.5 text-zinc-300 hover:bg-zinc-700"
            title="Pause"
          >
            <Pause size={14} />
          </button>
        ) : (
          <button
            onClick={() => {
              if (animation.isPaused) {
                handleResume();
              } else if (animation.activeClipName) {
                handlePlayClip(animation.activeClipName);
              } else if (animation.availableClips.length > 0) {
                handlePlayClip(animation.availableClips[0].name);
              }
            }}
            className="rounded bg-zinc-800 p-1.5 text-zinc-300 hover:bg-zinc-700"
            title="Play"
          >
            <Play size={14} />
          </button>
        )}
        <button
          onClick={handleStop}
          className="rounded bg-zinc-800 p-1.5 text-zinc-300 hover:bg-zinc-700"
          title="Stop"
        >
          <Square size={14} />
        </button>
        <button
          onClick={() => handleSeek(0)}
          className="rounded bg-zinc-800 p-1.5 text-zinc-300 hover:bg-zinc-700"
          title="Rewind"
        >
          <RotateCcw size={14} />
        </button>

        {/* Status badge */}
        <span className="ml-auto text-[10px] text-zinc-500">
          {animation.isPlaying && !animation.isPaused
            ? 'Playing'
            : animation.isPaused
              ? 'Paused'
              : animation.isFinished
                ? 'Finished'
                : 'Stopped'}
        </span>
      </div>

      {/* Seek slider */}
      {animation.activeClipName && duration > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={duration}
              step={0.01}
              value={animation.elapsedSecs}
              onChange={(e) => handleSeek(parseFloat(e.target.value))}
              className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
                [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-zinc-300"
            />
            <span className="w-16 text-right text-xs tabular-nums text-zinc-500">
              {animation.elapsedSecs.toFixed(1)}s / {duration.toFixed(1)}s
            </span>
          </div>
        </div>
      )}

      {/* Speed control */}
      <div className="mb-3 flex items-center gap-2">
        <label className="w-12 shrink-0 text-xs text-zinc-400">Speed</label>
        <input
          type="range"
          min={0.1}
          max={3}
          step={0.1}
          value={animation.speed}
          onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
            [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-zinc-300"
        />
        <span className="w-10 text-right text-xs tabular-nums text-zinc-500">
          {animation.speed.toFixed(1)}x
        </span>
      </div>

      {/* Loop toggle */}
      <div className="mb-3 flex items-center gap-2">
        <label className="w-12 shrink-0 text-xs text-zinc-400">Loop</label>
        <input
          type="checkbox"
          checked={animation.isLooping}
          onChange={(e) => handleLoopChange(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
            focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
        />
      </div>

      {/* Per-clip blend weights (advanced) */}
      {animation.availableClips.length > 1 && (
        <div className="border-t border-zinc-800 pt-3">
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Blend Weights
          </h4>
          {animation.availableClips.map((clip) => (
            <div key={clip.name} className="mb-2 flex items-center gap-2">
              <label className="w-24 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-zinc-400">
                {clip.name}
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                defaultValue={1.0}
                onChange={(e) => {
                  if (primaryId) {
                    setAnimationBlendWeight(primaryId, clip.name, parseFloat(e.target.value));
                  }
                }}
                className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
                  [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-zinc-300"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
