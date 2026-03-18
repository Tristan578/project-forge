'use client';

import { useState, useCallback, useMemo } from 'react';
import { Sparkles, Play, Trash2, Plus, Wand2, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import { getCommandDispatcher } from '@/stores/editorStore';
import {
  EFFECT_PRESETS,
  PRESET_KEYS,
  applyBinding,
  applyEffect,
  createEffect,
  loadBindings,
  saveBindings,
  type EffectBinding,
  type Effect,
  type EffectType,
  type EventCategory,
} from '@/lib/ai/effectSystem';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EFFECT_TYPES: EffectType[] = [
  'screen_shake', 'particle_burst', 'flash', 'slow_motion',
  'sound', 'scale_pop', 'color_flash',
];

const EFFECT_LABELS: Record<EffectType, string> = {
  screen_shake: 'Screen Shake',
  particle_burst: 'Particle Burst',
  flash: 'Flash',
  slow_motion: 'Slow Motion',
  sound: 'Sound',
  scale_pop: 'Scale Pop',
  color_flash: 'Color Flash',
};

const CATEGORY_OPTIONS: EventCategory[] = ['combat', 'collection', 'movement', 'ui', 'environment'];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EffectRow({
  effect,
  onIntensityChange,
  onRemove,
  onPreview,
}: {
  effect: Effect;
  onIntensityChange: (intensity: number) => void;
  onRemove: () => void;
  onPreview: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded bg-zinc-800 px-2 py-1.5">
      <GripVertical size={14} className="shrink-0 text-zinc-500" aria-hidden="true" />
      <span className="min-w-[90px] text-xs text-zinc-300">
        {EFFECT_LABELS[effect.type] ?? effect.type}
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={effect.intensity}
        onChange={(e) => onIntensityChange(parseFloat(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer accent-blue-500"
        aria-label={`${EFFECT_LABELS[effect.type]} intensity`}
      />
      <span className="w-8 text-right text-[10px] tabular-nums text-zinc-400">
        {Math.round(effect.intensity * 100)}%
      </span>
      <button
        onClick={onPreview}
        className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
        aria-label={`Preview ${EFFECT_LABELS[effect.type]}`}
        title="Preview"
      >
        <Play size={12} />
      </button>
      <button
        onClick={onRemove}
        className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-red-400"
        aria-label={`Remove ${EFFECT_LABELS[effect.type]}`}
        title="Remove"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function BindingCard({
  binding,
  index,
  onUpdate,
  onRemove,
}: {
  binding: EffectBinding;
  index: number;
  onUpdate: (index: number, binding: EffectBinding) => void;
  onRemove: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const handlePreviewAll = useCallback(() => {
    const dispatch = getCommandDispatcher();
    if (!dispatch) return;
    applyBinding(binding, dispatch);
  }, [binding]);

  const handlePreviewEffect = useCallback(
    (effect: Effect) => {
      const dispatch = getCommandDispatcher();
      if (!dispatch) return;
      applyEffect(effect, dispatch);
    },
    [],
  );

  const handleEffectIntensity = useCallback(
    (effectIdx: number, intensity: number) => {
      const updated = {
        ...binding,
        effects: binding.effects.map((e, i) =>
          i === effectIdx ? createEffect(e.type, intensity, e.duration, e.config) : e,
        ),
      };
      onUpdate(index, updated);
    },
    [binding, index, onUpdate],
  );

  const handleRemoveEffect = useCallback(
    (effectIdx: number) => {
      const updated = {
        ...binding,
        effects: binding.effects.filter((_, i) => i !== effectIdx),
      };
      onUpdate(index, updated);
    },
    [binding, index, onUpdate],
  );

  const handleAddEffect = useCallback(
    (type: EffectType) => {
      const updated = {
        ...binding,
        effects: [...binding.effects, createEffect(type, 0.5, 0.2)],
      };
      onUpdate(index, updated);
    },
    [binding, index, onUpdate],
  );

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-850">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="text-zinc-400 transition-colors hover:text-zinc-200"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse binding' : 'Expand binding'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Sparkles size={14} className="text-amber-400" aria-hidden="true" />
        <span className="flex-1 text-xs font-medium text-zinc-200">
          {binding.event.name.replace(/_/g, ' ')}
        </span>
        <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">
          {binding.event.category}
        </span>
        <button
          onClick={handlePreviewAll}
          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-blue-400"
          aria-label="Preview all effects"
          title="Preview all"
        >
          <Play size={14} />
        </button>
        <button
          onClick={() => onRemove(index)}
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-red-400"
          aria-label="Remove binding"
          title="Remove binding"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Effects list */}
      {expanded && (
        <div className="space-y-1 px-3 pb-3">
          {binding.effects.map((effect, effIdx) => (
            <EffectRow
              key={`${effect.type}-${effIdx}`}
              effect={effect}
              onIntensityChange={(v) => handleEffectIntensity(effIdx, v)}
              onRemove={() => handleRemoveEffect(effIdx)}
              onPreview={() => handlePreviewEffect(effect)}
            />
          ))}
          {/* Add effect dropdown */}
          <select
            className="mt-1 w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 transition-colors hover:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value=""
            onChange={(e) => {
              if (e.target.value) handleAddEffect(e.target.value as EffectType);
            }}
            aria-label="Add effect"
          >
            <option value="" disabled>
              + Add effect...
            </option>
            {EFFECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EFFECT_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function EffectBindingsPanel() {
  const [bindings, setBindings] = useState<EffectBinding[]>(() => loadBindings());
  const [showPresets, setShowPresets] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [newEventCategory, setNewEventCategory] = useState<EventCategory>('combat');

  // Persist on every change
  const updateBindings = useCallback((next: EffectBinding[]) => {
    setBindings(next);
    saveBindings(next);
  }, []);

  const handleUpdateBinding = useCallback(
    (index: number, binding: EffectBinding) => {
      updateBindings(bindings.map((b, i) => (i === index ? binding : b)));
    },
    [bindings, updateBindings],
  );

  const handleRemoveBinding = useCallback(
    (index: number) => {
      updateBindings(bindings.filter((_, i) => i !== index));
    },
    [bindings, updateBindings],
  );

  const handleAddFromPreset = useCallback(
    (presetKey: string) => {
      const preset = EFFECT_PRESETS[presetKey];
      if (!preset) return;
      // Deep clone to avoid mutating the preset
      const clone: EffectBinding = JSON.parse(JSON.stringify(preset));
      updateBindings([...bindings, clone]);
      setShowPresets(false);
    },
    [bindings, updateBindings],
  );

  const handleAddCustom = useCallback(() => {
    const trimmed = newEventName.trim();
    if (!trimmed) return;
    const binding: EffectBinding = {
      event: { name: trimmed.replace(/\s+/g, '_').toLowerCase(), category: newEventCategory },
      effects: [createEffect('sound', 0.5, 0.2)],
    };
    updateBindings([...bindings, binding]);
    setNewEventName('');
  }, [newEventName, newEventCategory, bindings, updateBindings]);

  const presetKeys = useMemo(() => PRESET_KEYS, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-900">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Sparkles size={16} className="text-amber-400" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-zinc-200">Effect Bindings</h2>
        <span className="ml-auto text-[10px] text-zinc-500">{bindings.length} binding{bindings.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-zinc-800 px-3 py-1.5">
        <button
          onClick={() => setShowPresets((p) => !p)}
          className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
          aria-label="Add from presets"
        >
          <Wand2 size={12} />
          Presets
        </button>
        <button
          onClick={handleAddCustom}
          disabled={!newEventName.trim()}
          className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-40"
          aria-label="Add custom binding"
        >
          <Plus size={12} />
          Add
        </button>
        <input
          type="text"
          value={newEventName}
          onChange={(e) => setNewEventName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustom(); }}
          placeholder="Event name..."
          className="ml-1 flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="New event name"
        />
        <select
          value={newEventCategory}
          onChange={(e) => setNewEventCategory(e.target.value as EventCategory)}
          className="rounded bg-zinc-800 px-1 py-1 text-xs text-zinc-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="Event category"
        >
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Preset picker dropdown */}
      {showPresets && (
        <div className="border-b border-zinc-800 bg-zinc-850 px-3 py-2">
          <p className="mb-1.5 text-[10px] font-semibold uppercase text-zinc-500">Built-in Presets</p>
          <div className="flex flex-wrap gap-1">
            {presetKeys.map((key) => (
              <button
                key={key}
                onClick={() => handleAddFromPreset(key)}
                className="rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-600"
              >
                {key.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bindings list */}
      <div className="flex-1 overflow-y-auto p-3">
        {bindings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Sparkles size={32} className="mb-3 text-zinc-600" />
            <p className="text-sm text-zinc-400">No effect bindings yet</p>
            <p className="mt-1 text-xs text-zinc-500">
              Add a preset or create a custom event binding to add game juice.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {bindings.map((binding, idx) => (
              <BindingCard
                key={`${binding.event.name}-${idx}`}
                binding={binding}
                index={idx}
                onUpdate={handleUpdateBinding}
                onRemove={handleRemoveBinding}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
