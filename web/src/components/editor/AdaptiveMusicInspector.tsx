/**
 * AdaptiveMusicInspector — Inspector panel for adaptive music settings.
 * Manages stems, intensity, segment transitions, and audio snapshots.
 */

'use client';

import { useState, useCallback } from 'react';
import { Play, Pause, Save, Upload } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';

interface StemConfig {
  pad?: string;
  bass?: string;
  melody?: string;
  drums?: string;
  bpm: number;
}

interface AudioSnapshot {
  name: string;
  timestamp: number;
  buses: Array<{
    name: string;
    volume: number;
    muted: boolean;
  }>;
}

export default function AdaptiveMusicInspector() {
  const intensity = useEditorStore((s) => s.adaptiveMusicIntensity);
  const setAdaptiveMusicIntensity = useEditorStore((s) => s.setAdaptiveMusicIntensity);
  const currentSegment = useEditorStore((s) => s.currentMusicSegment);
  const setCurrentMusicSegment = useEditorStore((s) => s.setCurrentMusicSegment);
  const [isPlaying, setIsPlaying] = useState(false);
  const [stems, setStems] = useState<StemConfig>({ bpm: 120 });
  const [snapshots, setSnapshots] = useState<AudioSnapshot[]>([]);
  const [snapshotName, setSnapshotName] = useState('');

  // Load snapshots from localStorage on mount
  const loadSnapshots = useCallback(() => {
    try {
      const stored = localStorage.getItem('audioSnapshots');
      if (stored) {
        setSnapshots(JSON.parse(stored));
      }
    } catch (err) {
      console.error('Failed to load audio snapshots:', err);
    }
  }, []);

  const handleIntensityChange = useCallback((value: number) => {
    setAdaptiveMusicIntensity(value);
  }, [setAdaptiveMusicIntensity]);

  const handlePlayPause = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  const handleSegmentChange = useCallback((segment: string) => {
    setCurrentMusicSegment(segment);
  }, [setCurrentMusicSegment]);

  const handleCreateSnapshot = useCallback(() => {
    if (!snapshotName.trim()) {
      alert('Please enter a snapshot name');
      return;
    }
    // Capture current bus state from the editor store
    const currentBuses = useEditorStore.getState().audioBuses.map(b => ({
      name: b.name,
      volume: b.volume,
      muted: b.muted,
    }));
    const newSnapshot: AudioSnapshot = { name: snapshotName.trim(), timestamp: Date.now(), buses: currentBuses };
    const updated = [...snapshots, newSnapshot];
    setSnapshots(updated);
    try { localStorage.setItem('audioSnapshots', JSON.stringify(updated)); } catch { /* ignore */ }
    setSnapshotName('');
  }, [snapshotName, snapshots]);

  const handleApplySnapshot = useCallback((name: string) => {
    const snapshot = snapshots.find(s => s.name === name);
    if (!snapshot) return;
    // Restore bus volumes/mute state from saved snapshot
    for (const bus of snapshot.buses) {
      useEditorStore.getState().updateAudioBus(bus.name, { volume: bus.volume, muted: bus.muted });
    }
  }, [snapshots]);

  const handleStemChange = useCallback((stemName: keyof StemConfig, value: string | number) => {
    setStems(prev => ({ ...prev, [stemName]: value }));
  }, []);

  const handleConfigureStems = useCallback(() => {
    // Store stem config in localStorage for persistence
    try {
      localStorage.setItem('adaptiveMusicStems', JSON.stringify(stems));
    } catch { /* ignore */ }
  }, [stems]);

  return (
    <div className="space-y-4 p-4 bg-zinc-900 rounded-lg border border-zinc-700">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Adaptive Music</h3>
        <button
          onClick={handlePlayPause}
          className="p-2 hover:bg-zinc-800 rounded transition-colors"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
      </div>

      {/* Intensity Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <label className="text-zinc-400">Intensity</label>
          <span className="text-zinc-300">{(intensity * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={intensity}
          onChange={(e) => handleIntensityChange(parseFloat(e.target.value))}
          className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
        />
        <div className="flex justify-between text-xs text-zinc-400">
          <span>Ambient</span>
          <span>Full Mix</span>
        </div>
      </div>

      {/* Stem Configuration */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-zinc-400">Stems</h4>
        {(['pad', 'bass', 'melody', 'drums'] as const).map(stem => (
          <div key={stem} className="flex items-center gap-2">
            <label className="text-xs text-zinc-400 w-16 capitalize">{stem}</label>
            <input
              type="text"
              value={stems[stem] || ''}
              onChange={(e) => handleStemChange(stem, e.target.value)}
              placeholder="Asset ID"
              className="flex-1 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-xs text-zinc-200"
            />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-400 w-16">BPM</label>
          <input
            type="number"
            value={stems.bpm}
            onChange={(e) => handleStemChange('bpm', parseInt(e.target.value) || 120)}
            min="60"
            max="240"
            className="flex-1 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-xs text-zinc-200"
          />
        </div>
        <button
          onClick={handleConfigureStems}
          className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs text-white transition-colors"
        >
          Configure Stems
        </button>
      </div>

      {/* Segment Selector */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-zinc-400">Segments</h4>
        <div className="grid grid-cols-2 gap-2">
          {['intro', 'main', 'combat', 'calm', 'outro'].map(segment => (
            <button
              key={segment}
              onClick={() => handleSegmentChange(segment)}
              className={`px-2 py-1.5 rounded text-xs transition-colors capitalize ${
                currentSegment === segment
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              {segment}
            </button>
          ))}
        </div>
      </div>

      {/* Audio Snapshots */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-zinc-400">Audio Snapshots</h4>
        <div className="flex gap-2">
          <input
            type="text"
            value={snapshotName}
            onChange={(e) => setSnapshotName(e.target.value)}
            placeholder="Snapshot name"
            className="flex-1 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-xs text-zinc-200"
          />
          <button
            onClick={handleCreateSnapshot}
            className="p-1.5 bg-green-600 hover:bg-green-700 rounded transition-colors"
            aria-label="Create snapshot"
          >
            <Save className="w-4 h-4" />
          </button>
          <button
            onClick={loadSnapshots}
            className="p-1.5 bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
            aria-label="Refresh snapshots"
          >
            <Upload className="w-4 h-4" />
          </button>
        </div>
        {snapshots.length > 0 && (
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {snapshots.map((snapshot, idx) => (
              <button
                key={`${snapshot.name}-${idx}`}
                onClick={() => handleApplySnapshot(snapshot.name)}
                className="w-full px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs text-left text-zinc-300 transition-colors"
              >
                {snapshot.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
