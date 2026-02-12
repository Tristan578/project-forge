'use client';

import { useCallback } from 'react';
import { useEditorStore, type PhysicsData } from '@/stores/editorStore';

interface SliderRowProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, min = 0, max = 1, step = 0.01, precision = 2, onChange }: SliderRowProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-24 shrink-0 text-xs text-zinc-400">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
          [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-zinc-300"
      />
      <span className="w-12 text-right text-xs tabular-nums text-zinc-500">
        {value.toFixed(precision)}
      </span>
    </div>
  );
}

interface CheckboxRowProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function CheckboxRow({ label, checked, onChange }: CheckboxRowProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-24 shrink-0 text-xs text-zinc-400">{label}</label>
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

interface SelectRowProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}

function SelectRow({ label, value, options, onChange }: SelectRowProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-24 shrink-0 text-xs text-zinc-400">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
          focus:ring-1 focus:ring-blue-500"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
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
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Physics
      </h3>

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
            <SelectRow
              label="Body Type"
              value={primaryPhysics.bodyType}
              options={BODY_TYPE_OPTIONS}
              onChange={(v) => handleUpdate({ bodyType: v as PhysicsData['bodyType'] })}
            />

            {/* Collider Shape */}
            <SelectRow
              label="Collider"
              value={primaryPhysics.colliderShape}
              options={COLLIDER_SHAPE_OPTIONS}
              onChange={(v) => handleUpdate({ colliderShape: v as PhysicsData['colliderShape'] })}
            />

            {/* Restitution (bounciness) */}
            <SliderRow
              label="Restitution"
              value={primaryPhysics.restitution}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => handleUpdate({ restitution: v })}
            />

            {/* Friction */}
            <SliderRow
              label="Friction"
              value={primaryPhysics.friction}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => handleUpdate({ friction: v })}
            />

            {/* Density */}
            <SliderRow
              label="Density"
              value={primaryPhysics.density}
              min={0.01}
              max={100}
              step={0.1}
              precision={1}
              onChange={(v) => handleUpdate({ density: v })}
            />

            {/* Gravity Scale */}
            <SliderRow
              label="Gravity"
              value={primaryPhysics.gravityScale}
              min={-10}
              max={10}
              step={0.1}
              precision={1}
              onChange={(v) => handleUpdate({ gravityScale: v })}
            />

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
            <CheckboxRow
              label="Is Sensor"
              checked={primaryPhysics.isSensor}
              onChange={(v) => handleUpdate({ isSensor: v })}
            />
          </>
        )}
      </div>
    </div>
  );
}
