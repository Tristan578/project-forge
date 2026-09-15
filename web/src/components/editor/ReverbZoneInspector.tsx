'use client';

import { useCallback, useId } from 'react';
import { HelpCircle } from 'lucide-react';
import { SliderInput, Vec3Input } from '@spawnforge/ui';
import { useEditorStore, type ReverbZoneData } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

interface NumberInputRowProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}

function NumberInputRow({ label, value, min, max, step = 0.1, onChange }: NumberInputRowProps) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-20 shrink-0 text-xs text-zinc-400">{label}</label>
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
          focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
}

export function ReverbZoneInspector({ entityId }: { entityId: string }) {
  const fieldId = useId();
  const reverbZone = useEditorStore((s) => s.reverbZones[entityId]);
  const enabled = useEditorStore((s) => s.reverbZonesEnabled[entityId]);
  const updateReverbZone = useEditorStore((s) => s.updateReverbZone);
  const setReverbZone = useEditorStore((s) => s.setReverbZone);
  const removeReverbZone = useEditorStore((s) => s.removeReverbZone);
  const navigateDocs = useWorkspaceStore((s) => s.navigateDocs);

  const handleUpdate = useCallback(
    (partial: Partial<ReverbZoneData>) => {
      if (reverbZone) {
        updateReverbZone(entityId, { ...reverbZone, ...partial });
      }
    },
    [entityId, reverbZone, updateReverbZone]
  );

  const handleAddReverbZone = useCallback(() => {
    // `setReverbZone(..., true)`, not `updateReverbZone`: the editing controls
    // below are gated on `enabled`, so adding a zone without switching it on
    // left the panel showing "Add Reverb Zone" over a configured zone — the
    // edit UI was unreachable for this component's whole life.
    setReverbZone(
      entityId,
      {
        shape: { type: 'box', size: [10, 5, 10] },
        preset: 'hall',
        wetMix: 0.5,
        decayTime: 2.0,
        preDelay: 20,
        blendRadius: 2.0,
        priority: 0,
      },
      true
    );
  }, [entityId, setReverbZone]);

  const handleRemoveReverbZone = useCallback(() => {
    removeReverbZone(entityId);
  }, [entityId, removeReverbZone]);

  const handleShapeChange = useCallback(
    (shapeType: 'box' | 'sphere') => {
      if (shapeType === 'box') {
        handleUpdate({ shape: { type: 'box', size: [10, 5, 10] } });
      } else {
        handleUpdate({ shape: { type: 'sphere', radius: 5 } });
      }
    },
    [handleUpdate]
  );

  const handleSizeChange = useCallback(
    (size: [number, number, number]) => {
      if (reverbZone?.shape.type === 'box') {
        handleUpdate({ shape: { type: 'box', size } });
      }
    },
    [reverbZone, handleUpdate]
  );

  const handleRadiusChange = useCallback(
    (radius: number) => {
      if (reverbZone?.shape.type === 'sphere') {
        handleUpdate({ shape: { type: 'sphere', radius } });
      }
    },
    [reverbZone, handleUpdate]
  );

  return (
    <div className="border-t border-zinc-800 pt-4 mt-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Reverb Zone
          </h3>
          <InfoTooltip text="Spatial reverb effect region" />
          <button onClick={() => navigateDocs('features/audio')} className="rounded p-0.5 text-zinc-400 hover:text-zinc-400" title="Documentation">
            <HelpCircle size={12} />
          </button>
        </div>
      </div>

      {!enabled || !reverbZone ? (
        <button
          onClick={handleAddReverbZone}
          className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
        >
          Add Reverb Zone
        </button>
      ) : (
        <div className="space-y-3">
          {/* Shape */}
          <div className="flex items-center gap-2">
            <label htmlFor={`${fieldId}-shape`} className="w-20 shrink-0 text-xs text-zinc-400">Shape</label>
            <select
              id={`${fieldId}-shape`}
              value={reverbZone.shape.type}
              onChange={(e) => handleShapeChange(e.target.value as 'box' | 'sphere')}
              className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                focus:ring-1 focus:ring-blue-500"
            >
              <option value="box">Box</option>
              <option value="sphere">Sphere</option>
            </select>
          </div>

          {/* Size (Box) or Radius (Sphere) */}
          {reverbZone.shape.type === 'box' ? (
            <Vec3Input
              label="Size"
              value={reverbZone.shape.size}
              onChange={handleSizeChange}
            />
          ) : (
            <NumberInputRow
              label="Radius"
              value={reverbZone.shape.radius}
              min={0.1}
              step={0.1}
              onChange={handleRadiusChange}
            />
          )}

          {/* Reverb Type */}
          <div className="flex items-center gap-2">
            <label htmlFor={`${fieldId}-preset`} className="w-20 shrink-0 text-xs text-zinc-400">Type</label>
            <select
              id={`${fieldId}-preset`}
              value={reverbZone.preset}
              onChange={(e) => handleUpdate({ preset: e.target.value })}
              className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                focus:ring-1 focus:ring-blue-500"
            >
              <option value="hall">Hall</option>
              <option value="room">Room</option>
              <option value="cave">Cave</option>
              <option value="outdoor">Outdoor</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {/* Wet Mix */}
          <SliderInput
            label="Wet Mix"
            value={reverbZone.wetMix * 100}
            min={0}
            max={100}
            step={1}
            formatValue={(v) => v.toFixed(0)}
            onChange={(v) => handleUpdate({ wetMix: v / 100 })}
          />

          {/* Decay Time */}
          <SliderInput
            label="Decay Time"
            value={reverbZone.decayTime}
            min={0.1}
            max={10}
            step={0.1}
            formatValue={(v) => v.toFixed(1)}
            onChange={(v) => handleUpdate({ decayTime: v })}
          />

          {/* Pre-Delay */}
          <SliderInput
            label="Pre-Delay"
            value={reverbZone.preDelay}
            min={0}
            max={100}
            step={1}
            formatValue={(v) => v.toFixed(0)}
            onChange={(v) => handleUpdate({ preDelay: v })}
          />

          {/* Priority */}
          <NumberInputRow
            label="Priority"
            value={reverbZone.priority}
            step={1}
            onChange={(v) => handleUpdate({ priority: v })}
          />

          {/* Remove Button */}
          <button
            onClick={handleRemoveReverbZone}
            className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-red-400 hover:bg-zinc-700"
          >
            Remove Reverb Zone
          </button>
        </div>
      )}
    </div>
  );
}
