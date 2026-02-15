'use client';

import { useState, useCallback, memo } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Play, Square } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

const PROPERTY_TARGETS = [
  { value: 'position_x', label: 'Position X', group: 'Transform' },
  { value: 'position_y', label: 'Position Y', group: 'Transform' },
  { value: 'position_z', label: 'Position Z', group: 'Transform' },
  { value: 'rotation_x', label: 'Rotation X', group: 'Transform' },
  { value: 'rotation_y', label: 'Rotation Y', group: 'Transform' },
  { value: 'rotation_z', label: 'Rotation Z', group: 'Transform' },
  { value: 'scale_x', label: 'Scale X', group: 'Transform' },
  { value: 'scale_y', label: 'Scale Y', group: 'Transform' },
  { value: 'scale_z', label: 'Scale Z', group: 'Transform' },
  { value: 'material_base_color_r', label: 'Base Color R', group: 'Material' },
  { value: 'material_base_color_g', label: 'Base Color G', group: 'Material' },
  { value: 'material_base_color_b', label: 'Base Color B', group: 'Material' },
  { value: 'material_base_color_a', label: 'Base Color A', group: 'Material' },
  { value: 'material_emissive_r', label: 'Emissive R', group: 'Material' },
  { value: 'material_emissive_g', label: 'Emissive G', group: 'Material' },
  { value: 'material_emissive_b', label: 'Emissive B', group: 'Material' },
  { value: 'material_metallic', label: 'Metallic', group: 'Material' },
  { value: 'material_roughness', label: 'Roughness', group: 'Material' },
  { value: 'material_opacity', label: 'Opacity', group: 'Material' },
  { value: 'light_intensity', label: 'Intensity', group: 'Light' },
  { value: 'light_color_r', label: 'Color R', group: 'Light' },
  { value: 'light_color_g', label: 'Color G', group: 'Light' },
  { value: 'light_color_b', label: 'Color B', group: 'Light' },
  { value: 'light_range', label: 'Range', group: 'Light' },
];

const INTERPOLATION_OPTIONS = [
  { value: 'step', label: 'Step' },
  { value: 'linear', label: 'Linear' },
  { value: 'ease_in', label: 'Ease In' },
  { value: 'ease_out', label: 'Ease Out' },
  { value: 'ease_in_out', label: 'Ease In/Out' },
];

const PLAY_MODE_OPTIONS = [
  { value: 'once', label: 'Once' },
  { value: 'loop', label: 'Loop' },
  { value: 'ping_pong', label: 'Ping Pong' },
];

export const AnimationClipInspector = memo(function AnimationClipInspector() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const primaryAnimationClip = useEditorStore((s) => s.primaryAnimationClip);
  const createAnimationClip = useEditorStore((s) => s.createAnimationClip);
  const addClipKeyframe = useEditorStore((s) => s.addClipKeyframe);
  const removeClipKeyframe = useEditorStore((s) => s.removeClipKeyframe);
  const updateClipKeyframe = useEditorStore((s) => s.updateClipKeyframe);
  const setClipProperty = useEditorStore((s) => s.setClipProperty);
  const previewClip = useEditorStore((s) => s.previewClip);
  const removeAnimationClip = useEditorStore((s) => s.removeAnimationClip);

  const [expandedTracks, setExpandedTracks] = useState<Set<string>>(new Set());
  const [addingKeyframeTrack, setAddingKeyframeTrack] = useState<string | null>(null);
  const [addingTrack, setAddingTrack] = useState<boolean>(false);
  const [newTrackTarget, setNewTrackTarget] = useState<string>('');
  const [newKeyframeData, setNewKeyframeData] = useState<{ time: number; value: number; interpolation: string }>({ time: 0, value: 0, interpolation: 'linear' });

  const handleCreateClip = useCallback(() => {
    if (!primaryId) return;
    createAnimationClip(primaryId);
  }, [primaryId, createAnimationClip]);

  const handleRemoveClip = useCallback(() => {
    if (!primaryId) return;
    removeAnimationClip(primaryId);
  }, [primaryId, removeAnimationClip]);

  const handleDurationChange = useCallback((value: number) => {
    if (!primaryId) return;
    setClipProperty(primaryId, value, undefined, undefined, undefined);
  }, [primaryId, setClipProperty]);

  const handlePlayModeChange = useCallback((value: string) => {
    if (!primaryId) return;
    setClipProperty(primaryId, undefined, value, undefined, undefined);
  }, [primaryId, setClipProperty]);

  const handleSpeedChange = useCallback((value: number) => {
    if (!primaryId) return;
    setClipProperty(primaryId, undefined, undefined, value, undefined);
  }, [primaryId, setClipProperty]);

  const handleAutoplayChange = useCallback((value: boolean) => {
    if (!primaryId) return;
    setClipProperty(primaryId, undefined, undefined, undefined, value);
  }, [primaryId, setClipProperty]);

  const handlePreviewPlay = useCallback(() => {
    if (!primaryId) return;
    previewClip(primaryId, 'play');
  }, [primaryId, previewClip]);

  const handlePreviewStop = useCallback(() => {
    if (!primaryId) return;
    previewClip(primaryId, 'stop');
  }, [primaryId, previewClip]);

  const toggleTrack = useCallback((target: string) => {
    setExpandedTracks((prev) => {
      const next = new Set(prev);
      if (next.has(target)) {
        next.delete(target);
      } else {
        next.add(target);
      }
      return next;
    });
  }, []);

  const handleAddTrack = useCallback(() => {
    if (!primaryId || !newTrackTarget) return;
    // Add first keyframe to create track
    addClipKeyframe(primaryId, newTrackTarget, 0, 0, 'linear');
    setNewTrackTarget('');
    setAddingTrack(false);
  }, [primaryId, newTrackTarget, addClipKeyframe]);

  const handleAddKeyframe = useCallback((target: string) => {
    if (!primaryId) return;
    addClipKeyframe(primaryId, target, newKeyframeData.time, newKeyframeData.value, newKeyframeData.interpolation);
    setAddingKeyframeTrack(null);
    setNewKeyframeData({ time: 0, value: 0, interpolation: 'linear' });
  }, [primaryId, addClipKeyframe, newKeyframeData]);

  const handleRemoveKeyframe = useCallback((target: string, time: number) => {
    if (!primaryId) return;
    removeClipKeyframe(primaryId, target, time);
  }, [primaryId, removeClipKeyframe]);

  const handleUpdateKeyframeValue = useCallback((target: string, time: number, value: number) => {
    if (!primaryId) return;
    updateClipKeyframe(primaryId, target, time, value, undefined, undefined);
  }, [primaryId, updateClipKeyframe]);

  const handleUpdateKeyframeInterpolation = useCallback((target: string, time: number, interpolation: string) => {
    if (!primaryId) return;
    updateClipKeyframe(primaryId, target, time, undefined, interpolation, undefined);
  }, [primaryId, updateClipKeyframe]);

  if (!primaryId) return null;

  const usedTargets = new Set(primaryAnimationClip?.tracks.map((t) => t.target) || []);
  const availableTargets = PROPERTY_TARGETS.filter((t) => !usedTargets.has(t.value));

  return (
    <div className="border-t border-zinc-800 pt-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Keyframe Animation
          </h3>
          <InfoTooltip text="Frame-by-frame animation you create for this object" />
        </div>
        {primaryAnimationClip && (
          <span className="rounded bg-blue-900/30 px-1.5 py-0.5 text-[10px] text-blue-400">
            {primaryAnimationClip.tracks.length} track{primaryAnimationClip.tracks.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {!primaryAnimationClip ? (
        <button
          onClick={handleCreateClip}
          className="w-full rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 transition-colors"
        >
          Add Animation Clip
        </button>
      ) : (
        <div className="space-y-3">
          {/* Clip properties */}
          <div className="space-y-2 rounded bg-zinc-800 p-3">
            <div>
              <div className="mb-1 flex items-center gap-1.5">
                <label className="text-xs text-zinc-400">Duration (s)</label>
                <InfoTooltip term="clipDuration" />
              </div>
              <input
                type="number"
                value={primaryAnimationClip.duration}
                onChange={(e) => handleDurationChange(parseFloat(e.target.value))}
                step={0.1}
                min={0.1}
                className="w-full rounded bg-zinc-900 px-2 py-1 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1.5">
                <label className="text-xs text-zinc-400">Play Mode</label>
                <InfoTooltip term="clipPlayMode" />
              </div>
              <select
                value={primaryAnimationClip.playMode}
                onChange={(e) => handlePlayModeChange(e.target.value)}
                className="w-full rounded bg-zinc-900 px-2 py-1 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
              >
                {PLAY_MODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1.5">
                <label className="text-xs text-zinc-400">Speed</label>
                <InfoTooltip term="animationSpeed" />
              </div>
              <input
                type="range"
                value={primaryAnimationClip.speed}
                onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                min={0.1}
                max={5.0}
                step={0.1}
                className="w-full"
              />
              <div className="text-xs text-zinc-400 text-right">{primaryAnimationClip.speed.toFixed(1)}x</div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={primaryAnimationClip.autoplay}
                onChange={(e) => handleAutoplayChange(e.target.checked)}
                className="rounded"
              />
              <label className="text-xs text-zinc-400">Autoplay in Play mode</label>
              <InfoTooltip term="clipAutoplay" />
            </div>
          </div>

          {/* Preview controls */}
          <div className="flex gap-2">
            <button
              onClick={handlePreviewPlay}
              className="flex-1 flex items-center justify-center gap-1.5 rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 transition-colors"
            >
              <Play className="w-4 h-4" />
              Preview
            </button>
            <button
              onClick={handlePreviewStop}
              className="flex-1 flex items-center justify-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-600 transition-colors"
            >
              <Square className="w-4 h-4" />
              Stop
            </button>
          </div>

          {/* Track list */}
          <div className="space-y-2">
            {primaryAnimationClip.tracks.map((track) => {
              const targetLabel = PROPERTY_TARGETS.find((t) => t.value === track.target)?.label ?? track.target;
              const isExpanded = expandedTracks.has(track.target);

              return (
                <div key={track.target} className="rounded bg-zinc-800 overflow-hidden">
                  <button
                    onClick={() => toggleTrack(track.target)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      <span className="font-medium">{targetLabel}</span>
                      <span className="text-xs text-zinc-500">{track.keyframes.length} keyframe{track.keyframes.length !== 1 ? 's' : ''}</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2">
                      {track.keyframes.length > 0 && (
                        <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                          <div className="flex w-16 items-center gap-0.5">
                            <span>Time</span>
                            <InfoTooltip term="keyframeTime" />
                          </div>
                          <div className="flex flex-1 items-center gap-0.5">
                            <span>Value</span>
                            <InfoTooltip term="keyframeValue" />
                          </div>
                          <div className="flex items-center gap-0.5">
                            <span>Interpolation</span>
                            <InfoTooltip term="interpolation" />
                          </div>
                          <div className="w-6" />
                        </div>
                      )}
                      {track.keyframes.map((kf, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs">
                          <input
                            type="number"
                            value={kf.time}
                            readOnly
                            className="w-16 rounded bg-zinc-900 px-2 py-1 text-zinc-400"
                            placeholder="Time"
                          />
                          <input
                            type="number"
                            value={kf.value}
                            onChange={(e) => handleUpdateKeyframeValue(track.target, kf.time, parseFloat(e.target.value))}
                            step={0.01}
                            className="flex-1 rounded bg-zinc-900 px-2 py-1 text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="Value"
                          />
                          <select
                            value={kf.interpolation}
                            onChange={(e) => handleUpdateKeyframeInterpolation(track.target, kf.time, e.target.value)}
                            className="rounded bg-zinc-900 px-2 py-1 text-zinc-200 text-xs outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            {INTERPOLATION_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleRemoveKeyframe(track.target, kf.time)}
                            className="p-1 rounded text-red-400 hover:bg-red-900/30 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}

                      {addingKeyframeTrack === track.target ? (
                        <div className="flex items-center gap-2 text-xs border-t border-zinc-700 pt-2">
                          <input
                            type="number"
                            value={newKeyframeData.time}
                            onChange={(e) => setNewKeyframeData({ ...newKeyframeData, time: parseFloat(e.target.value) })}
                            step={0.1}
                            min={0}
                            className="w-16 rounded bg-zinc-900 px-2 py-1 text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="Time"
                          />
                          <input
                            type="number"
                            value={newKeyframeData.value}
                            onChange={(e) => setNewKeyframeData({ ...newKeyframeData, value: parseFloat(e.target.value) })}
                            step={0.01}
                            className="flex-1 rounded bg-zinc-900 px-2 py-1 text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="Value"
                          />
                          <button
                            onClick={() => handleAddKeyframe(track.target)}
                            className="px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                          >
                            Add
                          </button>
                          <button
                            onClick={() => setAddingKeyframeTrack(null)}
                            className="px-2 py-1 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAddingKeyframeTrack(track.target)}
                          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add Keyframe
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add track */}
          {addingTrack ? (
            <div className="space-y-2 rounded bg-zinc-800 p-3">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-zinc-400">Property</label>
                <InfoTooltip text="Which aspect of the object to animate (position, rotation, etc.)" />
              </div>
              <select
                value={newTrackTarget}
                onChange={(e) => setNewTrackTarget(e.target.value)}
                className="w-full rounded bg-zinc-900 px-2 py-1 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select property...</option>
                {availableTargets.map((t) => (
                  <option key={t.value} value={t.value}>{t.label} ({t.group})</option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  onClick={handleAddTrack}
                  disabled={!newTrackTarget}
                  className="flex-1 px-3 py-1.5 rounded bg-blue-600 text-sm text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Add Track
                </button>
                <button
                  onClick={() => { setAddingTrack(false); setNewTrackTarget(''); }}
                  className="flex-1 px-3 py-1.5 rounded bg-zinc-700 text-sm text-zinc-300 hover:bg-zinc-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingTrack(true)}
              disabled={availableTargets.length === 0}
              className="w-full flex items-center justify-center gap-1.5 rounded bg-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Track
            </button>
          )}

          {/* Remove clip */}
          <button
            onClick={handleRemoveClip}
            className="w-full rounded bg-red-900/30 px-3 py-2 text-sm text-red-400 hover:bg-red-900/50 transition-colors"
          >
            Remove Animation Clip
          </button>
        </div>
      )}
    </div>
  );
});
