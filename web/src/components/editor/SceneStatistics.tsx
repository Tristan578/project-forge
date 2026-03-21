'use client';

import { memo, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';

interface StatRow {
  label: string;
  value: number;
  color?: string;
}

export const SceneStatistics = memo(function SceneStatistics() {
  const [expanded, setExpanded] = useState(false);

  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const allScripts = useEditorStore((s) => s.allScripts);
  const assetRegistry = useEditorStore((s) => s.assetRegistry);
  const sprites = useEditorStore((s) => s.sprites);
  const sortingLayers = useEditorStore((s) => s.sortingLayers);

  const stats = useMemo(() => {
    const nodes = sceneGraph.nodes;
    const entityIds = Object.keys(nodes);
    const totalEntities = entityIds.length;
    const totalScripts = Object.keys(allScripts).length;
    const totalAssets = Object.keys(assetRegistry).length;
    const totalSprites = Object.keys(sprites).length;

    // Count component types from sceneGraph node data
    let lightCount = 0;
    let physicsCount = 0;
    let audioCount = 0;
    let particleCount = 0;
    let gameComponentCount = 0;
    let animClipCount = 0;

    for (const id of entityIds) {
      const components = nodes[id]?.components;
      if (!Array.isArray(components)) continue;
      for (const c of components) {
        if (c === 'Light' || c === 'PointLight' || c === 'DirectionalLight' || c === 'SpotLight') lightCount++;
        if (c === 'Physics' || c === 'RigidBody') physicsCount++;
        if (c === 'Audio') audioCount++;
        if (c === 'Particle') particleCount++;
        if (c === 'GameComponent') gameComponentCount++;
        if (c === 'AnimationClip') animClipCount++;
      }
    }

    // Asset breakdown
    const textureCount = Object.values(assetRegistry).filter((a) => a.kind === 'texture').length;
    const modelCount = Object.values(assetRegistry).filter((a) => a.kind === 'gltf_model').length;
    const audioAssetCount = Object.values(assetRegistry).filter((a) => a.kind === 'audio').length;

    return {
      totalEntities,
      totalScripts,
      totalAssets,
      totalSprites,
      lightCount,
      physicsCount,
      audioCount,
      particleCount,
      gameComponentCount,
      animClipCount,
      textureCount,
      modelCount,
      audioAssetCount,
      sortingLayerCount: sortingLayers.length,
    };
  }, [sceneGraph, allScripts, assetRegistry, sprites, sortingLayers]);

  const summaryItems: StatRow[] = [
    { label: 'Entities', value: stats.totalEntities, color: 'text-blue-400' },
    { label: 'Scripts', value: stats.totalScripts, color: 'text-green-400' },
    { label: 'Assets', value: stats.totalAssets, color: 'text-amber-400' },
  ];

  const componentBreakdown: StatRow[] = [
    { label: 'Sprites', value: stats.totalSprites },
    { label: 'Lights', value: stats.lightCount },
    { label: 'Physics Bodies', value: stats.physicsCount },
    { label: 'Audio Sources', value: stats.audioCount },
    { label: 'Particles', value: stats.particleCount },
    { label: 'Game Components', value: stats.gameComponentCount },
    { label: 'Animation Clips', value: stats.animClipCount },
  ].filter((r) => r.value > 0);

  const assetBreakdown: StatRow[] = [
    { label: 'Textures', value: stats.textureCount },
    { label: 'Models', value: stats.modelCount },
    { label: 'Audio Files', value: stats.audioAssetCount },
  ].filter((r) => r.value > 0);

  return (
    <div className="border-t border-zinc-800 pt-4">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="mb-2 flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-400"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Scene Statistics
      </button>

      {/* Summary row — always visible */}
      <div className="flex items-center gap-3">
        {summaryItems.map((item) => (
          <div key={item.label} className="flex items-center gap-1">
            <span className={`text-xs font-medium tabular-nums ${item.color ?? 'text-zinc-300'}`}>
              {item.value}
            </span>
            <span className="text-[10px] text-zinc-500">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Expanded breakdown */}
      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Component Breakdown */}
          {componentBreakdown.length > 0 && (
            <div>
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Components
              </h4>
              <div className="space-y-0.5">
                {componentBreakdown.map((row) => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">{row.label}</span>
                    <span className="text-xs tabular-nums text-zinc-300">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Asset Breakdown */}
          {assetBreakdown.length > 0 && (
            <div>
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Assets
              </h4>
              <div className="space-y-0.5">
                {assetBreakdown.map((row) => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">{row.label}</span>
                    <span className="text-xs tabular-nums text-zinc-300">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sorting Layers */}
          {stats.sortingLayerCount > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">Sorting Layers</span>
              <span className="text-xs tabular-nums text-zinc-300">{stats.sortingLayerCount}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/* Exported for testing */
export type { StatRow };
