'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shuffle, HelpCircle } from 'lucide-react';
import { useEditorStore, type TerrainDataState } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

export function TerrainInspector() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const terrainDataStore = useEditorStore((s) => s.terrainData);
  const updateTerrain = useEditorStore((s) => s.updateTerrain);
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const navigateDocs = useWorkspaceStore((s) => s.navigateDocs);

  const terrainData = primaryId ? terrainDataStore[primaryId] : null;

  // Check if the selected entity is a terrain entity
  const entityType = primaryId ? sceneGraph.nodes[primaryId]?.components.find(c => c === 'EntityType::Terrain') : null;
  const isTerrain = !!entityType || !!terrainData;

  const [localData, setLocalData] = useState<TerrainDataState | null>(terrainData);
  const [updateTimer, setUpdateTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state with store
  useEffect(() => {
    setLocalData(terrainData);
  }, [terrainData]);

  const debouncedUpdate = useCallback((updatedData: TerrainDataState) => {
    if (!primaryId) return;

    if (updateTimer) clearTimeout(updateTimer);
    const timer = setTimeout(() => {
      updateTerrain(primaryId, updatedData);
    }, 250);
    setUpdateTimer(timer);
  }, [primaryId, updateTimer, updateTerrain]);

  const handleChange = (field: keyof TerrainDataState, value: number | string) => {
    if (!localData || !primaryId) return;

    const updatedData = { ...localData, [field]: value };
    setLocalData(updatedData);
    debouncedUpdate(updatedData);
  };

  const randomizeSeed = () => {
    if (!localData || !primaryId) return;
    const newSeed = Math.floor(Math.random() * 100000);
    const updatedData = { ...localData, seed: newSeed };
    setLocalData(updatedData);
    updateTerrain(primaryId, updatedData);
  };

  if (!isTerrain || !localData) return null;

  return (
    <div className="space-y-4 border-b border-zinc-800 pb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-medium text-zinc-300">
            Terrain
          </h3>
          <InfoTooltip text="Procedurally generated landscape" />
          <button onClick={() => navigateDocs('features/terrain')} className="rounded p-0.5 text-zinc-600 hover:text-zinc-400" title="Documentation">
            <HelpCircle size={12} />
          </button>
        </div>
      </div>

      {/* Resolution and Size */}
      <div className="space-y-2">
        <label className="text-xs text-zinc-400 flex items-center gap-1">
          Resolution
          <InfoTooltip term="terrainResolution" />
        </label>
        <select
          value={localData.resolution}
          onChange={(e) => handleChange('resolution', parseInt(e.target.value))}
          className="w-full rounded bg-zinc-800 px-2 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value={32}>32x32</option>
          <option value={64}>64x64</option>
          <option value={128}>128x128</option>
          <option value={256}>256x256</option>
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-zinc-400 flex items-center gap-1">
          Size
          <InfoTooltip term="terrainSize" />
        </label>
        <input
          type="number"
          value={localData.size}
          onChange={(e) => handleChange('size', parseFloat(e.target.value))}
          step={1}
          min={1}
          className="w-full rounded bg-zinc-800 px-2 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Noise Settings */}
      <div className="space-y-3">
        <h4 className="text-xs font-medium text-zinc-500 uppercase">Noise</h4>

        <div className="space-y-2">
          <label className="text-xs text-zinc-400 flex items-center gap-1">
            Type
            <InfoTooltip term="terrainNoiseType" />
          </label>
          <select
            value={localData.noiseType}
            onChange={(e) => handleChange('noiseType', e.target.value)}
            className="w-full rounded bg-zinc-800 px-2 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="perlin">Perlin</option>
            <option value="simplex">Simplex</option>
            <option value="value">Value</option>
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-zinc-400 flex items-center gap-1">
            Octaves: {localData.octaves}
            <InfoTooltip term="terrainOctaves" />
          </label>
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={localData.octaves}
            onChange={(e) => handleChange('octaves', parseInt(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-zinc-400 flex items-center gap-1">
            Frequency: {localData.frequency.toFixed(3)}
            <InfoTooltip term="terrainFrequency" />
          </label>
          <input
            type="range"
            min={0.001}
            max={0.2}
            step={0.001}
            value={localData.frequency}
            onChange={(e) => handleChange('frequency', parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-zinc-400 flex items-center gap-1">
            Amplitude: {localData.amplitude.toFixed(2)}
            <InfoTooltip term="terrainAmplitude" />
          </label>
          <input
            type="range"
            min={0.0}
            max={1.0}
            step={0.01}
            value={localData.amplitude}
            onChange={(e) => handleChange('amplitude', parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-zinc-400 flex items-center gap-1">
            Height Scale: {localData.heightScale.toFixed(1)}
            <InfoTooltip term="terrainHeightScale" />
          </label>
          <input
            type="range"
            min={0.1}
            max={50.0}
            step={0.1}
            value={localData.heightScale}
            onChange={(e) => handleChange('heightScale', parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-2">
            <label className="text-xs text-zinc-400 flex items-center gap-1">
              Seed
              <InfoTooltip term="terrainSeed" />
            </label>
            <input
              type="number"
              value={localData.seed}
              onChange={(e) => handleChange('seed', parseInt(e.target.value))}
              className="w-full rounded bg-zinc-800 px-2 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={randomizeSeed}
            className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            <Shuffle size={14} />
            Randomize
          </button>
        </div>
      </div>
    </div>
  );
}
