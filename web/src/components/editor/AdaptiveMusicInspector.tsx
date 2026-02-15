/**
 * AdaptiveMusicInspector — Inspector panel for adaptive music settings.
 * Manages stems, intensity, segment transitions, and audio snapshots.
 */

'use client';

import { useState, useCallback } from 'react';
import { Play, Pause, Save, Upload } from 'lucide-react';

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
  const [intensity, setIntensity] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSegment, setCurrentSegment] = useState('intro');
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
    setIntensity(value);
    // TODO: Call dispatchCommand('set_music_intensity', { intensity: value });
  }, []);

  const handlePlayPause = useCallback(() => {
    setIsPlaying(prev => !prev);
    // TODO: Call adaptive music manager play/stop
  }, []);

  const handleSegmentChange = useCallback((segment: string) => {
    setCurrentSegment(segment);
    // TODO: Call dispatchCommand('transition_music_segment', { segment, quantized: true });
  }, []);

  const handleCreateSnapshot = useCallback(() => {
    if (!snapshotName.trim()) {
      alert('Please enter a snapshot name');
      return;
    }

    // TODO: Call dispatchCommand('create_audio_snapshot', { name: snapshotName });
    setSnapshotName('');
    loadSnapshots();
  }, [snapshotName, loadSnapshots]);

  const handleApplySnapshot = useCallback((_name: string) => {
    // TODO: Call dispatchCommand('apply_audio_snapshot', { name: _name, crossfadeDurationMs: 1000 });
  }, []);

  const handleStemChange = useCallback((stemName: keyof StemConfig, value: string | number) => {
    setStems(prev => ({ ...prev, [stemName]: value }));
  }, []);

  const handleConfigureStems = useCallback(() => {
    // TODO: Call dispatchCommand('set_adaptive_music', stems);
    console.log('Configuring stems:', stems);
  }, [stems]);

  return (
    <div className="space-y-4 p-4 bg-gray-900 rounded-lg border border-gray-700">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">Adaptive Music</h3>
        <button
          onClick={handlePlayPause}
          className="p-2 hover:bg-gray-800 rounded transition-colors"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
      </div>

      {/* Intensity Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <label className="text-gray-400">Intensity</label>
          <span className="text-gray-300">{(intensity * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={intensity}
          onChange={(e) => handleIntensityChange(parseFloat(e.target.value))}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>Ambient</span>
          <span>Full Mix</span>
        </div>
      </div>

      {/* Stem Configuration */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-gray-400">Stems</h4>
        {(['pad', 'bass', 'melody', 'drums'] as const).map(stem => (
          <div key={stem} className="flex items-center gap-2">
            <label className="text-xs text-gray-400 w-16 capitalize">{stem}</label>
            <input
              type="text"
              value={stems[stem] || ''}
              onChange={(e) => handleStemChange(stem, e.target.value)}
              placeholder="Asset ID"
              className="flex-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs text-gray-200"
            />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400 w-16">BPM</label>
          <input
            type="number"
            value={stems.bpm}
            onChange={(e) => handleStemChange('bpm', parseInt(e.target.value) || 120)}
            min="60"
            max="240"
            className="flex-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs text-gray-200"
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
        <h4 className="text-xs font-semibold text-gray-400">Segments</h4>
        <div className="grid grid-cols-2 gap-2">
          {['intro', 'main', 'combat', 'calm', 'outro'].map(segment => (
            <button
              key={segment}
              onClick={() => handleSegmentChange(segment)}
              className={`px-2 py-1.5 rounded text-xs transition-colors capitalize ${
                currentSegment === segment
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {segment}
            </button>
          ))}
        </div>
      </div>

      {/* Audio Snapshots */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-gray-400">Audio Snapshots</h4>
        <div className="flex gap-2">
          <input
            type="text"
            value={snapshotName}
            onChange={(e) => setSnapshotName(e.target.value)}
            placeholder="Snapshot name"
            className="flex-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs text-gray-200"
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
            className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
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
                className="w-full px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs text-left text-gray-300 transition-colors"
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
