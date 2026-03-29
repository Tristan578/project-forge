'use client';

import { type ReactElement, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import type { Bone2dDef } from '@/stores/slices/types';

export function SkeletonInspector({ entityId }: { entityId: string }) {
  const skeleton = useEditorStore((s) => s.skeletons2d[entityId]);
  const animations = useEditorStore((s) => s.skeletalAnimations2d[entityId] ?? []);
  const selectedBone = useEditorStore((s) => s.selectedBone);
  const setSelectedBone = useEditorStore((s) => s.setSelectedBone);
  const setSkeleton2d = useEditorStore((s) => s.setSkeleton2d);
  const removeSkeleton2d = useEditorStore((s) => s.removeSkeleton2d);
  const playAnimation = useEditorStore((s) => s.playAnimation);

  const [newBoneName, setNewBoneName] = useState('');
  const [selectedSkin, setSelectedSkin] = useState(skeleton?.activeSkin ?? 'default');

  if (!skeleton) {
    return (
      <div className="px-3 py-2 space-y-2">
        <div className="text-sm text-zinc-400 mb-2">No skeleton data</div>
        <button
          onClick={() => {
            setSkeleton2d(entityId, {
              bones: [],
              slots: [],
              skins: {},
              activeSkin: 'default',
              ikConstraints: [],
            });
          }}
          className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded flex items-center justify-center gap-2 text-sm"
        >
          <Plus className="w-4 h-4" />
          Add Skeleton
        </button>
      </div>
    );
  }

  const handleAddBone = () => {
    if (!newBoneName.trim()) return;
    const bone: Bone2dDef = {
      name: newBoneName.trim(),
      parentBone: selectedBone ?? null,
      localPosition: [0, 0],
      localRotation: 0,
      localScale: [1, 1],
      length: 1,
      color: [1, 1, 1, 1],
    };
    setSkeleton2d(entityId, { ...skeleton, bones: [...skeleton.bones, bone] });
    setNewBoneName('');
  };

  const handleDeleteBone = (boneName: string) => {
    setSkeleton2d(entityId, {
      ...skeleton,
      bones: skeleton.bones.filter(b => b.name !== boneName),
    });
    if (selectedBone === boneName) {
      setSelectedBone(null);
    }
  };

  const handleUpdateBone = (boneName: string, field: string, value: number | number[]) => {
    const bones = skeleton.bones.map(b => {
      if (b.name !== boneName) return b;
      switch (field) {
        case 'position': return { ...b, localPosition: value as [number, number] };
        case 'rotation': return { ...b, localRotation: value as number };
        case 'scale': return { ...b, localScale: value as [number, number] };
        case 'length': return { ...b, length: value as number };
        default: return b;
      }
    });
    setSkeleton2d(entityId, { ...skeleton, bones });
  };

  const handleSkinChange = (skinName: string) => {
    setSelectedSkin(skinName);
    setSkeleton2d(entityId, { ...skeleton, activeSkin: skinName });
  };

  const handlePlayAnimation = (animName: string) => {
    playAnimation(entityId, animName);
  };

  const selectedBoneData = skeleton.bones.find(b => b.name === selectedBone);

  // Build bone hierarchy for display
  const buildBoneTree = (parentName: string | null, indent = 0): ReactElement[] => {
    const children = skeleton.bones.filter(b => b.parentBone === parentName);
    return children.flatMap(bone => [
      <div key={bone.name} className="flex items-center gap-2 py-1">
        <div style={{ paddingLeft: `${indent * 12}px` }} className="flex-1 flex items-center gap-2">
          <button
            onClick={() => setSelectedBone(bone.name)}
            className={`px-2 py-1 rounded text-sm flex-1 text-left ${
              selectedBone === bone.name ? 'bg-blue-600' : 'bg-zinc-700 hover:bg-zinc-600'
            }`}
          >
            {bone.name}
          </button>
          <button
            onClick={() => handleDeleteBone(bone.name)}
            className="p-1 hover:bg-red-600 rounded"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>,
      ...buildBoneTree(bone.name, indent + 1)
    ]);
  };

  return (
    <div className="px-3 py-2 space-y-3">
      {/* Bone Hierarchy */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium flex items-center gap-1">
            Bone Hierarchy
            <InfoTooltip text="Tree view of all bones in the skeleton" />
          </label>
        </div>
        <div className="bg-zinc-800 rounded p-2 max-h-40 overflow-y-auto">
          {skeleton.bones.length === 0 ? (
            <div className="text-xs text-zinc-400">No bones</div>
          ) : (
            buildBoneTree(null)
          )}
        </div>
      </div>

      {/* Add Bone */}
      <div>
        <label className="text-sm font-medium block mb-1">Create Bone</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={newBoneName}
            onChange={(e) => setNewBoneName(e.target.value)}
            placeholder="Bone name"
            className="flex-1 px-2 py-1 bg-zinc-800 rounded text-sm"
            onKeyDown={(e) => e.key === 'Enter' && handleAddBone()}
          />
          <button
            onClick={handleAddBone}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="text-xs text-zinc-400 mt-1">
          {selectedBone ? `Parent: ${selectedBone}` : 'Root bone'}
        </div>
      </div>

      {/* Selected Bone Properties */}
      {selectedBoneData && (
        <div className="border-t border-zinc-700 pt-3">
          <div className="text-sm font-medium mb-2">Bone: {selectedBoneData.name}</div>

          <div className="space-y-2">
            <div>
              <label className="text-xs text-zinc-400">Position</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={selectedBoneData.localPosition[0]}
                  onChange={(e) => handleUpdateBone(selectedBoneData.name, 'position', [
                    parseFloat(e.target.value),
                    selectedBoneData.localPosition[1]
                  ])}
                  className="w-20 px-2 py-1 bg-zinc-800 rounded text-sm"
                  step="0.1"
                />
                <input
                  type="number"
                  value={selectedBoneData.localPosition[1]}
                  onChange={(e) => handleUpdateBone(selectedBoneData.name, 'position', [
                    selectedBoneData.localPosition[0],
                    parseFloat(e.target.value)
                  ])}
                  className="w-20 px-2 py-1 bg-zinc-800 rounded text-sm"
                  step="0.1"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-zinc-400">Rotation (deg)</label>
              <input
                type="number"
                value={selectedBoneData.localRotation}
                onChange={(e) => handleUpdateBone(selectedBoneData.name, 'rotation', parseFloat(e.target.value))}
                className="w-full px-2 py-1 bg-zinc-800 rounded text-sm"
                step="1"
              />
            </div>

            <div>
              <label className="text-xs text-zinc-400">Scale</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={selectedBoneData.localScale[0]}
                  onChange={(e) => handleUpdateBone(selectedBoneData.name, 'scale', [
                    parseFloat(e.target.value),
                    selectedBoneData.localScale[1]
                  ])}
                  className="w-20 px-2 py-1 bg-zinc-800 rounded text-sm"
                  step="0.1"
                />
                <input
                  type="number"
                  value={selectedBoneData.localScale[1]}
                  onChange={(e) => handleUpdateBone(selectedBoneData.name, 'scale', [
                    selectedBoneData.localScale[0],
                    parseFloat(e.target.value)
                  ])}
                  className="w-20 px-2 py-1 bg-zinc-800 rounded text-sm"
                  step="0.1"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-zinc-400">Length</label>
              <input
                type="number"
                value={selectedBoneData.length}
                onChange={(e) => handleUpdateBone(selectedBoneData.name, 'length', parseFloat(e.target.value))}
                className="w-full px-2 py-1 bg-zinc-800 rounded text-sm"
                step="1"
              />
            </div>
          </div>
        </div>
      )}

      {/* Skin Selector */}
      <div>
        <label className="text-sm font-medium block mb-1 flex items-center gap-1">
          Active Skin
          <InfoTooltip text="Switch between different sprite sets" />
        </label>
        <select
          value={selectedSkin}
          onChange={(e) => handleSkinChange(e.target.value)}
          className="w-full px-2 py-1 bg-zinc-800 rounded text-sm"
        >
          {Object.keys(skeleton.skins).map(skinName => (
            <option key={skinName} value={skinName}>{skinName}</option>
          ))}
        </select>
      </div>

      {/* IK Constraints */}
      {skeleton.ikConstraints.length > 0 && (
        <div>
          <label className="text-sm font-medium block mb-1">IK Constraints</label>
          <div className="space-y-1">
            {skeleton.ikConstraints.map((ik, idx) => (
              <div key={idx} className="text-xs bg-zinc-800 rounded px-2 py-1">
                <div className="font-medium">{ik.name}</div>
                <div className="text-zinc-400">
                  Bones: {ik.boneChain.join(' → ')}
                </div>
                <div className="text-zinc-400">
                  Mix: {(ik.mix * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Animations */}
      {animations.length > 0 && (
        <div>
          <label className="text-sm font-medium block mb-1">Animations</label>
          <div className="space-y-1">
            {animations.map((anim) => (
              <button
                key={anim.name}
                onClick={() => handlePlayAnimation(anim.name)}
                className="w-full text-left px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-sm"
              >
                {anim.name} ({anim.duration.toFixed(1)}s)
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Remove Skeleton */}
      <button
        onClick={() => {
          // TODO(PF): Replace confirm() with an inline confirmation dialog (accessible, styled).
          if (confirm('Remove skeleton data?')) {
            removeSkeleton2d(entityId);
            setSelectedBone(null);
          }
        }}
        className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 rounded flex items-center justify-center gap-2 text-sm"
      >
        <Trash2 className="w-4 h-4" />
        Remove Skeleton
      </button>
    </div>
  );
}
