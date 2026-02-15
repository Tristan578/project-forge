'use client';

import { useCallback } from 'react';
import { HelpCircle } from 'lucide-react';
import { useEditorStore, type PhysicsData } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

interface CheckboxRowProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function CheckboxRow({ label, checked, onChange }: CheckboxRowProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-20 shrink-0 text-xs text-zinc-400">{label}</label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
          focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
      />
    </div>
  );
}

const BODY_TYPE_OPTIONS = [
  { value: 'dynamic', label: 'Dynamic' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'kinematic_position', label: 'Kinematic (Position)' },
  { value: 'kinematic_velocity', label: 'Kinematic (Velocity)' },
];

const COLLIDER_SHAPE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'cuboid', label: 'Cuboid' },
  { value: 'ball', label: 'Ball' },
  { value: 'cylinder', label: 'Cylinder' },
  { value: 'capsule', label: 'Capsule' },
];

export function PhysicsInspector() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const primaryPhysics = useEditorStore((s) => s.primaryPhysics);
  const physicsEnabled = useEditorStore((s) => s.physicsEnabled);
  const updatePhysics = useEditorStore((s) => s.updatePhysics);
  const togglePhysics = useEditorStore((s) => s.togglePhysics);
  const navigateDocs = useWorkspaceStore((s) => s.navigateDocs);

  const handleUpdate = useCallback(
    (partial: Partial<PhysicsData>) => {
      if (primaryId && primaryPhysics) {
        updatePhysics(primaryId, { ...primaryPhysics, ...partial });
      }
    },
    [primaryId, primaryPhysics, updatePhysics]
  );

  const handleToggleEnabled = useCallback(
    (enabled: boolean) => {
      if (primaryId) {
        togglePhysics(primaryId, enabled);
      }
    },
    [primaryId, togglePhysics]
  );

  return (
    <div className="border-t border-zinc-800 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Physics
        </h3>
        <button onClick={() => navigateDocs('features/physics')} className="rounded p-0.5 text-zinc-600 hover:text-zinc-400" title="Documentation">
          <HelpCircle size={12} />
        </button>
      </div>

      <div className="space-y-3">
        {/* Enable Physics toggle */}
        <CheckboxRow
          label="Enabled"
          checked={physicsEnabled}
          onChange={handleToggleEnabled}
        />

        {/* Only show detailed settings when physics is enabled and data exists */}
        {physicsEnabled && primaryPhysics && (
          <>
            {/* Body Type */}
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Body Type<InfoTooltip term="bodyType" /></label>
              <select
                value={primaryPhysics.bodyType}
                onChange={(e) => handleUpdate({ bodyType: e.target.value as PhysicsData['bodyType'] })}
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
              >
                {BODY_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Collider Shape */}
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Collider<InfoTooltip term="colliderShape" /></label>
              <select
                value={primaryPhysics.colliderShape}
                onChange={(e) => handleUpdate({ colliderShape: e.target.value as PhysicsData['colliderShape'] })}
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
              >
                {COLLIDER_SHAPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Restitution (bounciness) */}
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Restitution<InfoTooltip term="restitution" /></label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={primaryPhysics.restitution}
                onChange={(e) => handleUpdate({ restitution: parseFloat(e.target.value) })}
                className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
                  [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-zinc-300"
              />
              <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                {primaryPhysics.restitution.toFixed(2)}
              </span>
            </div>

            {/* Friction */}
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Friction<InfoTooltip term="friction" /></label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={primaryPhysics.friction}
                onChange={(e) => handleUpdate({ friction: parseFloat(e.target.value) })}
                className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
                  [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-zinc-300"
              />
              <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                {primaryPhysics.friction.toFixed(2)}
              </span>
            </div>

            {/* Density */}
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Density<InfoTooltip term="density" /></label>
              <input
                type="range"
                min={0.01}
                max={100}
                step={0.1}
                value={primaryPhysics.density}
                onChange={(e) => handleUpdate({ density: parseFloat(e.target.value) })}
                className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
                  [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-zinc-300"
              />
              <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                {primaryPhysics.density.toFixed(1)}
              </span>
            </div>

            {/* Gravity Scale */}
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Gravity<InfoTooltip term="gravityScale" /></label>
              <input
                type="range"
                min={-10}
                max={10}
                step={0.1}
                value={primaryPhysics.gravityScale}
                onChange={(e) => handleUpdate({ gravityScale: parseFloat(e.target.value) })}
                className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
                  [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-zinc-300"
              />
              <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
                {primaryPhysics.gravityScale.toFixed(1)}
              </span>
            </div>

            {/* Lock Axes */}
            <div className="pt-1">
              <span className="text-xs text-zinc-500">Lock Translation</span>
              <div className="mt-1 flex gap-4">
                <CheckboxRow label="X" checked={primaryPhysics.lockTranslationX} onChange={(v) => handleUpdate({ lockTranslationX: v })} />
                <CheckboxRow label="Y" checked={primaryPhysics.lockTranslationY} onChange={(v) => handleUpdate({ lockTranslationY: v })} />
                <CheckboxRow label="Z" checked={primaryPhysics.lockTranslationZ} onChange={(v) => handleUpdate({ lockTranslationZ: v })} />
              </div>
            </div>
            <div className="pt-1">
              <span className="text-xs text-zinc-500">Lock Rotation</span>
              <div className="mt-1 flex gap-4">
                <CheckboxRow label="X" checked={primaryPhysics.lockRotationX} onChange={(v) => handleUpdate({ lockRotationX: v })} />
                <CheckboxRow label="Y" checked={primaryPhysics.lockRotationY} onChange={(v) => handleUpdate({ lockRotationY: v })} />
                <CheckboxRow label="Z" checked={primaryPhysics.lockRotationZ} onChange={(v) => handleUpdate({ lockRotationZ: v })} />
              </div>
            </div>

            {/* Is Sensor */}
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Sensor<InfoTooltip term="sensor" /></label>
              <input
                type="checkbox"
                checked={primaryPhysics.isSensor}
                onChange={(e) => handleUpdate({ isSensor: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
                  focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
