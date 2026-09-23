'use client';

import { createContext, useCallback, useContext, useId, useMemo, useState } from 'react';
import { Badge, InlineAlert } from '@spawnforge/ui';
import { useEditorStore, type GameComponentData, type DialogueTriggerData, GAME_COMPONENT_TYPES } from '@/stores/editorStore';
import { useDialogueStore, listTrees } from '@/stores/dialogueStore';
import { ChevronDown, ChevronRight, Trash2, Plus } from 'lucide-react';
import { Vec3Input } from './Vec3Input';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import {
  defaultCharacterController,
  jumpHeightSliderMax,
  jumpHeightUnit,
  type ControllerProjectType,
} from '@/lib/game/characterControllerDefaults';
import {
  componentAdjustmentsOf,
  currentAdjustments,
  describeCorrection,
  type GameComponentAdjustments,
  type GameComponentFieldCorrection,
} from '@/lib/engine/gameComponentCorrections';

// ── Adjusted values (PF-1148) ────────────────────────────────────────────
//
// A field whose value is not the one asked for — clamped, rounded, a route cut
// at the engine's 64 points — is marked where it is edited, with the requested
// value still readable. The section lists every such field in a warning note
// (fields with no control of their own included, like Current HP); each row
// with a control carries an "Adjusted" badge and is `aria-describedby` its
// line in that note. Nothing is shown for a field that holds any other value
// than the one its correction applied: see `currentAdjustments`.

/** The corrections still true of the section being rendered. */
const SectionAdjustments = createContext<readonly GameComponentFieldCorrection[]>([]);

/** field -> id of the note line describing its adjustment. */
const AdjustmentNoteIds = createContext<ReadonlyMap<string, string>>(new Map());

/** The note id for `field`, when that field is adjusted. */
function useAdjustmentNote(field: string | undefined): string | undefined {
  const ids = useContext(AdjustmentNoteIds);
  return field === undefined ? undefined : ids.get(field);
}

/** The visible per-field mark, placed at the end of the row it marks. */
function AdjustedBadge({ noteId }: { noteId: string | undefined }) {
  if (noteId === undefined) return null;
  return (
    <Badge variant="warning" className="shrink-0 px-1.5 py-0 text-[10px]">
      Adjusted
    </Badge>
  );
}

// Shared UI components
interface SliderRowProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  onChange: (v: number) => void;
  tooltipTerm?: string;
  /**
   * Shown after the readout. A slider whose number is a physical quantity has
   * to say which one — "8.0" alone gave no way to tell a metre from a rate,
   * which is the ambiguity that let a 26-foot default jump ship unnoticed.
   */
  unit?: string | null;
  /** The store field this row edits, for its adjustment mark (PF-1148). */
  field?: string;
}

function SliderRow({ label, value, min = 0, max = 1, step = 0.01, precision = 2, onChange, tooltipTerm, unit, field }: SliderRowProps) {
  const inputId = useId();
  const noteId = useAdjustmentNote(field);
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-20 shrink-0 items-center gap-1">
        <label htmlFor={inputId} className="text-xs text-zinc-400">{label}</label>
        {tooltipTerm && <InfoTooltip term={tooltipTerm} />}
      </div>
      <input
        id={inputId}
        aria-describedby={noteId}
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
      <span
        className={`${unit ? 'w-16' : 'w-12'} text-right text-xs tabular-nums text-zinc-400`}
      >
        {unit ? `${value.toFixed(precision)} ${unit}` : value.toFixed(precision)}
      </span>
      <AdjustedBadge noteId={noteId} />
    </div>
  );
}

interface CheckboxRowProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tooltipTerm?: string;
  field?: string;
}

function CheckboxRow({ label, checked, onChange, tooltipTerm, field }: CheckboxRowProps) {
  // Without `htmlFor`/`id` the visible text is not the checkbox's accessible
  // name, so a screen reader announces a bare "checkbox" and the label is not
  // a click target. Every row in this file shares the component, so associating
  // here fixes all of them at once.
  const inputId = useId();
  const noteId = useAdjustmentNote(field);
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-20 shrink-0 items-center gap-1">
        <label htmlFor={inputId} className="text-xs text-zinc-400">{label}</label>
        {tooltipTerm && <InfoTooltip term={tooltipTerm} />}
      </div>
      <input
        id={inputId}
        aria-describedby={noteId}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500
          focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
      />
      <AdjustedBadge noteId={noteId} />
    </div>
  );
}

interface NumberInputRowProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  tooltipTerm?: string;
  field?: string;
}

function NumberInputRow({ label, value, min, max, step = 1, onChange, tooltipTerm, field }: NumberInputRowProps) {
  const inputId = useId();
  const noteId = useAdjustmentNote(field);
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-20 shrink-0 items-center gap-1">
        <label htmlFor={inputId} className="text-xs text-zinc-400">{label}</label>
        {tooltipTerm && <InfoTooltip term={tooltipTerm} />}
      </div>
      <input
        id={inputId}
        aria-describedby={noteId}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
          focus:ring-1 focus:ring-blue-500"
      />
      <AdjustedBadge noteId={noteId} />
    </div>
  );
}

interface TextInputRowProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  tooltipTerm?: string;
  field?: string;
}

function TextInputRow({ label, value, onChange, tooltipTerm, field }: TextInputRowProps) {
  const inputId = useId();
  const noteId = useAdjustmentNote(field);
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-20 shrink-0 items-center gap-1">
        <label htmlFor={inputId} className="text-xs text-zinc-400">{label}</label>
        {tooltipTerm && <InfoTooltip term={tooltipTerm} />}
      </div>
      <input
        id={inputId}
        aria-describedby={noteId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
          focus:ring-1 focus:ring-blue-500"
      />
      <AdjustedBadge noteId={noteId} />
    </div>
  );
}

interface SelectRowProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  tooltipTerm?: string;
  field?: string;
}

function SelectRow({ label, value, options, onChange, tooltipTerm, field }: SelectRowProps) {
  const inputId = useId();
  const noteId = useAdjustmentNote(field);
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-20 shrink-0 items-center gap-1">
        <label htmlFor={inputId} className="text-xs text-zinc-400">{label}</label>
        {tooltipTerm && <InfoTooltip term={tooltipTerm} />}
      </div>
      <select
        id={inputId}
        aria-describedby={noteId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
          focus:ring-1 focus:ring-blue-500"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <AdjustedBadge noteId={noteId} />
    </div>
  );
}

interface Vec3RowProps {
  label: string;
  tooltipTerm: string;
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
  field: string;
}

/**
 * A labelled vector row. The three axis inputs sit in a named group, so the
 * label and the adjustment note both reach a screen reader that enters any of
 * them — `Vec3Input` has no single input to hang either one on.
 */
function Vec3Row({ label, tooltipTerm, value, onChange, field }: Vec3RowProps) {
  const labelId = useId();
  const noteId = useAdjustmentNote(field);
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-20 shrink-0 items-center gap-1">
        <span id={labelId} className="text-xs text-zinc-400">{label}</span>
        <InfoTooltip term={tooltipTerm} />
      </div>
      <div role="group" aria-labelledby={labelId} aria-describedby={noteId} className="min-w-0 flex-1">
        <Vec3Input label="" value={value} onChange={onChange} />
      </div>
      <AdjustedBadge noteId={noteId} />
    </div>
  );
}

// Component section components
interface ComponentSectionProps {
  title: string;
  onRemove: () => void;
  children: React.ReactNode;
}

function ComponentSection({ title, onRemove, children }: ComponentSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const adjustments = useContext(SectionAdjustments);
  const baseId = useId();
  const noteHeadingId = `${baseId}-adjusted`;
  const noteIds = useMemo(
    () => new Map(adjustments.map((c) => [c.field, `${baseId}-adjusted-${c.field}`])),
    [adjustments, baseId],
  );

  // Map title to term for tooltip — memoised because the switch is pure over `title`.
  const tooltipTerm = useMemo(() => {
    switch (title) {
      case 'Character Controller': return 'characterController';
      case 'Health': return 'health';
      case 'Collectible': return 'collectible';
      case 'Damage Zone': return 'damageZone';
      case 'Checkpoint': return 'checkpoint';
      case 'Teleporter': return 'teleporter';
      case 'Moving Platform': return 'movingPlatform';
      case 'Trigger Zone': return 'triggerZone';
      case 'Spawner': return 'spawner';
      case 'Follower': return 'follower';
      case 'Projectile': return 'projectile';
      case 'Win Condition': return 'winCondition';
      default: return undefined;
    }
  }, [title]);

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/50">
      <div className="flex items-center justify-between border-b border-zinc-800 px-2 py-1.5">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-zinc-100"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          {title}
          {tooltipTerm && <InfoTooltip term={tooltipTerm} />}
          {/* Stays on the header so a collapsed section still says it holds a
              value that is not the one asked for. */}
          {adjustments.length > 0 && (
            <Badge variant="warning" className="ml-1 px-1.5 py-0 text-[10px]">
              {adjustments.length} adjusted
            </Badge>
          )}
        </button>
        <button
          onClick={onRemove}
          aria-label={`Remove ${title}`}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {!collapsed && (
        <div className="space-y-2 p-2">
          {adjustments.length > 0 && (
            <InlineAlert variant="warning" aria-labelledby={noteHeadingId}>
              <p id={noteHeadingId} className="font-medium">Adjusted to fit the engine’s limits</p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                {adjustments.map((c) => (
                  <li key={c.field} id={noteIds.get(c.field)}>{describeCorrection(c)}</li>
                ))}
              </ul>
            </InlineAlert>
          )}
          <AdjustmentNoteIds.Provider value={noteIds}>{children}</AdjustmentNoteIds.Provider>
        </div>
      )}
    </div>
  );
}

// Individual component editors
interface CharacterControllerSectionProps {
  data: import('@/stores/editorStore').CharacterControllerData;
  onChange: (data: import('@/stores/editorStore').CharacterControllerData) => void;
  onRemove: () => void;
}

function CharacterControllerSection({ data, onChange, onRemove }: CharacterControllerSectionProps) {
  // Jump Height is the one control here whose number changes meaning with the
  // project type: an apex height in metres on the 3D kinematic path, a rise rate
  // on the 2D legacy path. Both the range and the unit follow from that, so
  // both come from the same module the Add Component default does.
  const projectType: ControllerProjectType = useEditorStore((s) => s.projectType);
  return (
    <ComponentSection title="Character Controller" onRemove={onRemove}>
      <SliderRow label="Speed" value={data.speed} min={0} max={20} step={0.1} precision={1} onChange={(v) => onChange({ ...data, speed: v })} tooltipTerm="gcSpeed" field="speed" />
      <SliderRow
        label="Jump Height"
        value={data.jumpHeight}
        min={0}
        max={jumpHeightSliderMax(projectType, data.gravityScale, data.jumpHeight)}
        step={0.1}
        precision={1}
        onChange={(v) => onChange({ ...data, jumpHeight: v })}
        tooltipTerm="gcJumpHeight" field="jumpHeight"
        unit={jumpHeightUnit(projectType)}
      />
      <SliderRow label="Gravity Scale" value={data.gravityScale} min={0} max={5} step={0.1} precision={1} onChange={(v) => onChange({ ...data, gravityScale: v })} tooltipTerm="gcGravityScale" field="gravityScale" />
      <CheckboxRow label="Double Jump" checked={data.canDoubleJump} onChange={(v) => onChange({ ...data, canDoubleJump: v })} tooltipTerm="gcDoubleJump" field="canDoubleJump" />
    </ComponentSection>
  );
}

interface HealthSectionProps {
  data: import('@/stores/editorStore').HealthData;
  onChange: (data: import('@/stores/editorStore').HealthData) => void;
  onRemove: () => void;
}

function HealthSection({ data, onChange, onRemove }: HealthSectionProps) {
  return (
    <ComponentSection title="Health" onRemove={onRemove}>
      <NumberInputRow label="Max HP" value={data.maxHp} min={1} max={1000} onChange={(v) => onChange({ ...data, maxHp: v })} tooltipTerm="gcMaxHP" field="maxHp" />
      <SliderRow label="Invincibility" value={data.invincibilitySecs} min={0} max={5} step={0.1} precision={1} onChange={(v) => onChange({ ...data, invincibilitySecs: v })} tooltipTerm="gcInvincibility" field="invincibilitySecs" />
      <CheckboxRow label="Respawn" checked={data.respawnOnDeath} onChange={(v) => onChange({ ...data, respawnOnDeath: v })} tooltipTerm="gcRespawn" field="respawnOnDeath" />
      <Vec3Row label="Respawn Pt" tooltipTerm="gcRespawnPoint" value={data.respawnPoint} onChange={(v) => onChange({ ...data, respawnPoint: v })} field="respawnPoint" />
      <CheckboxRow label="Despawn" checked={data.despawnOnDeath} onChange={(v) => onChange({ ...data, despawnOnDeath: v })} tooltipTerm="gcDespawnOnDeath" field="despawnOnDeath" />
    </ComponentSection>
  );
}

interface CollectibleSectionProps {
  data: import('@/stores/editorStore').CollectibleData;
  onChange: (data: import('@/stores/editorStore').CollectibleData) => void;
  onRemove: () => void;
}

function CollectibleSection({ data, onChange, onRemove }: CollectibleSectionProps) {
  return (
    <ComponentSection title="Collectible" onRemove={onRemove}>
      <NumberInputRow label="Value" value={data.value} min={1} max={100} onChange={(v) => onChange({ ...data, value: v })} tooltipTerm="gcCollectValue" field="value" />
      <CheckboxRow label="Destroy" checked={data.destroyOnCollect} onChange={(v) => onChange({ ...data, destroyOnCollect: v })} tooltipTerm="gcDestroyOnCollect" field="destroyOnCollect" />
      <SliderRow label="Rotate Speed" value={data.rotateSpeed} min={0} max={360} step={10} precision={0} onChange={(v) => onChange({ ...data, rotateSpeed: v })} tooltipTerm="gcRotateSpeed" field="rotateSpeed" />
    </ComponentSection>
  );
}

interface DamageZoneSectionProps {
  data: import('@/stores/editorStore').DamageZoneData;
  onChange: (data: import('@/stores/editorStore').DamageZoneData) => void;
  onRemove: () => void;
}

function DamageZoneSection({ data, onChange, onRemove }: DamageZoneSectionProps) {
  return (
    <ComponentSection title="Damage Zone" onRemove={onRemove}>
      <SliderRow label="Damage/Sec" value={data.damagePerSecond} min={0} max={100} step={1} precision={0} onChange={(v) => onChange({ ...data, damagePerSecond: v })} tooltipTerm="gcDamagePerSecond" field="damagePerSecond" />
      <CheckboxRow label="One-Shot" checked={data.oneShot} onChange={(v) => onChange({ ...data, oneShot: v })} tooltipTerm="gcOneShot" field="oneShot" />
    </ComponentSection>
  );
}

interface CheckpointSectionProps {
  data: import('@/stores/editorStore').CheckpointData;
  onChange: (data: import('@/stores/editorStore').CheckpointData) => void;
  onRemove: () => void;
}

function CheckpointSection({ data, onChange, onRemove }: CheckpointSectionProps) {
  return (
    <ComponentSection title="Checkpoint" onRemove={onRemove}>
      <CheckboxRow label="Auto-Save" checked={data.autoSave} onChange={(v) => onChange({ ...data, autoSave: v })} tooltipTerm="gcAutoSave" field="autoSave" />
    </ComponentSection>
  );
}

interface TeleporterSectionProps {
  data: import('@/stores/editorStore').TeleporterData;
  onChange: (data: import('@/stores/editorStore').TeleporterData) => void;
  onRemove: () => void;
}

function TeleporterSection({ data, onChange, onRemove }: TeleporterSectionProps) {
  return (
    <ComponentSection title="Teleporter" onRemove={onRemove}>
      <Vec3Row label="Target Pos" tooltipTerm="gcTargetPos" value={data.targetPosition} onChange={(v) => onChange({ ...data, targetPosition: v })} field="targetPosition" />
      <SliderRow label="Cooldown" value={data.cooldownSecs} min={0} max={10} step={0.1} precision={1} onChange={(v) => onChange({ ...data, cooldownSecs: v })} tooltipTerm="gcCooldown" field="cooldownSecs" />
    </ComponentSection>
  );
}

interface MovingPlatformSectionProps {
  data: import('@/stores/editorStore').MovingPlatformData;
  onChange: (data: import('@/stores/editorStore').MovingPlatformData) => void;
  onRemove: () => void;
}

interface WaypointsRowProps {
  waypoints: [number, number, number][];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, value: [number, number, number]) => void;
}

/**
 * The route editor, as a named group carrying the route's adjustment mark.
 *
 * Its own component rather than inline in `MovingPlatformSection`: the note ids
 * are provided INSIDE `ComponentSection`, so a lookup made in the section's own
 * body sits above that provider, reads the empty default, and never marks the
 * row — which is how the route row shipped unmarked while the section note
 * above it listed the route correctly.
 */
function WaypointsRow({ waypoints, onAdd, onRemove, onUpdate }: WaypointsRowProps) {
  const labelId = useId();
  const noteId = useAdjustmentNote('waypoints');
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={noteId}
      className="space-y-1"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span id={labelId} className="text-xs text-zinc-400">Waypoints</span>
          <AdjustedBadge noteId={noteId} />
        </div>
        <button
          onClick={onAdd}
          aria-label="Add waypoint"
          className="rounded bg-zinc-800 p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
        >
          <Plus size={12} />
        </button>
      </div>
      {waypoints.map((wp, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="w-8 text-xs text-zinc-400">{i}</span>
          <Vec3Input label="" value={wp} onChange={(v) => onUpdate(i, v)} />
          <button
            onClick={() => onRemove(i)}
            aria-label={`Remove waypoint ${i}`}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

function MovingPlatformSection({ data, onChange, onRemove }: MovingPlatformSectionProps) {
  const addWaypoint = () => {
    onChange({ ...data, waypoints: [...data.waypoints, [0, 0, 0]] });
  };
  const removeWaypoint = (index: number) => {
    onChange({ ...data, waypoints: data.waypoints.filter((_, i) => i !== index) });
  };
  const updateWaypoint = (index: number, value: [number, number, number]) => {
    const newWaypoints = [...data.waypoints];
    newWaypoints[index] = value;
    onChange({ ...data, waypoints: newWaypoints });
  };

  return (
    <ComponentSection title="Moving Platform" onRemove={onRemove}>
      <SliderRow label="Speed" value={data.speed} min={0} max={10} step={0.1} precision={1} onChange={(v) => onChange({ ...data, speed: v })} tooltipTerm="gcPlatformSpeed" field="speed" />
      <SliderRow label="Pause" value={data.pauseDuration} min={0} max={5} step={0.1} precision={1} onChange={(v) => onChange({ ...data, pauseDuration: v })} tooltipTerm="gcPauseTime" field="pauseDuration" />
      <SelectRow
        label="Loop Mode"
        value={data.loopMode}
        options={[
          { value: 'pingPong', label: 'Ping-Pong' },
          { value: 'loop', label: 'Loop' },
          { value: 'once', label: 'Once' },
        ]}
        onChange={(v) => onChange({ ...data, loopMode: v as import('@/stores/editorStore').PlatformLoopMode })}
        tooltipTerm="gcLoopMode" field="loopMode"
      />
      <WaypointsRow
        waypoints={data.waypoints}
        onAdd={addWaypoint}
        onRemove={removeWaypoint}
        onUpdate={updateWaypoint}
      />
    </ComponentSection>
  );
}

interface TriggerZoneSectionProps {
  data: import('@/stores/editorStore').TriggerZoneData;
  onChange: (data: import('@/stores/editorStore').TriggerZoneData) => void;
  onRemove: () => void;
}

function TriggerZoneSection({ data, onChange, onRemove }: TriggerZoneSectionProps) {
  return (
    <ComponentSection title="Trigger Zone" onRemove={onRemove}>
      <TextInputRow label="Event Name" value={data.eventName} onChange={(v) => onChange({ ...data, eventName: v })} tooltipTerm="gcEventName" field="eventName" />
      <CheckboxRow label="One-Shot" checked={data.oneShot} onChange={(v) => onChange({ ...data, oneShot: v })} tooltipTerm="gcOneShot" field="oneShot" />
    </ComponentSection>
  );
}

interface SpawnerSectionProps {
  data: import('@/stores/editorStore').SpawnerData;
  onChange: (data: import('@/stores/editorStore').SpawnerData) => void;
  onRemove: () => void;
}

function SpawnerSection({ data, onChange, onRemove }: SpawnerSectionProps) {
  return (
    <ComponentSection title="Spawner" onRemove={onRemove}>
      <SelectRow
        label="Entity Type"
        value={data.entityType}
        options={[
          { value: 'cube', label: 'Cube' },
          { value: 'sphere', label: 'Sphere' },
          { value: 'cylinder', label: 'Cylinder' },
          { value: 'capsule', label: 'Capsule' },
        ]}
        onChange={(v) => onChange({ ...data, entityType: v })}
        tooltipTerm="gcEntityType" field="entityType"
      />
      <SliderRow label="Interval" value={data.intervalSecs} min={0.5} max={30} step={0.5} precision={1} onChange={(v) => onChange({ ...data, intervalSecs: v })} tooltipTerm="gcSpawnInterval" field="intervalSecs" />
      <NumberInputRow label="Max Count" value={data.maxCount} min={1} max={50} onChange={(v) => onChange({ ...data, maxCount: v })} tooltipTerm="gcMaxCount" field="maxCount" />
      <Vec3Row label="Offset" tooltipTerm="gcSpawnOffset" value={data.spawnOffset} onChange={(v) => onChange({ ...data, spawnOffset: v })} field="spawnOffset" />
    </ComponentSection>
  );
}

interface FollowerSectionProps {
  data: import('@/stores/editorStore').FollowerData;
  onChange: (data: import('@/stores/editorStore').FollowerData) => void;
  onRemove: () => void;
}

function FollowerSection({ data, onChange, onRemove }: FollowerSectionProps) {
  return (
    <ComponentSection title="Follower" onRemove={onRemove}>
      <TextInputRow label="Target ID" value={data.targetEntityId ?? ''} onChange={(v) => onChange({ ...data, targetEntityId: v || null })} tooltipTerm="gcTargetId" field="targetEntityId" />
      <SliderRow label="Speed" value={data.speed} min={0} max={20} step={0.1} precision={1} onChange={(v) => onChange({ ...data, speed: v })} tooltipTerm="gcFollowSpeed" field="speed" />
      <SliderRow label="Stop Dist" value={data.stopDistance} min={0} max={10} step={0.1} precision={1} onChange={(v) => onChange({ ...data, stopDistance: v })} tooltipTerm="gcStopDist" field="stopDistance" />
      <CheckboxRow label="Look At" checked={data.lookAtTarget} onChange={(v) => onChange({ ...data, lookAtTarget: v })} tooltipTerm="gcLookAt" field="lookAtTarget" />
    </ComponentSection>
  );
}

interface ProjectileSectionProps {
  data: import('@/stores/editorStore').ProjectileData;
  onChange: (data: import('@/stores/editorStore').ProjectileData) => void;
  onRemove: () => void;
}

function ProjectileSection({ data, onChange, onRemove }: ProjectileSectionProps) {
  return (
    <ComponentSection title="Projectile" onRemove={onRemove}>
      <SliderRow label="Speed" value={data.speed} min={0} max={50} step={1} precision={0} onChange={(v) => onChange({ ...data, speed: v })} tooltipTerm="gcProjectileSpeed" field="speed" />
      <SliderRow label="Damage" value={data.damage} min={0} max={100} step={1} precision={0} onChange={(v) => onChange({ ...data, damage: v })} tooltipTerm="gcProjectileDamage" field="damage" />
      <SliderRow label="Lifetime" value={data.lifetimeSecs} min={0.5} max={30} step={0.5} precision={1} onChange={(v) => onChange({ ...data, lifetimeSecs: v })} tooltipTerm="gcProjectileLifetime" field="lifetimeSecs" />
      <CheckboxRow label="Gravity" checked={data.gravity} onChange={(v) => onChange({ ...data, gravity: v })} tooltipTerm="gcProjectileGravity" field="gravity" />
      <CheckboxRow label="Destroy Hit" checked={data.destroyOnHit} onChange={(v) => onChange({ ...data, destroyOnHit: v })} tooltipTerm="gcDestroyOnHit" field="destroyOnHit" />
    </ComponentSection>
  );
}

interface WinConditionSectionProps {
  data: import('@/stores/editorStore').WinConditionData;
  onChange: (data: import('@/stores/editorStore').WinConditionData) => void;
  onRemove: () => void;
}

function WinConditionSection({ data, onChange, onRemove }: WinConditionSectionProps) {
  return (
    <ComponentSection title="Win Condition" onRemove={onRemove}>
      <SelectRow
        label="Type"
        value={data.conditionType}
        options={[
          { value: 'score', label: 'Score' },
          { value: 'collectAll', label: 'Collect All' },
          { value: 'reachGoal', label: 'Reach Goal' },
        ]}
        onChange={(v) => onChange({ ...data, conditionType: v as import('@/stores/editorStore').WinConditionType })}
        tooltipTerm="gcWinType" field="conditionType"
      />
      {data.conditionType === 'score' && (
        <NumberInputRow label="Target Score" value={data.targetScore ?? 10} min={1} onChange={(v) => onChange({ ...data, targetScore: v })} tooltipTerm="gcTargetScore" field="targetScore" />
      )}
      {data.conditionType === 'reachGoal' && (
        <TextInputRow label="Goal ID" value={data.targetEntityId ?? ''} onChange={(v) => onChange({ ...data, targetEntityId: v || null })} tooltipTerm="gcGoalId" field="targetEntityId" />
      )}
    </ComponentSection>
  );
}

interface DialogueTriggerSectionProps {
  data: DialogueTriggerData;
  onChange: (data: DialogueTriggerData) => void;
  onRemove: () => void;
}

function DialogueTriggerSection({ data, onChange, onRemove }: DialogueTriggerSectionProps) {
  const dialogueTrees = useDialogueStore((s) => s.dialogueTrees);
  // `listTrees`: a stored `null` entry would throw on `t.id` and take the whole
  // inspector down, and an unwalkable tree offered here is a tree the runtime will
  // refuse the moment the author picks it.
  const treeOptions = listTrees(dialogueTrees).map((t) => ({ value: t.id, label: t.name }));

  // A controlled `<select>` whose value matches no option displays the FIRST
  // option, so a trigger still pointing at a deleted — or unwalkable, and so
  // filtered out just above — tree reads as `(none)` while the dead id stays on
  // the component and the trigger silently does nothing at runtime. The id is
  // kept as the value (nothing here should rewrite the author's data) and given
  // an option that says what it is.
  const missingTreeOption = data.treeId !== '' && !treeOptions.some((o) => o.value === data.treeId)
    ? [{ value: data.treeId, label: `⚠ Missing tree (${data.treeId})` }]
    : [];

  return (
    <ComponentSection title="Dialogue Trigger" onRemove={onRemove}>
      <SelectRow
        label="Tree"
        value={data.treeId}
        options={[{ value: '', label: '(none)' }, ...missingTreeOption, ...treeOptions]}
        onChange={(v) => onChange({ ...data, treeId: v })}
        tooltipTerm="gcDialogueTree" field="treeId"
      />
      <SliderRow label="Radius" value={data.triggerRadius} min={0.5} max={20} step={0.5} precision={1} onChange={(v) => onChange({ ...data, triggerRadius: v })} tooltipTerm="gcTriggerRadius" field="triggerRadius" />
      <CheckboxRow label="Require Interact" checked={data.requireInteract} onChange={(v) => onChange({ ...data, requireInteract: v })} tooltipTerm="gcRequireInteract" field="requireInteract" />
      {data.requireInteract && (
        <TextInputRow label="Key" value={data.interactKey} onChange={(v) => onChange({ ...data, interactKey: v || 'e' })} tooltipTerm="gcInteractKey" field="interactKey" />
      )}
      <CheckboxRow label="One Shot" checked={data.oneShot} onChange={(v) => onChange({ ...data, oneShot: v })} tooltipTerm="gcOneShot" field="oneShot" />
    </ComponentSection>
  );
}

// Main inspector
export function GameComponentInspector() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const projectType: ControllerProjectType = useEditorStore((s) => s.projectType);
  const primaryGameComponents = useEditorStore((s) => s.primaryGameComponents);
  const addGameComponent = useEditorStore((s) => s.addGameComponent);
  const updateGameComponent = useEditorStore((s) => s.updateGameComponent);
  const removeGameComponent = useEditorStore((s) => s.removeGameComponent);
  // PF-1148: which fields hold a value other than the one asked for.
  const adjustmentMap: GameComponentAdjustments = useEditorStore((s) => s.gameComponentAdjustments);

  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const attachedTypes = (primaryGameComponents ?? []).map((c) => {
    if (c.type === 'characterController') return 'character_controller';
    if (c.type === 'health') return 'health';
    if (c.type === 'collectible') return 'collectible';
    if (c.type === 'damageZone') return 'damage_zone';
    if (c.type === 'checkpoint') return 'checkpoint';
    if (c.type === 'teleporter') return 'teleporter';
    if (c.type === 'movingPlatform') return 'moving_platform';
    if (c.type === 'triggerZone') return 'trigger_zone';
    if (c.type === 'spawner') return 'spawner';
    if (c.type === 'follower') return 'follower';
    if (c.type === 'projectile') return 'projectile';
    if (c.type === 'winCondition') return 'win_condition';
    if (c.type === 'dialogueTrigger') return 'dialogue_trigger';
    return '';
  });

  const availableTypes = GAME_COMPONENT_TYPES.filter((t) => !attachedTypes.includes(t));

  const handleAddComponent = useCallback((typeName: string) => {
    if (!primaryId) return;

    // Build default component data based on type
    let component: GameComponentData;
    switch (typeName) {
      case 'character_controller':
        // Project-type aware: the engine's own `Default` (jumpHeight 8) is the
        // value the 2D legacy path's rise-rate arithmetic was tuned against, and
        // shipping it into a 3D project asked the kinematic path for an
        // eight-metre apex — a 2.6-second hang time (PF-1228).
        component = {
          type: 'characterController',
          characterController: defaultCharacterController(projectType),
        };
        break;
      case 'health':
        component = { type: 'health', health: { maxHp: 100, currentHp: 100, invincibilitySecs: 0.5, respawnOnDeath: true, respawnPoint: [0, 1, 0], despawnOnDeath: true } };
        break;
      case 'collectible':
        component = { type: 'collectible', collectible: { value: 1, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 90 } };
        break;
      case 'damage_zone':
        component = { type: 'damageZone', damageZone: { damagePerSecond: 25, oneShot: false } };
        break;
      case 'checkpoint':
        component = { type: 'checkpoint', checkpoint: { autoSave: true } };
        break;
      case 'teleporter':
        component = { type: 'teleporter', teleporter: { targetPosition: [0, 1, 0], cooldownSecs: 1 } };
        break;
      case 'moving_platform':
        component = { type: 'movingPlatform', movingPlatform: { speed: 2, waypoints: [[0, 0, 0], [0, 3, 0]], pauseDuration: 0.5, loopMode: 'pingPong' } };
        break;
      case 'trigger_zone':
        component = { type: 'triggerZone', triggerZone: { eventName: 'trigger', oneShot: false } };
        break;
      case 'spawner':
        component = { type: 'spawner', spawner: { entityType: 'cube', intervalSecs: 3, maxCount: 5, spawnOffset: [0, 1, 0], onTrigger: null } };
        break;
      case 'follower':
        component = { type: 'follower', follower: { targetEntityId: null, speed: 3, stopDistance: 1.5, lookAtTarget: true } };
        break;
      case 'projectile':
        component = { type: 'projectile', projectile: { speed: 15, damage: 10, lifetimeSecs: 5, gravity: false, destroyOnHit: true } };
        break;
      case 'win_condition':
        component = { type: 'winCondition', winCondition: { conditionType: 'score', targetScore: 10, targetEntityId: null } };
        break;
      case 'dialogue_trigger':
        component = { type: 'dialogueTrigger', dialogueTrigger: { treeId: '', triggerRadius: 3, requireInteract: true, interactKey: 'e', oneShot: false } };
        break;
      default:
        return;
    }

    addGameComponent(primaryId, component);
    setAddMenuOpen(false);
  }, [primaryId, addGameComponent, projectType]);

  const handleUpdate = useCallback((component: GameComponentData) => {
    if (primaryId) {
      updateGameComponent(primaryId, component);
    }
  }, [primaryId, updateGameComponent]);

  const handleRemove = useCallback((typeName: string) => {
    if (primaryId) {
      removeGameComponent(primaryId, typeName);
    }
  }, [primaryId, removeGameComponent]);

  const renderSection = (comp: GameComponentData) => {
    if (comp.type === 'characterController') {
      return <CharacterControllerSection key="cc" data={comp.characterController} onChange={(d) => handleUpdate({ type: 'characterController', characterController: d })} onRemove={() => handleRemove('character_controller')} />;
    }
    if (comp.type === 'health') {
      return <HealthSection key="health" data={comp.health} onChange={(d) => handleUpdate({ type: 'health', health: d })} onRemove={() => handleRemove('health')} />;
    }
    if (comp.type === 'collectible') {
      return <CollectibleSection key="collectible" data={comp.collectible} onChange={(d) => handleUpdate({ type: 'collectible', collectible: d })} onRemove={() => handleRemove('collectible')} />;
    }
    if (comp.type === 'damageZone') {
      return <DamageZoneSection key="damageZone" data={comp.damageZone} onChange={(d) => handleUpdate({ type: 'damageZone', damageZone: d })} onRemove={() => handleRemove('damage_zone')} />;
    }
    if (comp.type === 'checkpoint') {
      return <CheckpointSection key="checkpoint" data={comp.checkpoint} onChange={(d) => handleUpdate({ type: 'checkpoint', checkpoint: d })} onRemove={() => handleRemove('checkpoint')} />;
    }
    if (comp.type === 'teleporter') {
      return <TeleporterSection key="teleporter" data={comp.teleporter} onChange={(d) => handleUpdate({ type: 'teleporter', teleporter: d })} onRemove={() => handleRemove('teleporter')} />;
    }
    if (comp.type === 'movingPlatform') {
      return <MovingPlatformSection key="movingPlatform" data={comp.movingPlatform} onChange={(d) => handleUpdate({ type: 'movingPlatform', movingPlatform: d })} onRemove={() => handleRemove('moving_platform')} />;
    }
    if (comp.type === 'triggerZone') {
      return <TriggerZoneSection key="triggerZone" data={comp.triggerZone} onChange={(d) => handleUpdate({ type: 'triggerZone', triggerZone: d })} onRemove={() => handleRemove('trigger_zone')} />;
    }
    if (comp.type === 'spawner') {
      return <SpawnerSection key="spawner" data={comp.spawner} onChange={(d) => handleUpdate({ type: 'spawner', spawner: d })} onRemove={() => handleRemove('spawner')} />;
    }
    if (comp.type === 'follower') {
      return <FollowerSection key="follower" data={comp.follower} onChange={(d) => handleUpdate({ type: 'follower', follower: d })} onRemove={() => handleRemove('follower')} />;
    }
    if (comp.type === 'projectile') {
      return <ProjectileSection key="projectile" data={comp.projectile} onChange={(d) => handleUpdate({ type: 'projectile', projectile: d })} onRemove={() => handleRemove('projectile')} />;
    }
    if (comp.type === 'winCondition') {
      return <WinConditionSection key="winCondition" data={comp.winCondition} onChange={(d) => handleUpdate({ type: 'winCondition', winCondition: d })} onRemove={() => handleRemove('win_condition')} />;
    }
    if (comp.type === 'dialogueTrigger') {
      return <DialogueTriggerSection key="dialogueTrigger" data={comp.dialogueTrigger} onChange={(d) => handleUpdate({ type: 'dialogueTrigger', dialogueTrigger: d })} onRemove={() => handleRemove('dialogue_trigger')} />;
    }
    return null;
  };

  if (!primaryId) return null;

  return (
    <div className="border-t border-zinc-800 pt-4 mt-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Game Components
          </h3>
          <InfoTooltip text="Pre-built behaviors you can add to make objects interactive" />
        </div>
        <div className="relative">
          <button
            onClick={() => setAddMenuOpen(!addMenuOpen)}
            className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
          >
            <Plus size={12} />
            Add
          </button>
          {addMenuOpen && availableTypes.length > 0 && (
            <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded border border-zinc-700 bg-zinc-900 shadow-lg">
              {availableTypes.map((t) => (
                <button
                  key={t}
                  onClick={() => handleAddComponent(t)}
                  className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  {t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {(primaryGameComponents ?? []).map((comp) => (
          // Only the corrections the displayed value still bears out: the
          // inspector shows the engine's echo, which undo or a scene load
          // can have moved without the store action that clears a marker.
          <SectionAdjustments.Provider
            key={comp.type}
            value={currentAdjustments(componentAdjustmentsOf(adjustmentMap, primaryId, comp.type), comp)}
          >
            {renderSection(comp)}
          </SectionAdjustments.Provider>
        ))}

        {(!primaryGameComponents || primaryGameComponents.length === 0) && (
          <p className="text-xs text-zinc-400">No game components attached</p>
        )}
      </div>
    </div>
  );
}
