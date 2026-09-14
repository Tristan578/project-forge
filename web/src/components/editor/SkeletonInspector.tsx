'use client';

import { type ReactElement, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { boneNameList } from '@/lib/skeleton2d/skeletonPayload';
import type { Bone2dDef, AttachmentData2d, VertexWeights2d } from '@/stores/slices/types';

/** One bone influence on a vertex, held as strings while the row is edited. */
interface MeshInfluenceDraft {
  bone: string;
  weight: string;
}

/** A vertex being edited: position plus its bone influences. */
interface MeshVertexDraft {
  x: string;
  y: string;
  influences: MeshInfluenceDraft[];
}

/**
 * The in-progress mesh attachment. `original` is the key it edits (or `null` for
 * a brand-new attachment), so Apply replaces the right slot.
 */
interface MeshDraft {
  name: string;
  original: string | null;
  vertices: MeshVertexDraft[];
}

export function SkeletonInspector({ entityId }: { entityId: string }) {
  const skeleton = useEditorStore((s) => s.skeletons2d[entityId]);
  const animations = useEditorStore((s) => s.skeletalAnimations2d[entityId] ?? []);
  const selectedBone = useEditorStore((s) => s.selectedBone);
  const setSelectedBone = useEditorStore((s) => s.setSelectedBone);
  const setSkeleton2d = useEditorStore((s) => s.setSkeleton2d);
  const removeSkeleton2d = useEditorStore((s) => s.removeSkeleton2d);
  const playAnimation = useEditorStore((s) => s.playAnimation);
  const { confirm, ConfirmDialogPortal } = useConfirmDialog();

  const [newBoneName, setNewBoneName] = useState('');
  const [selectedSkin, setSelectedSkin] = useState(skeleton?.activeSkin ?? 'default');
  const [newAttachmentName, setNewAttachmentName] = useState('');
  const [meshDraft, setMeshDraft] = useState<MeshDraft | null>(null);
  const [meshError, setMeshError] = useState<string | null>(null);

  if (!skeleton) {
    return (
      <div className="px-3 py-2 space-y-2">
        <div className="text-sm text-zinc-400 mb-2">No skeleton data</div>
        <button
          type="button"
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
    setMeshDraft(null);
    setMeshError(null);
    setSkeleton2d(entityId, { ...skeleton, activeSkin: skinName });
  };

  // --- Mesh attachments (#9732) ---------------------------------------------
  // The manual, no-chat authoring path for the same vertex/weight data
  // `add_skeleton2d_mesh_attachment` writes. Edits round-trip through
  // `setSkeleton2d` like every other change in this panel, and Apply shares the
  // command's validation: an influence must name a real bone, and a vertex must
  // carry a positive total weight or the engine's skinning drops it to its bind
  // position. Weights are rejected, not silently normalized, so an author sees
  // and fixes the row rather than having their numbers quietly rewritten.
  const activeSkinData = skeleton.skins[selectedSkin];
  const meshAttachments = Object.entries(activeSkinData?.attachments ?? {}).filter(
    ([, a]) => a.type === 'mesh',
  );
  const boneNames = new Set(skeleton.bones.map(b => b.name));

  const updateDraft = (updater: (draft: MeshDraft) => MeshDraft) => {
    setMeshDraft(prev => (prev ? updater(prev) : prev));
  };

  const handleAddMeshAttachment = () => {
    const name = newAttachmentName.trim();
    if (!name) return;
    if (Object.hasOwn(activeSkinData?.attachments ?? {}, name)) {
      setMeshError(`An attachment named "${name}" already exists in skin "${selectedSkin}".`);
      return;
    }
    const firstBone = skeleton.bones[0]?.name ?? '';
    setMeshDraft({
      name,
      original: null,
      vertices: [{ x: '0', y: '0', influences: [{ bone: firstBone, weight: '1' }] }],
    });
    setMeshError(null);
    setNewAttachmentName('');
  };

  const handleEditMeshAttachment = (name: string) => {
    const attachment = activeSkinData?.attachments?.[name];
    if (!attachment || attachment.type !== 'mesh') return;
    const vertices = attachment.vertices ?? [];
    const weights = attachment.weights ?? [];
    setMeshDraft({
      name,
      original: name,
      vertices: vertices.map((v, i) => ({
        x: String(v[0]),
        y: String(v[1]),
        influences: (weights[i]?.bones ?? []).map((bone, j) => ({
          bone,
          weight: String(weights[i]?.weights?.[j] ?? 0),
        })),
      })),
    });
    setMeshError(null);
  };

  const handleDeleteMeshAttachment = (name: string) => {
    if (!activeSkinData) return;
    const { [name]: _removed, ...rest } = activeSkinData.attachments;
    setSkeleton2d(entityId, {
      ...skeleton,
      skins: { ...skeleton.skins, [selectedSkin]: { ...activeSkinData, attachments: rest } },
    });
    if (meshDraft?.original === name) {
      setMeshDraft(null);
      setMeshError(null);
    }
  };

  const handleApplyMesh = () => {
    if (!meshDraft) return;
    if (meshDraft.vertices.length === 0) {
      setMeshError('A mesh attachment needs at least one vertex.');
      return;
    }
    const vertices: [number, number][] = [];
    const weights: VertexWeights2d[] = [];
    for (let i = 0; i < meshDraft.vertices.length; i += 1) {
      const vertex = meshDraft.vertices[i];
      const x = Number(vertex.x);
      const y = Number(vertex.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        setMeshError(`Vertex ${i + 1} has a non-numeric position.`);
        return;
      }
      const bones: string[] = [];
      const vertexWeights: number[] = [];
      let total = 0;
      for (let j = 0; j < vertex.influences.length; j += 1) {
        const influence = vertex.influences[j];
        const bone = influence.bone.trim();
        if (!bone) {
          setMeshError(`Vertex ${i + 1} influence ${j + 1} has no bone.`);
          return;
        }
        if (!boneNames.has(bone)) {
          setMeshError(
            `Vertex ${i + 1} references unknown bone "${bone}". Add that bone or fix the name.`,
          );
          return;
        }
        const weight = Number(influence.weight);
        if (!Number.isFinite(weight)) {
          setMeshError(`Vertex ${i + 1} influence ${j + 1} has a non-numeric weight.`);
          return;
        }
        bones.push(bone);
        vertexWeights.push(weight);
        total += weight;
      }
      if (total <= 0) {
        setMeshError(
          `Vertex ${i + 1} has zero total weight — give it at least one bone with a positive weight.`,
        );
        return;
      }
      vertices.push([x, y]);
      weights.push({ bones, weights: vertexWeights });
    }

    const attachment: AttachmentData2d = {
      type: 'mesh',
      textureId: '',
      vertices,
      uvs: vertices.map(() => [0, 0] as [number, number]),
      triangles: [],
      weights,
    };
    const skin = activeSkinData ?? { name: selectedSkin, attachments: {} };
    setSkeleton2d(entityId, {
      ...skeleton,
      skins: {
        ...skeleton.skins,
        [selectedSkin]: {
          ...skin,
          attachments: { ...skin.attachments, [meshDraft.name]: attachment },
        },
      },
    });
    setMeshError(null);
    setMeshDraft(null);
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
            type="button"
            onClick={() => setSelectedBone(bone.name)}
            className={`px-2 py-1 rounded text-sm flex-1 text-left ${
              selectedBone === bone.name ? 'bg-blue-600' : 'bg-zinc-700 hover:bg-zinc-600'
            }`}
          >
            {bone.name}
          </button>
          <button
            type="button"
            onClick={() => handleDeleteBone(bone.name)}
            className="p-1 hover:bg-red-600 rounded"
            aria-label={`Delete bone ${bone.name}`}
          >
            <Trash2 className="w-3 h-3" aria-hidden="true" />
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
            type="button"
            onClick={handleAddBone}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm"
            aria-label={selectedBone ? `Add bone as a child of ${selectedBone}` : 'Add root bone'}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
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

      {/* Mesh Attachments (#9732) */}
      <div className="border-t border-zinc-700 pt-3">
        <label className="text-sm font-medium mb-1 flex items-center gap-1">
          Mesh Attachments
          <InfoTooltip text="Define deformable meshes: vertices and the bone weights that skin them. No chat or command needed." />
        </label>

        {meshAttachments.length === 0 ? (
          <div className="text-xs text-zinc-400 mb-2">No mesh attachments in this skin</div>
        ) : (
          <div className="space-y-1 mb-2">
            {meshAttachments.map(([name, attachment]) => (
              <div key={name} className="flex items-center gap-2 text-xs bg-zinc-800 rounded px-2 py-1">
                <span className="flex-1 truncate">
                  {name} ({attachment.vertices?.length ?? 0} verts)
                </span>
                <button
                  type="button"
                  onClick={() => handleEditMeshAttachment(name)}
                  className="px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 rounded"
                  aria-label={`Edit mesh attachment ${name}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteMeshAttachment(name)}
                  className="p-1 hover:bg-red-600 rounded"
                  aria-label={`Delete mesh attachment ${name}`}
                >
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={newAttachmentName}
            onChange={(e) => setNewAttachmentName(e.target.value)}
            placeholder="Attachment name"
            className="flex-1 px-2 py-1 bg-zinc-800 rounded text-sm"
            onKeyDown={(e) => e.key === 'Enter' && handleAddMeshAttachment()}
          />
          <button
            type="button"
            onClick={handleAddMeshAttachment}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm"
            aria-label="Add mesh attachment"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {meshDraft && (
          <div className="mt-2 bg-zinc-800 rounded p-2 space-y-2">
            <div className="text-sm font-medium">Mesh: {meshDraft.name}</div>

            {meshDraft.vertices.map((vertex, vi) => (
              <div key={vi} className="border-t border-zinc-700 pt-2 first:border-t-0 first:pt-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-zinc-400 w-14">Vertex {vi + 1}</span>
                  <input
                    type="number"
                    value={vertex.x}
                    onChange={(e) =>
                      updateDraft(d => ({
                        ...d,
                        vertices: d.vertices.map((v, i) => (i === vi ? { ...v, x: e.target.value } : v)),
                      }))
                    }
                    className="w-16 px-2 py-1 bg-zinc-900 rounded text-sm"
                    step="0.1"
                    aria-label={`Vertex ${vi + 1} X`}
                  />
                  <input
                    type="number"
                    value={vertex.y}
                    onChange={(e) =>
                      updateDraft(d => ({
                        ...d,
                        vertices: d.vertices.map((v, i) => (i === vi ? { ...v, y: e.target.value } : v)),
                      }))
                    }
                    className="w-16 px-2 py-1 bg-zinc-900 rounded text-sm"
                    step="0.1"
                    aria-label={`Vertex ${vi + 1} Y`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      updateDraft(d => ({ ...d, vertices: d.vertices.filter((_, i) => i !== vi) }))
                    }
                    className="p-1 hover:bg-red-600 rounded ml-auto"
                    aria-label={`Remove vertex ${vi + 1}`}
                  >
                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                  </button>
                </div>

                <div className="pl-14 space-y-1">
                  {vertex.influences.map((influence, ii) => (
                    <div key={ii} className="flex items-center gap-2">
                      <input
                        type="text"
                        list="skeleton-bone-names"
                        value={influence.bone}
                        onChange={(e) =>
                          updateDraft(d => ({
                            ...d,
                            vertices: d.vertices.map((v, i) =>
                              i === vi
                                ? {
                                    ...v,
                                    influences: v.influences.map((inf, j) =>
                                      j === ii ? { ...inf, bone: e.target.value } : inf,
                                    ),
                                  }
                                : v,
                            ),
                          }))
                        }
                        placeholder="Bone"
                        className="flex-1 px-2 py-1 bg-zinc-900 rounded text-sm"
                        aria-label={`Vertex ${vi + 1} influence ${ii + 1} bone`}
                      />
                      <input
                        type="number"
                        value={influence.weight}
                        onChange={(e) =>
                          updateDraft(d => ({
                            ...d,
                            vertices: d.vertices.map((v, i) =>
                              i === vi
                                ? {
                                    ...v,
                                    influences: v.influences.map((inf, j) =>
                                      j === ii ? { ...inf, weight: e.target.value } : inf,
                                    ),
                                  }
                                : v,
                            ),
                          }))
                        }
                        className="w-16 px-2 py-1 bg-zinc-900 rounded text-sm"
                        step="0.1"
                        aria-label={`Vertex ${vi + 1} influence ${ii + 1} weight`}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateDraft(d => ({
                            ...d,
                            vertices: d.vertices.map((v, i) =>
                              i === vi
                                ? { ...v, influences: v.influences.filter((_, j) => j !== ii) }
                                : v,
                            ),
                          }))
                        }
                        className="p-1 hover:bg-red-600 rounded"
                        aria-label={`Remove influence ${ii + 1} from vertex ${vi + 1}`}
                      >
                        <Trash2 className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      updateDraft(d => ({
                        ...d,
                        vertices: d.vertices.map((v, i) =>
                          i === vi
                            ? {
                                ...v,
                                influences: [
                                  ...v.influences,
                                  { bone: skeleton.bones[0]?.name ?? '', weight: '1' },
                                ],
                              }
                            : v,
                        ),
                      }))
                    }
                    className="text-xs text-blue-400 hover:text-blue-300"
                    aria-label={`Add influence to vertex ${vi + 1}`}
                  >
                    + Add influence
                  </button>
                </div>
              </div>
            ))}

            <datalist id="skeleton-bone-names">
              {skeleton.bones.map(b => (
                <option key={b.name} value={b.name} />
              ))}
            </datalist>

            <button
              type="button"
              onClick={() =>
                updateDraft(d => ({
                  ...d,
                  vertices: [
                    ...d.vertices,
                    { x: '0', y: '0', influences: [{ bone: skeleton.bones[0]?.name ?? '', weight: '1' }] },
                  ],
                }))
              }
              className="text-xs text-blue-400 hover:text-blue-300 block"
            >
              + Add vertex
            </button>

            {meshError && (
              <div className="text-xs text-red-400" role="alert">
                {meshError}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleApplyMesh}
                className="flex-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm"
              >
                Apply Mesh Attachment
              </button>
              <button
                type="button"
                onClick={() => {
                  setMeshDraft(null);
                  setMeshError(null);
                }}
                className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* IK Constraints */}
      {skeleton.ikConstraints.length > 0 && (
        <div>
          <label className="text-sm font-medium block mb-1">IK Constraints</label>
          <div className="space-y-1">
            {skeleton.ikConstraints.map((ik, idx) => {
              // The engine's solver skips any constraint whose `target_entity_id`
              // it cannot resolve, and an empty one never resolves. The panel used
              // to render such a constraint identically to a working one — name,
              // chain, mix — so a chain that could never move a bone looked live.
              //
              // `!== ''` is not the test. `setSkeleton2d` writes its argument into
              // the store verbatim, so the key can be absent entirely, and
              // `undefined !== ''` is `true` — the inactive treatment would then
              // miss the very case it was written for and render a bare "Target: ".
              const rawTarget: unknown = ik.targetEntityId;
              const target =
                typeof rawTarget === 'string' || typeof rawTarget === 'number'
                  ? String(rawTarget)
                  : '';
              const hasTarget = target.length > 0;
              const bendsNegative =
                typeof ik.bendDirection === 'number' &&
                Number.isFinite(ik.bendDirection) &&
                ik.bendDirection < 0;
              // Same reason as `rawTarget` above, one field over. `boneChain` can
              // be absent, so `.join` threw a TypeError out of render and blanked
              // the whole inspector — a user imports a rig and the panel vanishes.
              // It can also hold a `null`, which rendered as an empty segment
              // ("a →  → b") while the builder drops it and sends "a → b".
              const chain = boneNameList(ik.boneChain);
              // The last of the three numeric fields to be brought into line with
              // `wireIkConstraint`. The raw read printed `Mix: NaN%` for a missing
              // key while the engine received 100%, and `150%` for a value the
              // builder clamps to 100%.
              const mixSource: unknown = ik.mix;
              const mix =
                typeof mixSource === 'number' && Number.isFinite(mixSource)
                  ? Math.min(1, Math.max(0, mixSource))
                  : 1;
              return (
                <div
                  key={idx}
                  // A left rule rather than `opacity-60`: group opacity compounds
                  // with the row's already-dim colours, and it dropped the amber
                  // "(inactive)" flag to 4.13:1 and the zinc body text to 2.99:1 —
                  // making the one row that reports a problem the hardest to read.
                  //
                  // The rule is reserved on BOTH branches. `box-sizing: border-box`
                  // means a border only on the flagged row insets its text by 2px
                  // against every sibling, so the column reads ragged on precisely
                  // the row you most want to read cleanly. Same `amber-400` as the
                  // "(inactive)" text it reinforces — one state, one accent.
                  className={`text-xs bg-zinc-800 rounded px-2 py-1 border-l-2 ${hasTarget ? 'border-transparent' : 'border-amber-400'}`}
                >
                  <div className="font-medium">
                    {ik.name}
                    {!hasTarget && (
                      <span className="ml-1.5 font-normal text-amber-400">(inactive)</span>
                    )}
                  </div>
                  <div className="text-zinc-400">
                    Bones: {chain.length > 0 ? chain.join(' → ') : 'none'}
                  </div>
                  <div className={hasTarget ? 'text-zinc-400' : 'text-amber-400'}>
                    Target: {hasTarget ? target : 'not set — this chain will not solve'}
                  </div>
                  <div className="text-zinc-400">
                    {/* Mirrors `wireIkConstraint`'s rule exactly. `>= 0` reads a
                        missing or NaN bend direction as "negative" while the
                        builder sends +1, so the panel contradicted the payload. */}
                    Bend: {bendsNegative ? 'negative' : 'positive'}
                  </div>
                  <div className="text-zinc-400">
                    Mix: {(mix * 100).toFixed(0)}%
                  </div>
                </div>
              );
            })}
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
                type="button"
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
        type="button"
        onClick={async () => {
          if (await confirm('Remove skeleton data?')) {
            removeSkeleton2d(entityId);
            setSelectedBone(null);
          }
        }}
        className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 rounded flex items-center justify-center gap-2 text-sm"
      >
        <Trash2 className="w-4 h-4" />
        Remove Skeleton
      </button>
      <ConfirmDialogPortal />
    </div>
  );
}
