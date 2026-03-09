import React, { useState, useCallback } from 'react';
import { useEditorStore, getCommandDispatcher } from '@/stores/editorStore';
import { usePerformanceStore } from '@/stores/performanceStore';

interface LodConfig {
  lodDistances: [number, number, number];
  autoGenerate: boolean;
  lodRatios: [number, number, number];
}

export function LodInspector() {
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const sceneGraph = useEditorStore((state) => state.sceneGraph);

  const primaryId = Array.from(selectedIds)[0];
  const currentLod = usePerformanceStore((state) => primaryId ? (state.lodLevels[primaryId] ?? 0) : 0);

  const [lodConfig, setLodConfig] = useState<LodConfig>({
    lodDistances: [20, 50, 100],
    autoGenerate: false,
    lodRatios: [0.5, 0.25, 0.1],
  });
  const [generateStatus, setGenerateStatus] = useState<string | null>(null);

  const entity = primaryId ? sceneGraph.nodes[primaryId] : null;

  const dispatchToEngine = useCallback((command: string, payload: unknown) => {
    const dispatch = getCommandDispatcher();
    if (dispatch) dispatch(command, payload);
  }, []);

  const handleDistanceChange = useCallback(
    (index: number, value: number) => {
      const newDistances: [number, number, number] = [...lodConfig.lodDistances] as [number, number, number];
      newDistances[index] = value;
      setLodConfig((prev) => ({ ...prev, lodDistances: newDistances }));
    },
    [lodConfig.lodDistances]
  );

  const handleRatioChange = useCallback(
    (index: number, value: number) => {
      const newRatios: [number, number, number] = [...lodConfig.lodRatios] as [number, number, number];
      newRatios[index] = value;
      setLodConfig((prev) => ({ ...prev, lodRatios: newRatios }));
    },
    [lodConfig.lodRatios]
  );

  const handleAutoGenerateToggle = useCallback(() => {
    const newValue = !lodConfig.autoGenerate;
    setLodConfig((prev) => ({ ...prev, autoGenerate: newValue }));
    if (primaryId) {
      dispatchToEngine('set_lod', {
        entityId: primaryId,
        lodDistances: lodConfig.lodDistances,
        autoGenerate: newValue,
        lodRatios: lodConfig.lodRatios,
      });
    }
  }, [lodConfig, primaryId, dispatchToEngine]);

  const handleGenerateLods = useCallback(() => {
    if (primaryId) {
      dispatchToEngine('set_lod', {
        entityId: primaryId,
        lodDistances: lodConfig.lodDistances,
        autoGenerate: lodConfig.autoGenerate,
        lodRatios: lodConfig.lodRatios,
      });
      dispatchToEngine('generate_lods', { entityId: primaryId });
      setGenerateStatus('LOD meshes generated via QEM simplification. Distance-based switching is active.');
    }
  }, [primaryId, lodConfig, dispatchToEngine]);

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

  const lodLabels = ['Full', 'Medium', 'Low', 'Lowest'];

  return (
    <div className="border-t border-gray-700 pt-3 mt-3">
      <h3 className="text-sm font-medium mb-3">LOD (Level of Detail)</h3>

      {/* Auto Generate Toggle */}
      <label className="flex items-center gap-2 mb-3">
        <input
          type="checkbox"
          checked={lodConfig.autoGenerate}
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
            value={lodConfig.lodDistances[0]}
            onChange={(e) => handleDistanceChange(0, parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-gray-500 text-right">{lodConfig.lodDistances[0]}m</div>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">LOD2 Distance</label>
          <input
            type="range"
            min="10"
            max="300"
            step="10"
            value={lodConfig.lodDistances[1]}
            onChange={(e) => handleDistanceChange(1, parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-gray-500 text-right">{lodConfig.lodDistances[1]}m</div>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">LOD3 Distance</label>
          <input
            type="range"
            min="20"
            max="500"
            step="20"
            value={lodConfig.lodDistances[2]}
            onChange={(e) => handleDistanceChange(2, parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-gray-500 text-right">{lodConfig.lodDistances[2]}m</div>
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
            value={lodConfig.lodRatios[0]}
            onChange={(e) => handleRatioChange(0, parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-gray-500 text-right">{Math.round(lodConfig.lodRatios[0] * 100)}%</div>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">LOD2 Quality (25% default)</label>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.1"
            value={lodConfig.lodRatios[1]}
            onChange={(e) => handleRatioChange(1, parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-gray-500 text-right">{Math.round(lodConfig.lodRatios[1] * 100)}%</div>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">LOD3 Quality (10% default)</label>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.1"
            value={lodConfig.lodRatios[2]}
            onChange={(e) => handleRatioChange(2, parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-gray-500 text-right">{Math.round(lodConfig.lodRatios[2] * 100)}%</div>
        </div>
      </div>

      {/* Generate LODs Button */}
      <button
        onClick={handleGenerateLods}
        className="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-700 rounded text-sm transition-colors"
      >
        Generate LOD Meshes
      </button>

      {/* Status Message */}
      {generateStatus && (
        <div className="mt-2 text-xs text-amber-400 bg-amber-900/20 rounded px-2 py-1.5">
          {generateStatus}
        </div>
      )}

      {/* Current LOD Level Display */}
      <div className="mt-3 text-xs text-gray-400">
        Current LOD: Level {currentLod} ({lodLabels[currentLod] ?? 'Unknown'})
      </div>
    </div>
  );
}
