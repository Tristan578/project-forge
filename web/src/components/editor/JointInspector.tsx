'use client';

import { useCallback, useMemo } from 'react';
import { useEditorStore, type JointData } from '@/stores/editorStore';

const JOINT_TYPES = ['fixed', 'revolute', 'spherical', 'prismatic', 'rope', 'spring'] as const;

export function JointInspector() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const primaryJoint = useEditorStore((s) => s.primaryJoint);
  const physicsEnabled = useEditorStore((s) => s.physicsEnabled);
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const createJoint = useEditorStore((s) => s.createJoint);
  const updateJoint = useEditorStore((s) => s.updateJoint);
  const removeJoint = useEditorStore((s) => s.removeJoint);

  // Get list of other entities for the connected entity picker
  const otherEntities = useMemo(() => {
    if (!primaryId) return [];
    return Object.values(sceneGraph.nodes)
      .filter((n) => n.entityId !== primaryId)
      .map((n) => ({ id: n.entityId, name: n.name }));
  }, [sceneGraph, primaryId]);

  const handleCreate = useCallback(() => {
    if (!primaryId) return;
    const defaultData: JointData = {
      jointType: 'revolute',
      connectedEntityId: otherEntities[0]?.id ?? '',
      anchorSelf: [0, 0, 0],
      anchorOther: [0, 0, 0],
      axis: [0, 1, 0],
      limits: null,
      motor: null,
    };
    createJoint(primaryId, defaultData);
  }, [primaryId, otherEntities, createJoint]);

  const handleUpdate = useCallback(
    (updates: Partial<JointData>) => {
      if (!primaryId) return;
      updateJoint(primaryId, updates);
    },
    [primaryId, updateJoint]
  );

  const handleRemove = useCallback(() => {
    if (!primaryId) return;
    removeJoint(primaryId);
  }, [primaryId, removeJoint]);

  if (!primaryId || !physicsEnabled) return null;

  // No joint yet — show add button
  if (!primaryJoint) {
    return (
      <div className="border-t border-zinc-800 px-3 py-2">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Joint</h3>
        </div>
        <button
          onClick={handleCreate}
          disabled={otherEntities.length === 0}
          className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 disabled:opacity-40"
        >
          {otherEntities.length === 0 ? 'Need another entity' : 'Add Joint'}
        </button>
      </div>
    );
  }

  const showAxis = primaryJoint.jointType === 'revolute' || primaryJoint.jointType === 'prismatic';
  const showLimits = primaryJoint.jointType === 'revolute' || primaryJoint.jointType === 'prismatic' || primaryJoint.jointType === 'rope';
  const showMotor = primaryJoint.jointType === 'revolute' || primaryJoint.jointType === 'prismatic';

  return (
    <div className="border-t border-zinc-800 px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Joint</h3>
        <button
          onClick={handleRemove}
          className="text-[10px] text-red-400 hover:text-red-300"
        >
          Remove
        </button>
      </div>

      <div className="space-y-2">
        {/* Joint Type */}
        <label className="block">
          <span className="text-[10px] text-zinc-500">Type</span>
          <select
            value={primaryJoint.jointType}
            onChange={(e) => handleUpdate({ jointType: e.target.value as JointData['jointType'] })}
            className="mt-0.5 w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 outline-none"
          >
            {JOINT_TYPES.map((t) => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </label>

        {/* Connected Entity */}
        <label className="block">
          <span className="text-[10px] text-zinc-500">Connected To</span>
          <select
            value={primaryJoint.connectedEntityId}
            onChange={(e) => handleUpdate({ connectedEntityId: e.target.value })}
            className="mt-0.5 w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 outline-none"
          >
            <option value="">Select entity...</option>
            {otherEntities.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </label>

        {/* Anchor Self */}
        <div>
          <span className="text-[10px] text-zinc-500">Anchor (Self)</span>
          <div className="mt-0.5 flex gap-1">
            {(['x', 'y', 'z'] as const).map((c, i) => (
              <input
                key={c}
                type="number"
                step="0.1"
                value={primaryJoint.anchorSelf[i]}
                onChange={(e) => {
                  const v = [...primaryJoint.anchorSelf] as [number, number, number];
                  v[i] = parseFloat(e.target.value) || 0;
                  handleUpdate({ anchorSelf: v });
                }}
                className="w-full rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 outline-none"
              />
            ))}
          </div>
        </div>

        {/* Anchor Other */}
        <div>
          <span className="text-[10px] text-zinc-500">Anchor (Other)</span>
          <div className="mt-0.5 flex gap-1">
            {(['x', 'y', 'z'] as const).map((c, i) => (
              <input
                key={c}
                type="number"
                step="0.1"
                value={primaryJoint.anchorOther[i]}
                onChange={(e) => {
                  const v = [...primaryJoint.anchorOther] as [number, number, number];
                  v[i] = parseFloat(e.target.value) || 0;
                  handleUpdate({ anchorOther: v });
                }}
                className="w-full rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 outline-none"
              />
            ))}
          </div>
        </div>

        {/* Axis (for revolute/prismatic) */}
        {showAxis && (
          <div>
            <span className="text-[10px] text-zinc-500">Axis</span>
            <div className="mt-0.5 flex gap-1">
              {(['x', 'y', 'z'] as const).map((c, i) => (
                <input
                  key={c}
                  type="number"
                  step="0.1"
                  value={primaryJoint.axis[i]}
                  onChange={(e) => {
                    const v = [...primaryJoint.axis] as [number, number, number];
                    v[i] = parseFloat(e.target.value) || 0;
                    handleUpdate({ axis: v });
                  }}
                  className="w-full rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 outline-none"
                />
              ))}
            </div>
          </div>
        )}

        {/* Limits */}
        {showLimits && (
          <div>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={primaryJoint.limits !== null}
                onChange={(e) => handleUpdate({
                  limits: e.target.checked ? { min: -1, max: 1 } : null,
                })}
                className="h-3 w-3"
              />
              <span className="text-[10px] text-zinc-500">Limits</span>
            </label>
            {primaryJoint.limits && (
              <div className="mt-1 flex gap-1">
                <label className="flex-1">
                  <span className="text-[9px] text-zinc-600">Min</span>
                  <input
                    type="number"
                    step="0.1"
                    value={primaryJoint.limits.min}
                    onChange={(e) => handleUpdate({
                      limits: { ...primaryJoint.limits!, min: parseFloat(e.target.value) || 0 },
                    })}
                    className="w-full rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 outline-none"
                  />
                </label>
                <label className="flex-1">
                  <span className="text-[9px] text-zinc-600">Max</span>
                  <input
                    type="number"
                    step="0.1"
                    value={primaryJoint.limits.max}
                    onChange={(e) => handleUpdate({
                      limits: { ...primaryJoint.limits!, max: parseFloat(e.target.value) || 0 },
                    })}
                    className="w-full rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 outline-none"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {/* Motor */}
        {showMotor && (
          <div>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={primaryJoint.motor !== null}
                onChange={(e) => handleUpdate({
                  motor: e.target.checked ? { targetVelocity: 1, maxForce: 100 } : null,
                })}
                className="h-3 w-3"
              />
              <span className="text-[10px] text-zinc-500">Motor</span>
            </label>
            {primaryJoint.motor && (
              <div className="mt-1 flex gap-1">
                <label className="flex-1">
                  <span className="text-[9px] text-zinc-600">Velocity</span>
                  <input
                    type="number"
                    step="0.1"
                    value={primaryJoint.motor.targetVelocity}
                    onChange={(e) => handleUpdate({
                      motor: { ...primaryJoint.motor!, targetVelocity: parseFloat(e.target.value) || 0 },
                    })}
                    className="w-full rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 outline-none"
                  />
                </label>
                <label className="flex-1">
                  <span className="text-[9px] text-zinc-600">Max Force</span>
                  <input
                    type="number"
                    step="1"
                    value={primaryJoint.motor.maxForce}
                    onChange={(e) => handleUpdate({
                      motor: { ...primaryJoint.motor!, maxForce: parseFloat(e.target.value) || 0 },
                    })}
                    className="w-full rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 outline-none"
                  />
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
