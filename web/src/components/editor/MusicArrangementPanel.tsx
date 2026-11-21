'use client';

import { memo, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Music, Plus, Trash2, Undo2, Redo2 } from 'lucide-react';
import { Button, Card, Input, Select } from '@spawnforge/ui';
import { useEditorStore } from '@/stores/editorStore';
import { EmptyState } from '@/components/ui/EmptyState';
import { useMusicArrangementStore, type ArrangementSlice } from '@/lib/music/arrangementStore';
import {
  clipLength,
  overlappingClipIds,
  MAX_ARRANGEMENT_TRACKS,
  MAX_ARRANGEMENT_CLIPS,
  MAX_AUDIO_DURATION_SECONDS,
  MAX_TIMELINE_OFFSET_SECONDS,
  type MusicClip,
  type MusicTrack,
} from '@/lib/music/arrangementTypes';

const TRACKS_PER_PAGE = 8;
const CLIPS_PER_PAGE = 25;
const fieldClass = 'min-h-11 min-w-0';
const labelClass = 'flex min-w-0 flex-col gap-1 text-xs text-[var(--sf-text-secondary)]';

type ClipActions = Pick<ArrangementSlice, 'moveClip' | 'trimClip' | 'setLoopPoints' | 'deleteClip'>;
interface ClipRowProps extends ClipActions {
  clip: MusicClip;
  overlapping: boolean;
}

function ClipRow({ clip, overlapping, moveClip, trimClip, setLoopPoints, deleteClip }: ClipRowProps) {
  const length = clipLength(clip);
  return (
    <Card className="min-w-0" data-testid={`clip-${clip.id}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="min-w-0 break-words text-sm font-medium">{clip.name}</h4>
        <Button
          type="button"
          variant="ghost"
          aria-label={`Delete clip ${clip.name}`}
          title="Delete this clip; Undo restores it"
          onClick={() => deleteClip(clip.id)}
          className="min-h-11 min-w-11 px-2"
        >
          <Trash2 size={16} aria-hidden="true" />
        </Button>
      </div>
      <p className="mb-3 break-words text-xs text-[var(--sf-text-secondary)]">
        Start: {clip.startOffset.toFixed(2)} s · End: {(clip.startOffset + length).toFixed(2)} s ·
        Trimmed length: {length.toFixed(2)} s
      </p>
      {overlapping && (
        <p className="mb-3 text-xs text-[var(--sf-text-secondary)]">
          Overlaps another clip on this track.
        </p>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className={labelClass}>
          Start offset (s)
          <Input
            type="number"
            min={0}
            max={MAX_TIMELINE_OFFSET_SECONDS}
            step="any"
            aria-label={`Start offset for ${clip.name}`}
            title="Stored start offset; arrangement playback is not available yet"
            value={clip.startOffset}
            onChange={(e) => moveClip(clip.id, e.target.valueAsNumber)}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          Trim in (s)
          <Input
            type="number"
            min={0}
            max={clip.sourceDurationSeconds}
            step="any"
            aria-label={`Trim start for ${clip.name}`}
            title="Start of the stored source window"
            value={clip.trimStart}
            onChange={(e) => trimClip(clip.id, { trimStart: e.target.valueAsNumber })}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          Trim out (s)
          <Input
            type="number"
            min={0}
            max={clip.sourceDurationSeconds}
            step="any"
            aria-label={`Trim end for ${clip.name}`}
            title="End of the stored source window"
            value={clip.trimEnd}
            onChange={(e) => trimClip(clip.id, { trimEnd: e.target.valueAsNumber })}
            className={fieldClass}
          />
        </label>
      </div>
      <Button
        type="button"
        variant="outline"
        className="mt-3 min-h-11"
        aria-label={`Loop ${clip.name}`}
        aria-pressed={clip.loopEnabled}
        title="Store the loop setting; this does not change playback yet"
        onClick={() => setLoopPoints(clip.id, { loopEnabled: !clip.loopEnabled })}
      >
        Loop metadata: {clip.loopEnabled ? 'On' : 'Off'}
      </Button>
    </Card>
  );
}

interface TrackCardProps extends ClipActions {
  track: MusicTrack;
  clips: MusicClip[];
  overlaps: Set<string>;
  audioAssets: { id: string; name: string }[];
  addClip: ArrangementSlice['addClip'];
  deleteTrack: ArrangementSlice['deleteTrack'];
  setTrackMuted: ArrangementSlice['setTrackMuted'];
  announce: (message: string) => void;
}

function TrackCard({
  track, clips, overlaps, audioAssets, addClip, deleteTrack, setTrackMuted,
  moveClip, trimClip, setLoopPoints, deleteClip, announce,
}: TrackCardProps) {
  const durationHelpId = useId();
  const [sourceId, setSourceId] = useState('');
  const [sourceLength, setSourceLength] = useState('');
  const [addError, setAddError] = useState('');
  const [page, setPage] = useState(0);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(clips.length / CLIPS_PER_PAGE) - 1));
  const selectedSource = audioAssets.find((asset) => asset.id === sourceId)
    ?? (sourceId === '' ? audioAssets[0] : undefined);
  const duration = Number(sourceLength);
  const validDuration = sourceLength.trim() !== '' && Number.isFinite(duration)
    && duration > 0 && duration <= MAX_AUDIO_DURATION_SECONDS;
  const durationError = sourceLength !== '' && !validDuration;

  const handleAddClip = () => {
    if (!selectedSource || !validDuration) return;
    const id = addClip({
      trackId: track.id,
      sourceUrl: selectedSource.name,
      sourceDurationSeconds: duration,
      name: selectedSource.name,
    });
    if (!id) {
      setAddError(`Clip could not be added. Check its source and duration, or remove a clip if the ${MAX_ARRANGEMENT_CLIPS}-clip limit is reached.`);
      return;
    }
    setAddError('');
    setPage(Math.floor(clips.length / CLIPS_PER_PAGE));
    announce(`Added ${selectedSource.name} to ${track.name}.`);
  };

  return (
    <Card data-testid={`track-${track.id}`} className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="min-w-0 break-words text-sm font-semibold">{track.name}</h3>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            aria-label={`Mute ${track.name}`}
            aria-pressed={track.muted}
            title="Store the mute setting; this does not change playback yet"
            onClick={() => setTrackMuted(track.id, !track.muted)}
          >
            Mute metadata: {track.muted ? 'On' : 'Off'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Delete track ${track.name}`}
            title="Delete this track and its clips; Undo restores them together"
            onClick={() => {
              deleteTrack(track.id);
              announce(`Deleted ${track.name} and its clips. Use Undo arrangement edit to restore them.`);
            }}
            className="min-h-11 min-w-11 px-2"
          >
            <Trash2 size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {clips.slice(currentPage * CLIPS_PER_PAGE, (currentPage + 1) * CLIPS_PER_PAGE).map((clip) => (
          <ClipRow
            key={clip.id}
            clip={clip}
            overlapping={overlaps.has(clip.id)}
            moveClip={moveClip}
            trimClip={trimClip}
            setLoopPoints={setLoopPoints}
            deleteClip={(id) => {
              deleteClip(id);
              announce(`Deleted ${clip.name}. Use Undo arrangement edit to restore it.`);
            }}
          />
        ))}
        {clips.length === 0 && (
          <p className="text-xs text-[var(--sf-text-secondary)]">No clips on this track.</p>
        )}
      </div>
      {clips.length > CLIPS_PER_PAGE && (
        <div className="mt-2 flex flex-wrap items-center gap-2" aria-label={`Clip pages for ${track.name}`}>
          <Button type="button" variant="outline" className="min-h-11" disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}>Previous clips</Button>
          <span className="text-xs">Page {currentPage + 1} of {Math.ceil(clips.length / CLIPS_PER_PAGE)}</span>
          <Button type="button" variant="outline" className="min-h-11"
            disabled={(currentPage + 1) * CLIPS_PER_PAGE >= clips.length}
            onClick={() => setPage(currentPage + 1)}>Next clips</Button>
        </div>
      )}
      <div className="mt-3 space-y-2 border-t border-[var(--sf-border)] pt-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className={labelClass}>
            Audio source
            <Select
              aria-label={`Clip source for ${track.name}`}
              title="Select an imported or generated audio asset"
              value={selectedSource?.id ?? ''}
              options={audioAssets.map((asset) => ({ value: asset.id, label: asset.name }))}
              placeholder={audioAssets.length === 0 ? 'No audio assets' : 'Select audio'}
              disabled={audioAssets.length === 0}
              onChange={(e) => {
                setSourceId(e.target.value);
                setSourceLength('');
                setAddError('');
              }}
              className={fieldClass}
            />
          </label>
          <label className={labelClass}>
            Source duration (s)
            <Input
              type="number"
              min={0}
              max={MAX_AUDIO_DURATION_SECONDS}
              step="any"
              aria-label={`Source length for ${track.name}`}
              aria-describedby={durationHelpId}
              title="Enter the audio file's actual duration in seconds"
              value={sourceLength}
              onChange={(e) => { setSourceLength(e.target.value); setAddError(''); }}
              error={durationError}
              className={fieldClass}
              placeholder="Enter duration"
            />
          </label>
        </div>
        <p id={durationHelpId} className="text-xs text-[var(--sf-text-secondary)]">
          {durationError
            ? `Enter a duration greater than 0 and no more than ${MAX_AUDIO_DURATION_SECONDS} seconds.`
            : 'Enter the actual source duration before adding a clip; it is not measured automatically.'}
        </p>
        {audioAssets.length === 0 && (
          <p className="text-xs text-[var(--sf-text-secondary)]">Import or generate audio to add a clip.</p>
        )}
        {addError && <p role="alert" className="text-xs text-[var(--sf-text-secondary)]">{addError}</p>}
        <Button type="button" variant="outline" onClick={handleAddClip}
          disabled={!selectedSource || !validDuration} className="min-h-11">
          <Plus size={16} aria-hidden="true" /> Add Clip
        </Button>
      </div>
    </Card>
  );
}

export const MusicArrangementPanel = memo(function MusicArrangementPanel() {
  const assetRegistry = useEditorStore((s) => s.assetRegistry);
  const arrangement = useMusicArrangementStore((s) => s.arrangement);
  const addTrack = useMusicArrangementStore((s) => s.addTrack);
  const deleteTrack = useMusicArrangementStore((s) => s.deleteTrack);
  const setTrackMuted = useMusicArrangementStore((s) => s.setTrackMuted);
  const addClip = useMusicArrangementStore((s) => s.addClip);
  const moveClip = useMusicArrangementStore((s) => s.moveClip);
  const trimClip = useMusicArrangementStore((s) => s.trimClip);
  const setLoopPoints = useMusicArrangementStore((s) => s.setLoopPoints);
  const deleteClip = useMusicArrangementStore((s) => s.deleteClip);
  const undo = useMusicArrangementStore((s) => s.undo);
  const redo = useMusicArrangementStore((s) => s.redo);
  const canUndo = useMusicArrangementStore((s) => s.canUndo);
  const canRedo = useMusicArrangementStore((s) => s.canRedo);
  const [notice, setNotice] = useState('');
  const [addError, setAddError] = useState('');
  const [page, setPage] = useState(0);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(arrangement.tracks.length / TRACKS_PER_PAGE) - 1));
  const audioAssets = useMemo(
    () => Object.values(assetRegistry).filter((asset) => asset.kind === 'audio'),
    [assetRegistry],
  );
  const clipsByTrack = useMemo(() => {
    const groups = new Map<string, MusicClip[]>();
    for (const clip of arrangement.clips) {
      const clips = groups.get(clip.trackId);
      if (clips) clips.push(clip);
      else groups.set(clip.trackId, [clip]);
    }
    return groups;
  }, [arrangement.clips]);
  const overlaps = useMemo(() => overlappingClipIds(arrangement.clips), [arrangement.clips]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Editor-wide Delete/Undo shortcuts must not act on scene entities while
    // focus is in music controls. Text fields retain native text editing.
    event.stopPropagation();
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
      setNotice('Undid the last arrangement edit.');
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      redo();
      setNotice('Redid the last arrangement edit.');
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--sf-bg-app)] text-[var(--sf-text)]"
      onKeyDown={handleKeyDown}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--sf-border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Music size={16} aria-hidden="true" />
          <h2 className="text-sm font-semibold">Music Arrangement</h2>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="outline" className="min-h-11 min-w-11 px-2"
            aria-label="Undo arrangement edit" title="Undo arrangement edit (Ctrl/Cmd+Z in this panel)"
            disabled={!canUndo} onClick={() => { undo(); setNotice('Undid the last arrangement edit.'); }}>
            <Undo2 size={16} aria-hidden="true" /> Undo
          </Button>
          <Button type="button" variant="outline" className="min-h-11 min-w-11 px-2"
            aria-label="Redo arrangement edit" title="Redo arrangement edit (Ctrl/Cmd+Shift+Z in this panel)"
            disabled={!canRedo} onClick={() => { redo(); setNotice('Redid the last arrangement edit.'); }}>
            <Redo2 size={16} aria-hidden="true" /> Redo
          </Button>
          <Button type="button" className="min-h-11" onClick={() => {
            const id = addTrack();
            if (!id) {
              setAddError(`Track could not be added. Remove a track if the ${MAX_ARRANGEMENT_TRACKS}-track limit is reached.`);
              return;
            }
            setAddError('');
            setPage(Math.floor(arrangement.tracks.length / TRACKS_PER_PAGE));
            setNotice('Added a track.');
          }}>
            <Plus size={16} aria-hidden="true" /> Add Track
          </Button>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-auto p-3">
        <p className="text-xs text-[var(--sf-text-secondary)]">
          Authoring only: offsets, trim, loop and mute settings are stored with the scene.
          These settings do not change preview, game or exported playback yet.
        </p>
        <p className="text-xs text-[var(--sf-text-secondary)]">
          Undo and Redo apply to arrangement edits, including deleted tracks and their clips.
        </p>
        <p role="status" aria-live="polite" className="text-xs text-[var(--sf-text-secondary)]">{notice}</p>
        {addError && <p role="alert" className="text-xs text-[var(--sf-text-secondary)]">{addError}</p>}
        {arrangement.tracks.length === 0 ? (
          <EmptyState icon={Music} title="No tracks yet"
            description="Add a track, then place imported or generated audio as clips." />
        ) : arrangement.tracks.slice(currentPage * TRACKS_PER_PAGE, (currentPage + 1) * TRACKS_PER_PAGE).map((track) => (
          <TrackCard key={track.id} track={track} clips={clipsByTrack.get(track.id) ?? []}
            overlaps={overlaps} audioAssets={audioAssets} addClip={addClip} deleteTrack={deleteTrack}
            setTrackMuted={setTrackMuted} moveClip={moveClip} trimClip={trimClip}
            setLoopPoints={setLoopPoints} deleteClip={deleteClip} announce={setNotice} />
        ))}
        {arrangement.tracks.length > TRACKS_PER_PAGE && (
          <div className="flex flex-wrap items-center gap-2" aria-label="Track pages">
            <Button type="button" variant="outline" className="min-h-11" disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}>Previous tracks</Button>
            <span className="text-xs">Page {currentPage + 1} of {Math.ceil(arrangement.tracks.length / TRACKS_PER_PAGE)}</span>
            <Button type="button" variant="outline" className="min-h-11"
              disabled={(currentPage + 1) * TRACKS_PER_PAGE >= arrangement.tracks.length}
              onClick={() => setPage(currentPage + 1)}>Next tracks</Button>
          </div>
        )}
      </div>
    </div>
  );
});
