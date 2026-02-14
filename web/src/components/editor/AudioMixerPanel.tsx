'use client';

import { useState, memo } from 'react';
import { useEditorStore, type AudioBusDef, type AudioEffectDef } from '@/stores/editorStore';
import { SlidersHorizontal, X, Plus } from 'lucide-react';

interface MixerStripProps {
  bus: AudioBusDef;
  isMaster: boolean;
  onVolumeChange: (volume: number) => void;
  onMuteToggle: () => void;
  onSoloToggle: () => void;
  onEffectsChange: (effects: AudioEffectDef[]) => void;
}

function MixerStrip({ bus, isMaster, onVolumeChange, onMuteToggle, onSoloToggle, onEffectsChange }: MixerStripProps) {
  const [showEffectMenu, setShowEffectMenu] = useState(false);
  const [editingEffect, setEditingEffect] = useState<number | null>(null);

  const handleAddEffect = (effectType: string) => {
    const defaultParams: Record<string, Record<string, number>> = {
      reverb: { preset: 0, wet: 0.5 },
      lowpass: { frequency: 1000, q: 1.0 },
      highpass: { frequency: 500, q: 1.0 },
      compressor: { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 },
      delay: { time: 0.5, feedback: 0.3, wet: 0.5 },
    };

    const newEffect: AudioEffectDef = {
      effectType,
      params: defaultParams[effectType] ?? {},
      enabled: true,
    };

    onEffectsChange([...bus.effects, newEffect]);
    setShowEffectMenu(false);
  };

  const handleRemoveEffect = (index: number) => {
    const newEffects = bus.effects.filter((_, i) => i !== index);
    onEffectsChange(newEffects);
    setEditingEffect(null);
  };

  const handleEffectParamChange = (index: number, paramName: string, value: number) => {
    const newEffects = bus.effects.map((fx, i) =>
      i === index ? { ...fx, params: { ...fx.params, [paramName]: value } } : fx
    );
    onEffectsChange(newEffects);
  };

  return (
    <div className={`flex flex-col gap-2 p-3 border-r border-zinc-800 min-w-[120px] ${isMaster ? 'bg-zinc-800/50' : 'bg-zinc-900'}`}>
      {/* Bus Label */}
      <div className="text-xs font-semibold text-zinc-300 text-center uppercase tracking-wide">
        {bus.name}
      </div>

      {/* Vertical Fader */}
      <div className="flex-1 flex items-center justify-center py-4">
        <input
          type="range"
          min="0"
          max="100"
          value={bus.volume * 100}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value) / 100)}
          className="h-32 cursor-pointer appearance-none bg-zinc-700 rounded
            [writing-mode:vertical-lr] [direction:rtl]
            [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-5
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded
            [&::-webkit-slider-thumb]:bg-blue-500"
          style={{ accentColor: '#3b82f6' }}
        />
      </div>

      {/* Volume Label */}
      <div className="text-[10px] text-zinc-500 text-center tabular-nums">
        {Math.round(bus.volume * 100)}%
      </div>

      {/* Mute Button */}
      <button
        onClick={onMuteToggle}
        className={`px-2 py-1 text-xs font-bold rounded transition-colors ${
          bus.muted
            ? 'bg-red-900/50 text-red-400 border border-red-700'
            : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-400'
        }`}
      >
        M
      </button>

      {/* Solo Button (hidden on master) */}
      {!isMaster && (
        <button
          onClick={onSoloToggle}
          className={`px-2 py-1 text-xs font-bold rounded transition-colors ${
            bus.soloed
              ? 'bg-yellow-900/50 text-yellow-400 border border-yellow-700'
              : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-400'
          }`}
        >
          S
        </button>
      )}

      {/* Effect Slots */}
      <div className="space-y-1">
        {bus.effects.map((fx, index) => (
          <div key={index} className="relative">
            <button
              onClick={() => setEditingEffect(editingEffect === index ? null : index)}
              onContextMenu={(e) => {
                e.preventDefault();
                handleRemoveEffect(index);
              }}
              className="w-full px-2 py-1 text-[10px] font-mono rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 truncate"
              title={`${fx.effectType} (right-click to remove)`}
            >
              {fx.effectType.slice(0, 4)}
            </button>

            {/* Effect Param Editor Popover */}
            {editingEffect === index && (
              <div className="absolute bottom-full left-0 mb-1 w-48 bg-zinc-800 border border-zinc-700 rounded p-2 shadow-lg z-50">
                <div className="text-xs font-semibold text-zinc-300 mb-2">{fx.effectType}</div>
                <div className="space-y-2">
                  {fx.effectType === 'reverb' && (
                    <>
                      <label className="flex items-center gap-2 text-xs text-zinc-400">
                        Preset
                        <select
                          value={fx.params.preset ?? 0}
                          onChange={(e) => handleEffectParamChange(index, 'preset', parseInt(e.target.value))}
                          className="flex-1 rounded bg-zinc-900 px-1 py-0.5 text-xs text-zinc-200"
                        >
                          <option value={0}>Hall</option>
                          <option value={1}>Room</option>
                          <option value={2}>Plate</option>
                          <option value={3}>Cathedral</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2 text-xs text-zinc-400">
                        Wet
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={fx.params.wet ?? 0.5}
                          onChange={(e) => handleEffectParamChange(index, 'wet', parseFloat(e.target.value))}
                          className="flex-1"
                        />
                        <span className="w-8 text-right tabular-nums">{((fx.params.wet ?? 0.5) * 100).toFixed(0)}%</span>
                      </label>
                    </>
                  )}
                  {(fx.effectType === 'lowpass' || fx.effectType === 'highpass') && (
                    <>
                      <label className="flex items-center gap-2 text-xs text-zinc-400">
                        Freq
                        <input
                          type="range"
                          min="20"
                          max="20000"
                          step="10"
                          value={fx.params.frequency ?? 1000}
                          onChange={(e) => handleEffectParamChange(index, 'frequency', parseFloat(e.target.value))}
                          className="flex-1"
                        />
                        <span className="w-12 text-right tabular-nums">{Math.round(fx.params.frequency ?? 1000)}Hz</span>
                      </label>
                      <label className="flex items-center gap-2 text-xs text-zinc-400">
                        Q
                        <input
                          type="range"
                          min="0.1"
                          max="20"
                          step="0.1"
                          value={fx.params.q ?? 1.0}
                          onChange={(e) => handleEffectParamChange(index, 'q', parseFloat(e.target.value))}
                          className="flex-1"
                        />
                        <span className="w-8 text-right tabular-nums">{(fx.params.q ?? 1.0).toFixed(1)}</span>
                      </label>
                    </>
                  )}
                  {fx.effectType === 'compressor' && (
                    <>
                      <label className="flex items-center gap-2 text-xs text-zinc-400">
                        Threshold
                        <input
                          type="range"
                          min="-100"
                          max="0"
                          step="1"
                          value={fx.params.threshold ?? -24}
                          onChange={(e) => handleEffectParamChange(index, 'threshold', parseFloat(e.target.value))}
                          className="flex-1"
                        />
                        <span className="w-10 text-right tabular-nums">{Math.round(fx.params.threshold ?? -24)}dB</span>
                      </label>
                      <label className="flex items-center gap-2 text-xs text-zinc-400">
                        Ratio
                        <input
                          type="range"
                          min="1"
                          max="20"
                          step="0.5"
                          value={fx.params.ratio ?? 12}
                          onChange={(e) => handleEffectParamChange(index, 'ratio', parseFloat(e.target.value))}
                          className="flex-1"
                        />
                        <span className="w-8 text-right tabular-nums">{(fx.params.ratio ?? 12).toFixed(1)}</span>
                      </label>
                    </>
                  )}
                  {fx.effectType === 'delay' && (
                    <>
                      <label className="flex items-center gap-2 text-xs text-zinc-400">
                        Time
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.01"
                          value={fx.params.time ?? 0.5}
                          onChange={(e) => handleEffectParamChange(index, 'time', parseFloat(e.target.value))}
                          className="flex-1"
                        />
                        <span className="w-10 text-right tabular-nums">{(fx.params.time ?? 0.5).toFixed(2)}s</span>
                      </label>
                      <label className="flex items-center gap-2 text-xs text-zinc-400">
                        Feedback
                        <input
                          type="range"
                          min="0"
                          max="0.95"
                          step="0.01"
                          value={fx.params.feedback ?? 0.3}
                          onChange={(e) => handleEffectParamChange(index, 'feedback', parseFloat(e.target.value))}
                          className="flex-1"
                        />
                        <span className="w-8 text-right tabular-nums">{((fx.params.feedback ?? 0.3) * 100).toFixed(0)}%</span>
                      </label>
                      <label className="flex items-center gap-2 text-xs text-zinc-400">
                        Wet
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={fx.params.wet ?? 0.5}
                          onChange={(e) => handleEffectParamChange(index, 'wet', parseFloat(e.target.value))}
                          className="flex-1"
                        />
                        <span className="w-8 text-right tabular-nums">{((fx.params.wet ?? 0.5) * 100).toFixed(0)}%</span>
                      </label>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Add Effect Button */}
        <div className="relative">
          <button
            onClick={() => setShowEffectMenu(!showEffectMenu)}
            className="w-full px-2 py-1 text-[10px] rounded bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-400"
          >
            +FX
          </button>

          {/* Effect Menu Dropdown */}
          {showEffectMenu && (
            <div className="absolute bottom-full left-0 mb-1 w-32 bg-zinc-800 border border-zinc-700 rounded shadow-lg z-50">
              {['reverb', 'lowpass', 'highpass', 'compressor', 'delay'].map((type) => (
                <button
                  key={type}
                  onClick={() => handleAddEffect(type)}
                  className="w-full px-2 py-1 text-xs text-left text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
                >
                  {type}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const AudioMixerPanel = memo(function AudioMixerPanel() {
  const audioBuses = useEditorStore((s) => s.audioBuses);
  const updateAudioBus = useEditorStore((s) => s.updateAudioBus);
  const setBusEffects = useEditorStore((s) => s.setBusEffects);
  const toggleMixerPanel = useEditorStore((s) => s.toggleMixerPanel);
  const createAudioBus = useEditorStore((s) => s.createAudioBus);

  const [newBusName, setNewBusName] = useState('');
  const [showAddBusDialog, setShowAddBusDialog] = useState(false);

  const handleAddBus = () => {
    if (newBusName.trim()) {
      createAudioBus(newBusName.trim(), 1.0);
      setNewBusName('');
      setShowAddBusDialog(false);
    }
  };

  // Sort buses: non-master first, then master at the end
  const sortedBuses = [...audioBuses].sort((a, b) => {
    if (a.name === 'master') return 1;
    if (b.name === 'master') return -1;
    return 0;
  });

  return (
    <div className="flex flex-col h-full bg-zinc-900 border-t border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={14} className="text-zinc-500" />
          <span className="text-xs font-semibold text-zinc-400">Audio Mixer</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddBusDialog(!showAddBusDialog)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
          >
            <Plus size={12} />
            Add Bus
          </button>
          <button
            onClick={toggleMixerPanel}
            className="text-zinc-500 hover:text-zinc-300"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Add Bus Dialog */}
      {showAddBusDialog && (
        <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-800/30">
          <div className="flex gap-2">
            <input
              type="text"
              value={newBusName}
              onChange={(e) => setNewBusName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddBus()}
              placeholder="Bus name..."
              className="flex-1 rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
            <button
              onClick={handleAddBus}
              className="px-3 py-1 text-xs rounded bg-blue-900/30 text-blue-400 hover:bg-blue-900/50"
            >
              Create
            </button>
            <button
              onClick={() => {
                setShowAddBusDialog(false);
                setNewBusName('');
              }}
              className="px-3 py-1 text-xs rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Mixer Strips Container */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full">
          {sortedBuses.map((bus) => (
            <MixerStrip
              key={bus.name}
              bus={bus}
              isMaster={bus.name === 'master'}
              onVolumeChange={(volume) => updateAudioBus(bus.name, { volume })}
              onMuteToggle={() => updateAudioBus(bus.name, { muted: !bus.muted })}
              onSoloToggle={() => updateAudioBus(bus.name, { soloed: !bus.soloed })}
              onEffectsChange={(effects) => setBusEffects(bus.name, effects)}
            />
          ))}
        </div>
      </div>
    </div>
  );
});
