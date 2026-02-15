import React, { useState, useCallback } from 'react';
import { useEditorStore } from '@/stores/editorStore';

interface LodData {
  lodDistances: [number, number, number];
  autoGenerate: boolean;
  lodRatios: [number, number, number];
  currentLod: number;
}

export function LodInspector() {
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const sceneGraph = useEditorStore((state) => state.sceneGraph);

  // For now, use local state until LOD events are wired from Rust
  const [lodData, setLodData] = useState<LodData>({
    lodDistances: [20, 50, 100],
    autoGenerate: false,
    lodRatios: [0.5, 0.25, 0.1],
    currentLod: 0,
  });

  const primaryId = Array.from(selectedIds)[0];
  const entity = primaryId ? sceneGraph.nodes[primaryId] : null;

  const handleDistanceChange = useCallback(
    (index: number, value: number) => {
      const newDistances: [number, number, number] = [...lodData.lodDistances] as [number, number, number];
      newDistances[index] = value;
      setLodData((prev) => ({ ...prev, lodDistances: newDistances }));

      // TODO: Wire to Rust engine when LOD system is fully implemented
    },
    [lodData.lodDistances]
  );

  const handleRatioChange = useCallback(
    (index: number, value: number) => {
      const newRatios: [number, number, number] = [...lodData.lodRatios] as [number, number, number];
      newRatios[index] = value;
      setLodData((prev) => ({ ...prev, lodRatios: newRatios }));

      // TODO: Wire to Rust engine when LOD system is fully implemented
    },
    [lodData.lodRatios]
  );

  const handleAutoGenerateToggle = useCallback(() => {
    const newValue = !lodData.autoGenerate;
    setLodData((prev) => ({ ...prev, autoGenerate: newValue }));

    // TODO: Wire to Rust engine when LOD system is fully implemented
  }, [lodData.autoGenerate]);

  const handleGenerateLods = useCallback(() => {
    // TODO: Wire to Rust engine when LOD generation is implemented
  }, []);

  if (!entity) {
    return null;
  }

  // Only show for mesh entities (check components array)
  const isMesh = entity.components?.some((comp) =>
    ['Mesh3d', 'Transform'].includes(comp)
  );
  if (!isMesh) {
    return null;
  }

  return (
    <div className="border-t border-gray-700 pt-3 mt-3">
      <h3 className="text-sm font-medium mb-3">LOD (Level of Detail)</h3>

      {/* Auto Generate Toggle */}
      <label className="flex items-center gap-2 mb-3">
        <input
          type="checkbox"
          checked={lodData.autoGenerate}
          onChange={handleAutoGenerateToggle}
          className="rounded"
        />
        <span className="text-sm">Auto-generate LODs</span>
      </label>

      {/* LOD Distances */}
      <div className="space-y-3 mb-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">LOD1 Distance</label>
          <input
            type="range"
            min="5"
            max="200"
            step="5"
            value={lodData.lodDistances[0]}
            onChange={(e) => handleDistanceChange(0, parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-gray-500 text-right">{lodData.lodDistances[0]}m</div>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">LOD2 Distance</label>
          <input
            type="range"
            min="10"
            max="300"
            step="10"
            value={lodData.lodDistances[1]}
            onChange={(e) => handleDistanceChange(1, parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-gray-500 text-right">{lodData.lodDistances[1]}m</div>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">LOD3 Distance</label>
          <input
            type="range"
            min="20"
            max="500"
            step="20"
            value={lodData.lodDistances[2]}
            onChange={(e) => handleDistanceChange(2, parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-gray-500 text-right">{lodData.lodDistances[2]}m</div>
        </div>
      </div>

      {/* Triangle Reduction Ratios */}
      <div className="space-y-3 mb-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">LOD1 Quality (50% default)</label>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.1"
            value={lodData.lodRatios[0]}
            onChange={(e) => handleRatioChange(0, parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-gray-500 text-right">{Math.round(lodData.lodRatios[0] * 100)}%</div>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">LOD2 Quality (25% default)</label>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.1"
            value={lodData.lodRatios[1]}
            onChange={(e) => handleRatioChange(1, parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-gray-500 text-right">{Math.round(lodData.lodRatios[1] * 100)}%</div>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">LOD3 Quality (10% default)</label>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.1"
            value={lodData.lodRatios[2]}
            onChange={(e) => handleRatioChange(2, parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-gray-500 text-right">{Math.round(lodData.lodRatios[2] * 100)}%</div>
        </div>
      </div>

      {/* Generate LODs Button */}
      <button
        onClick={handleGenerateLods}
        className="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-700 rounded text-sm transition-colors"
      >
        Generate LOD Meshes
      </button>

      {/* Current LOD Level Display */}
      <div className="mt-3 text-xs text-gray-400">
        Current LOD: Level {lodData.currentLod}
      </div>
    </div>
  );
}
