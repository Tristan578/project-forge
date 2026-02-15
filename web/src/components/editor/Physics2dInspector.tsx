'use client';

import { useCallback } from 'react';
import { HelpCircle } from 'lucide-react';
import { useEditorStore, type Physics2dData } from '@/stores/editorStore';
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

interface Vec2InputProps {
  label: string;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  step?: number;
}

function Vec2Input({ label, value, onChange, step = 0.1 }: Vec2InputProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-20 shrink-0 text-xs text-zinc-400">{label}</label>
      <div className="flex flex-1 gap-1">
        <input
          type="number"
          value={value[0]}
          onChange={(e) => onChange([parseFloat(e.target.value) || 0, value[1]])}
          step={step}
          className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
            focus:ring-1 focus:ring-blue-500"
        />
        <input
          type="number"
          value={value[1]}
          onChange={(e) => onChange([value[0], parseFloat(e.target.value) || 0])}
          step={step}
          className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
            focus:ring-1 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}

const BODY_TYPE_OPTIONS = [
  { value: 'dynamic', label: 'Dynamic' },
  { value: 'static', label: 'Static' },
  { value: 'kinematic', label: 'Kinematic' },
];

const COLLIDER_SHAPE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'box', label: 'Box' },
  { value: 'circle', label: 'Circle' },
  { value: 'capsule', label: 'Capsule' },
  { value: 'convex_polygon', label: 'Convex Polygon' },
  { value: 'edge', label: 'Edge' },
];

export function Physics2dInspector() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const physics2d = useEditorStore((s) => (primaryId ? s.physics2d[primaryId] : null));
  const physics2dEnabled = useEditorStore((s) => (primaryId ? s.physics2dEnabled[primaryId] ?? false : false));
  const updatePhysics2d = useEditorStore((s) => s.updatePhysics2d);
  const togglePhysics2d = useEditorStore((s) => s.togglePhysics2d);
  const removePhysics2d = useEditorStore((s) => s.removePhysics2d);
  const navigateDocs = useWorkspaceStore((s) => s.navigateDocs);

  const handleUpdate = useCallback(
    (partial: Partial<Physics2dData>) => {
      if (primaryId && physics2d) {
        updatePhysics2d(primaryId, { ...physics2d, ...partial });
      }
    },
    [primaryId, physics2d, updatePhysics2d]
  );

  const handleToggleEnabled = useCallback(
    (enabled: boolean) => {
      if (primaryId) {
        if (enabled && !physics2d) {
          // Initialize default physics data
          const defaultData: Physics2dData = {
            bodyType: 'dynamic',
            colliderShape: 'auto',
            size: [1.0, 1.0],
            radius: 0.5,
            vertices: [],
            mass: 1.0,
            friction: 0.5,
            restitution: 0.0,
            gravityScale: 1.0,
            isSensor: false,
            lockRotation: false,
            continuousDetection: false,
            oneWayPlatform: false,
            surfaceVelocity: [0.0, 0.0],
          };
          updatePhysics2d(primaryId, defaultData);
        }
        togglePhysics2d(primaryId, enabled);
      }
    },
    [primaryId, physics2d, updatePhysics2d, togglePhysics2d]
  );

  const handleRemove = useCallback(() => {
    if (primaryId && window.confirm('Remove 2D physics from this entity?')) {
      removePhysics2d(primaryId);
    }
  }, [primaryId, removePhysics2d]);

  const isDynamic = physics2d?.bodyType === 'dynamic';
  const isStatic = physics2d?.bodyType === 'static';
  const needsSize = physics2d?.colliderShape === 'box' || physics2d?.colliderShape === 'capsule';
  const needsRadius = physics2d?.colliderShape === 'circle' || physics2d?.colliderShape === 'capsule';

  return (
    <div className="border-t border-zinc-800 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          2D Physics
        </h3>
        <button onClick={() => navigateDocs('features/physics-2d')} className="rounded p-0.5 text-zinc-600 hover:text-zinc-400" title="Documentation">
          <HelpCircle size={12} />
        </button>
      </div>

      <div className="space-y-3 px-3">
        {/* Enable Physics toggle */}
        <CheckboxRow
          label="Enabled"
          checked={physics2dEnabled}
          onChange={handleToggleEnabled}
        />

        {/* Show settings when enabled and data exists */}
        {physics2dEnabled && physics2d && (
          <>
            {/* Body Type */}
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Body Type<InfoTooltip term="bodyType2d" /></label>
              <select
                value={physics2d.bodyType}
                onChange={(e) => handleUpdate({ bodyType: e.target.value as Physics2dData['bodyType'] })}
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
              <label className="w-20 shrink-0 text-xs text-zinc-400">Shape<InfoTooltip term="colliderShape2d" /></label>
              <select
                value={physics2d.colliderShape}
                onChange={(e) => handleUpdate({ colliderShape: e.target.value as Physics2dData['colliderShape'] })}
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                  focus:ring-1 focus:ring-blue-500"
              >
                {COLLIDER_SHAPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Size (for box/capsule) */}
            {needsSize && (
              <Vec2Input
                label="Size"
                value={physics2d.size}
                onChange={(v) => handleUpdate({ size: v })}
                step={0.1}
              />
            )}

            {/* Radius (for circle/capsule) */}
            {needsRadius && (
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Radius</label>
                <input
                  type="number"
                  value={physics2d.radius}
                  onChange={(e) => handleUpdate({ radius: parseFloat(e.target.value) || 0 })}
                  step={0.1}
                  min={0.1}
                  className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                    focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}

            {/* Mass (dynamic only) */}
            {isDynamic && (
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Mass<InfoTooltip term="mass2d" /></label>
                <input
                  type="range"
                  min={0.1}
                  max={100}
                  step={0.1}
                  value={physics2d.mass}
                  onChange={(e) => handleUpdate({ mass: parseFloat(e.target.value) })}
                  className="flex-1"
                />
                <span className="w-12 text-right text-xs text-zinc-400">{physics2d.mass.toFixed(1)}</span>
              </div>
            )}

            {/* Friction */}
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Friction<InfoTooltip term="friction2d" /></label>
              <input
                type="range"
                min={0}
                max={2}
                step={0.01}
                value={physics2d.friction}
                onChange={(e) => handleUpdate({ friction: parseFloat(e.target.value) })}
                className="flex-1"
              />
              <span className="w-12 text-right text-xs text-zinc-400">{physics2d.friction.toFixed(2)}</span>
            </div>

            {/* Restitution */}
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-zinc-400">Bounciness<InfoTooltip term="restitution2d" /></label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={physics2d.restitution}
                onChange={(e) => handleUpdate({ restitution: parseFloat(e.target.value) })}
                className="flex-1"
              />
              <span className="w-12 text-right text-xs text-zinc-400">{physics2d.restitution.toFixed(2)}</span>
            </div>

            {/* Gravity Scale (dynamic only) */}
            {isDynamic && (
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Gravity<InfoTooltip term="gravityScale2d" /></label>
                <input
                  type="range"
                  min={-2}
                  max={2}
                  step={0.1}
                  value={physics2d.gravityScale}
                  onChange={(e) => handleUpdate({ gravityScale: parseFloat(e.target.value) })}
                  className="flex-1"
                />
                <span className="w-12 text-right text-xs text-zinc-400">{physics2d.gravityScale.toFixed(1)}</span>
              </div>
            )}

            {/* Checkboxes */}
            <CheckboxRow
              label="Sensor"
              checked={physics2d.isSensor}
              onChange={(v) => handleUpdate({ isSensor: v })}
            />

            <CheckboxRow
              label="Lock Rotation"
              checked={physics2d.lockRotation}
              onChange={(v) => handleUpdate({ lockRotation: v })}
            />

            <CheckboxRow
              label="CCD"
              checked={physics2d.continuousDetection}
              onChange={(v) => handleUpdate({ continuousDetection: v })}
            />

            {/* One-Way Platform (static only) */}
            {isStatic && (
              <CheckboxRow
                label="One-Way"
                checked={physics2d.oneWayPlatform}
                onChange={(v) => handleUpdate({ oneWayPlatform: v })}
              />
            )}

            {/* Surface Velocity (static only) */}
            {isStatic && (
              <Vec2Input
                label="Surface Vel"
                value={physics2d.surfaceVelocity}
                onChange={(v) => handleUpdate({ surfaceVelocity: v })}
                step={0.1}
              />
            )}

            {/* Remove button */}
            <button
              onClick={handleRemove}
              className="w-full rounded bg-red-900/20 px-3 py-1.5 text-xs text-red-400
                hover:bg-red-900/30 transition-colors"
            >
              Remove Physics
            </button>
          </>
        )}
      </div>
    </div>
  );
}
