'use client';

import { memo, useCallback, useMemo, useState } from 'react';
import { Music, Plus, Trash2, Undo2, Redo2 } from 'lucide-react';
import { Button, Input, Select, Checkbox } from '@spawnforge/ui';
import { useEditorStore } from '@/stores/editorStore';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  useMusicArrangementStore,
  type ArrangementSlice,
} from '@/lib/music/arrangementStore';
import { clipLength, overlappingClips, type MusicClip } from '@/lib/music/arrangementTypes';

const PX_PER_SECOND = 6;
const DEFAULT_SOURCE_LENGTH_SECONDS = 30;

interface ClipRowProps {
  clip: MusicClip;
  overlapping: boolean;
  moveClip: ArrangementSlice['moveClip'];
  trimClip: ArrangementSlice['trimClip'];
  setLoopPoints: ArrangementSlice['setLoopPoints'];
  deleteClip: ArrangementSlice['deleteClip'];
}

function ClipRow({ clip, overlapping, moveClip, trimClip, setLoopPoints, deleteClip }: ClipRowProps) {
  const length = clipLength(clip);
  return (
    <div className="flex flex-col gap-1 rounded border border-[var(--sf-border)] bg-[var(--sf-bg-surface)] p-2" data-testid={`clip-${clip.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-[var(--sf-text)]" title={clip.sourceUrl}>
          {clip.name}
          {overlapping && (
            <span className="ml-1 text-[10px] font-normal text-[var(--sf-warning)]" title="Overlaps another clip on this track">
              (overlap)
            </span>
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Delete clip ${clip.name}`}
          onClick={() => deleteClip(clip.id)}
          className="h-7 min-h-0 w-7 px-0 hover:text-[var(--sf-destructive)]"
        >
          <Trash2 size={13} aria-hidden="true" />
        </Button>
      </div>

      <div className="relative h-3 w-full overflow-hidden rounded bg-[var(--sf-bg-app)]">
        <div
          className="absolute top-0 h-full rounded bg-[var(--sf-accent)]/70"
          style={{ left: `${clip.startOffset * PX_PER_SECOND}px`, width: `${Math.max(2, length * PX_PER_SECOND)}px` }}
          data-testid={`clip-block-${clip.id}`}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-0.5 text-[10px] text-[var(--sf-text-secondary)]">
          Start (s)
          <Input
            type="number"
            min={0}
            step={0.1}
            aria-label={`Start offset for ${clip.name}`}
            value={clip.startOffset}
            onChange={(e) => moveClip(clip.id, parseFloat(e.target.value))}
            className="h-7 px-1.5 text-xs"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] text-[var(--sf-text-secondary)]">
          Trim in (s)
          <Input
            type="number"
            min={0}
            step={0.1}
            aria-label={`Trim start for ${clip.name}`}
            value={clip.trimStart}
            onChange={(e) => trimClip(clip.id, { trimStart: parseFloat(e.target.value) })}
            className="h-7 px-1.5 text-xs"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] text-[var(--sf-text-secondary)]">
          Trim out (s)
          <Input
            type="number"
            min={0}
            step={0.1}
            aria-label={`Trim end for ${clip.name}`}
            value={clip.trimEnd}
            onChange={(e) => trimClip(clip.id, { trimEnd: parseFloat(e.target.value) })}
            className="h-7 px-1.5 text-xs"
          />
        </label>
      </div>

      <Checkbox
        label="Loop"
        aria-label={`Loop ${clip.name}`}
        checked={clip.loopEnabled}
        onChange={(e) => setLoopPoints(clip.id, { loopEnabled: e.target.checked })}
      />
    </div>
  );
}

export const MusicArrangementPanel = memo(function MusicArrangementPanel() {
  const assetRegistry = useEditorStore((s) => s.assetRegistry);
  const arrangement = useMusicArrangementStore((s) => s.arrangement);
  const addTrack = useMusicArrangementStore((s) => s.addTrack);
  const deleteTrack = useMusicArrangementStore((s) => s.deleteTrack);
  const setTrackMuted = useMusicArrangementStore((s) => s.setTrackMuted);
  const setTempoBpm = useMusicArrangementStore((s) => s.setTempoBpm);
  const addClip = useMusicArrangementStore((s) => s.addClip);
  const moveClip = useMusicArrangementStore((s) => s.moveClip);
  const trimClip = useMusicArrangementStore((s) => s.trimClip);
  const setLoopPoints = useMusicArrangementStore((s) => s.setLoopPoints);
  const deleteClip = useMusicArrangementStore((s) => s.deleteClip);
  const undo = useMusicArrangementStore((s) => s.undo);
  const redo = useMusicArrangementStore((s) => s.redo);
  const canUndo = useMusicArrangementStore((s) => s.past.length > 0);
  const canRedo = useMusicArrangementStore((s) => s.future.length > 0);

  const [pendingSource, setPendingSource] = useState<Record<string, string>>({});
  const [pendingLength, setPendingLength] = useState<Record<string, number>>({});

  // Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z (or Ctrl/Cmd+Y) redoes — the same
  // binding every other editor surface uses. Scoped to this panel via the root
  // handler + stopPropagation so it does not also fire the scene-graph undo.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        e.stopPropagation();
        redo();
      }
    },
    [undo, redo],
  );

  const audioAssets = useMemo(
    () => Object.values(assetRegistry).filter((a) => a.kind === 'audio'),
    [assetRegistry],
  );

  const clipsByTrack = useMemo(() => {
    const map: Record<string, MusicClip[]> = {};
    for (const clip of arrangement.clips) {
      (map[clip.trackId] ??= []).push(clip);
    }
    return map;
  }, [arrangement.clips]);

  const handleAddClip = (trackId: string) => {
    const sourceUrl = pendingSource[trackId] ?? audioAssets[0]?.name;
    if (!sourceUrl) return;
    const length = pendingLength[trackId] ?? DEFAULT_SOURCE_LENGTH_SECONDS;
    addClip({ trackId, sourceUrl, sourceDurationSeconds: length, name: sourceUrl });
  };

  return (
    <div className="flex h-full flex-col bg-[var(--sf-bg-app)] text-[var(--sf-text)]" onKeyDown={handleKeyDown}>
      <div className="flex items-center justify-between border-b border-[var(--sf-border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Music size={15} className="text-[var(--sf-accent)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Music Arrangement</h2>
          {/* Manual half of `arrangement_set_tempo` (#9854 F2 parity): the AI can
              set the arrangement tempo, so a human must be able to as well. The
              store clamps to 20-400 BPM; tempo-grid snapping is deferred (#10058). */}
          <label className="flex items-center gap-1 text-[10px] text-[var(--sf-text-secondary)]">
            Tempo
            <Input
              type="number"
              min={20}
              max={400}
              step={1}
              aria-label="Arrangement tempo (BPM)"
              value={arrangement.tempoBpm}
              onChange={(e) => setTempoBpm(parseFloat(e.target.value))}
              className="h-7 w-16 px-1.5 text-xs"
            />
            <span aria-hidden="true">BPM</span>
          </label>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={undo}
            disabled={!canUndo}
            aria-label="Undo"
            title="Undo (Ctrl/Cmd+Z)"
            className="h-7 min-h-0 w-7 px-0"
          >
            <Undo2 size={14} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={redo}
            disabled={!canRedo}
            aria-label="Redo"
            title="Redo (Shift+Ctrl/Cmd+Z)"
            className="h-7 min-h-0 w-7 px-0"
          >
            <Redo2 size={14} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => addTrack()}
            className="h-7 min-h-0"
          >
            <Plus size={12} aria-hidden="true" />
            Add Track
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-3">
        {arrangement.tracks.length === 0 ? (
          <EmptyState
            icon={Music}
            title="No tracks yet"
            description="Add a track, then place imported or generated audio as clips."
          />
        ) : (
          arrangement.tracks.map((track) => (
            <div
              key={track.id}
              className="rounded-lg border border-[var(--sf-border)] bg-[var(--sf-bg-elevated)] p-2"
              data-testid={`track-${track.id}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-[var(--sf-text)]">{track.name}</span>
                <div className="flex items-center gap-2">
                  <Checkbox
                    label="Mute"
                    aria-label={`Mute ${track.name}`}
                    checked={track.muted}
                    onChange={(e) => setTrackMuted(track.id, e.target.checked)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete track ${track.name}`}
                    onClick={() => deleteTrack(track.id)}
                    className="h-7 min-h-0 w-7 px-0 hover:text-[var(--sf-destructive)]"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {(clipsByTrack[track.id] ?? []).map((clip) => (
                  <ClipRow
                    key={clip.id}
                    clip={clip}
                    overlapping={overlappingClips(clip, arrangement.clips).length > 0}
                    moveClip={moveClip}
                    trimClip={trimClip}
                    setLoopPoints={setLoopPoints}
                    deleteClip={deleteClip}
                  />
                ))}
                {(clipsByTrack[track.id] ?? []).length === 0 && (
                  <p className="text-[11px] italic text-[var(--sf-text-muted)]">No clips on this track.</p>
                )}
              </div>

              <div className="mt-2 flex items-end gap-2 border-t border-[var(--sf-border)] pt-2">
                <label className="flex flex-1 flex-col gap-0.5 text-[10px] text-[var(--sf-text-secondary)]">
                  Source
                  <Select
                    aria-label={`Clip source for ${track.name}`}
                    value={pendingSource[track.id] ?? audioAssets[0]?.name ?? ''}
                    onChange={(e) => setPendingSource((p) => ({ ...p, [track.id]: e.target.value }))}
                    disabled={audioAssets.length === 0}
                    className="h-8 text-xs"
                    options={
                      audioAssets.length === 0
                        ? [{ value: '', label: 'No audio assets' }]
                        : audioAssets.map((a) => ({ value: a.name, label: a.name }))
                    }
                  />
                </label>
                <label className="flex w-20 flex-col gap-0.5 text-[10px] text-[var(--sf-text-secondary)]">
                  Length (s)
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    aria-label={`Source length for ${track.name}`}
                    value={pendingLength[track.id] ?? DEFAULT_SOURCE_LENGTH_SECONDS}
                    onChange={(e) =>
                      setPendingLength((p) => ({ ...p, [track.id]: parseFloat(e.target.value) }))
                    }
                    className="h-8 px-1.5 text-xs"
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleAddClip(track.id)}
                  disabled={audioAssets.length === 0}
                  className="h-8 min-h-0"
                >
                  <Plus size={12} aria-hidden="true" />
                  Add Clip
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
});
