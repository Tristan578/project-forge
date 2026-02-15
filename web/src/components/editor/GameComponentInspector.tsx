'use client';

import { useCallback, useState } from 'react';
import { useEditorStore, type GameComponentData, type DialogueTriggerData, GAME_COMPONENT_TYPES } from '@/stores/editorStore';
import { useDialogueStore } from '@/stores/dialogueStore';
import { ChevronDown, ChevronRight, Trash2, Plus } from 'lucide-react';
import { Vec3Input } from './Vec3Input';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

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
}

function SliderRow({ label, value, min = 0, max = 1, step = 0.01, precision = 2, onChange, tooltipTerm }: SliderRowProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-20 shrink-0 items-center gap-1">
        <label className="text-xs text-zinc-400">{label}</label>
        {tooltipTerm && <InfoTooltip term={tooltipTerm} />}
      </div>
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
  tooltipTerm?: string;
}

function CheckboxRow({ label, checked, onChange, tooltipTerm }: CheckboxRowProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-20 shrink-0 items-center gap-1">
        <label className="text-xs text-zinc-400">{label}</label>
        {tooltipTerm && <InfoTooltip term={tooltipTerm} />}
      </div>
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

interface NumberInputRowProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  tooltipTerm?: string;
}

function NumberInputRow({ label, value, min, max, step = 1, onChange, tooltipTerm }: NumberInputRowProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-20 shrink-0 items-center gap-1">
        <label className="text-xs text-zinc-400">{label}</label>
        {tooltipTerm && <InfoTooltip term={tooltipTerm} />}
      </div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
          focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
}

interface TextInputRowProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  tooltipTerm?: string;
}

function TextInputRow({ label, value, onChange, tooltipTerm }: TextInputRowProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-20 shrink-0 items-center gap-1">
        <label className="text-xs text-zinc-400">{label}</label>
        {tooltipTerm && <InfoTooltip term={tooltipTerm} />}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
          focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
}

interface SelectRowProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  tooltipTerm?: string;
}

function SelectRow({ label, value, options, onChange, tooltipTerm }: SelectRowProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-20 shrink-0 items-center gap-1">
        <label className="text-xs text-zinc-400">{label}</label>
        {tooltipTerm && <InfoTooltip term={tooltipTerm} />}
      </div>
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

// Component section components
interface ComponentSectionProps {
  title: string;
  onRemove: () => void;
  children: React.ReactNode;
}

function ComponentSection({ title, onRemove, children }: ComponentSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Map title to term for tooltip
  const tooltipTerm = (() => {
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
  })();

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
        </button>
        <button
          onClick={onRemove}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {!collapsed && (
        <div className="space-y-2 p-2">
          {children}
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
  return (
    <ComponentSection title="Character Controller" onRemove={onRemove}>
      <SliderRow label="Speed" value={data.speed} min={0} max={20} step={0.1} precision={1} onChange={(v) => onChange({ ...data, speed: v })} tooltipTerm="gcSpeed" />
      <SliderRow label="Jump Height" value={data.jumpHeight} min={0} max={20} step={0.1} precision={1} onChange={(v) => onChange({ ...data, jumpHeight: v })} tooltipTerm="gcJumpHeight" />
      <SliderRow label="Gravity Scale" value={data.gravityScale} min={0} max={5} step={0.1} precision={1} onChange={(v) => onChange({ ...data, gravityScale: v })} tooltipTerm="gcGravityScale" />
      <CheckboxRow label="Double Jump" checked={data.canDoubleJump} onChange={(v) => onChange({ ...data, canDoubleJump: v })} tooltipTerm="gcDoubleJump" />
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
      <NumberInputRow label="Max HP" value={data.maxHp} min={1} max={1000} onChange={(v) => onChange({ ...data, maxHp: v })} tooltipTerm="gcMaxHP" />
      <SliderRow label="Invincibility" value={data.invincibilitySecs} min={0} max={5} step={0.1} precision={1} onChange={(v) => onChange({ ...data, invincibilitySecs: v })} tooltipTerm="gcInvincibility" />
      <CheckboxRow label="Respawn" checked={data.respawnOnDeath} onChange={(v) => onChange({ ...data, respawnOnDeath: v })} tooltipTerm="gcRespawn" />
      <div className="flex items-center gap-2">
        <div className="flex w-20 shrink-0 items-center gap-1">
          <label className="text-xs text-zinc-400">Respawn Pt</label>
          <InfoTooltip term="gcRespawnPoint" />
        </div>
        <Vec3Input label="" value={data.respawnPoint} onChange={(v) => onChange({ ...data, respawnPoint: v })} />
      </div>
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
      <NumberInputRow label="Value" value={data.value} min={1} max={100} onChange={(v) => onChange({ ...data, value: v })} tooltipTerm="gcCollectValue" />
      <CheckboxRow label="Destroy" checked={data.destroyOnCollect} onChange={(v) => onChange({ ...data, destroyOnCollect: v })} tooltipTerm="gcDestroyOnCollect" />
      <SliderRow label="Rotate Speed" value={data.rotateSpeed} min={0} max={360} step={10} precision={0} onChange={(v) => onChange({ ...data, rotateSpeed: v })} tooltipTerm="gcRotateSpeed" />
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
      <SliderRow label="Damage/Sec" value={data.damagePerSecond} min={0} max={100} step={1} precision={0} onChange={(v) => onChange({ ...data, damagePerSecond: v })} tooltipTerm="gcDamagePerSecond" />
      <CheckboxRow label="One-Shot" checked={data.oneShot} onChange={(v) => onChange({ ...data, oneShot: v })} tooltipTerm="gcOneShot" />
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
      <CheckboxRow label="Auto-Save" checked={data.autoSave} onChange={(v) => onChange({ ...data, autoSave: v })} tooltipTerm="gcAutoSave" />
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
      <div className="flex items-center gap-2">
        <div className="flex w-20 shrink-0 items-center gap-1">
          <label className="text-xs text-zinc-400">Target Pos</label>
          <InfoTooltip term="gcTargetPos" />
        </div>
        <Vec3Input label="" value={data.targetPosition} onChange={(v) => onChange({ ...data, targetPosition: v })} />
      </div>
      <SliderRow label="Cooldown" value={data.cooldownSecs} min={0} max={10} step={0.1} precision={1} onChange={(v) => onChange({ ...data, cooldownSecs: v })} tooltipTerm="gcCooldown" />
    </ComponentSection>
  );
}

interface MovingPlatformSectionProps {
  data: import('@/stores/editorStore').MovingPlatformData;
  onChange: (data: import('@/stores/editorStore').MovingPlatformData) => void;
  onRemove: () => void;
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
      <SliderRow label="Speed" value={data.speed} min={0} max={10} step={0.1} precision={1} onChange={(v) => onChange({ ...data, speed: v })} tooltipTerm="gcPlatformSpeed" />
      <SliderRow label="Pause" value={data.pauseDuration} min={0} max={5} step={0.1} precision={1} onChange={(v) => onChange({ ...data, pauseDuration: v })} tooltipTerm="gcPauseTime" />
      <SelectRow
        label="Loop Mode"
        value={data.loopMode}
        options={[
          { value: 'pingPong', label: 'Ping-Pong' },
          { value: 'loop', label: 'Loop' },
          { value: 'once', label: 'Once' },
        ]}
        onChange={(v) => onChange({ ...data, loopMode: v as import('@/stores/editorStore').PlatformLoopMode })}
        tooltipTerm="gcLoopMode"
      />
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-zinc-400">Waypoints</label>
          <button
            onClick={addWaypoint}
            className="rounded bg-zinc-800 p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
          >
            <Plus size={12} />
          </button>
        </div>
        {data.waypoints.map((wp, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="w-8 text-xs text-zinc-500">{i}</span>
            <Vec3Input label="" value={wp} onChange={(v) => updateWaypoint(i, v)} />
            <button
              onClick={() => removeWaypoint(i)}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
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
      <TextInputRow label="Event Name" value={data.eventName} onChange={(v) => onChange({ ...data, eventName: v })} tooltipTerm="gcEventName" />
      <CheckboxRow label="One-Shot" checked={data.oneShot} onChange={(v) => onChange({ ...data, oneShot: v })} tooltipTerm="gcOneShot" />
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
        tooltipTerm="gcEntityType"
      />
      <SliderRow label="Interval" value={data.intervalSecs} min={0.5} max={30} step={0.5} precision={1} onChange={(v) => onChange({ ...data, intervalSecs: v })} tooltipTerm="gcSpawnInterval" />
      <NumberInputRow label="Max Count" value={data.maxCount} min={1} max={50} onChange={(v) => onChange({ ...data, maxCount: v })} tooltipTerm="gcMaxCount" />
      <div className="flex items-center gap-2">
        <div className="flex w-20 shrink-0 items-center gap-1">
          <label className="text-xs text-zinc-400">Offset</label>
          <InfoTooltip term="gcSpawnOffset" />
        </div>
        <Vec3Input label="" value={data.spawnOffset} onChange={(v) => onChange({ ...data, spawnOffset: v })} />
      </div>
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
      <TextInputRow label="Target ID" value={data.targetEntityId ?? ''} onChange={(v) => onChange({ ...data, targetEntityId: v || null })} tooltipTerm="gcTargetId" />
      <SliderRow label="Speed" value={data.speed} min={0} max={20} step={0.1} precision={1} onChange={(v) => onChange({ ...data, speed: v })} tooltipTerm="gcFollowSpeed" />
      <SliderRow label="Stop Dist" value={data.stopDistance} min={0} max={10} step={0.1} precision={1} onChange={(v) => onChange({ ...data, stopDistance: v })} tooltipTerm="gcStopDist" />
      <CheckboxRow label="Look At" checked={data.lookAtTarget} onChange={(v) => onChange({ ...data, lookAtTarget: v })} tooltipTerm="gcLookAt" />
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
      <SliderRow label="Speed" value={data.speed} min={0} max={50} step={1} precision={0} onChange={(v) => onChange({ ...data, speed: v })} tooltipTerm="gcProjectileSpeed" />
      <SliderRow label="Damage" value={data.damage} min={0} max={100} step={1} precision={0} onChange={(v) => onChange({ ...data, damage: v })} tooltipTerm="gcProjectileDamage" />
      <SliderRow label="Lifetime" value={data.lifetimeSecs} min={0.5} max={30} step={0.5} precision={1} onChange={(v) => onChange({ ...data, lifetimeSecs: v })} tooltipTerm="gcProjectileLifetime" />
      <CheckboxRow label="Gravity" checked={data.gravity} onChange={(v) => onChange({ ...data, gravity: v })} tooltipTerm="gcProjectileGravity" />
      <CheckboxRow label="Destroy Hit" checked={data.destroyOnHit} onChange={(v) => onChange({ ...data, destroyOnHit: v })} tooltipTerm="gcDestroyOnHit" />
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
        tooltipTerm="gcWinType"
      />
      {data.conditionType === 'score' && (
        <NumberInputRow label="Target Score" value={data.targetScore ?? 10} min={1} onChange={(v) => onChange({ ...data, targetScore: v })} tooltipTerm="gcTargetScore" />
      )}
      {data.conditionType === 'reachGoal' && (
        <TextInputRow label="Goal ID" value={data.targetEntityId ?? ''} onChange={(v) => onChange({ ...data, targetEntityId: v || null })} tooltipTerm="gcGoalId" />
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
  const treeOptions = Object.values(dialogueTrees).map((t) => ({ value: t.id, label: t.name }));

  return (
    <ComponentSection title="Dialogue Trigger" onRemove={onRemove}>
      <SelectRow
        label="Tree"
        value={data.treeId}
        options={[{ value: '', label: '(none)' }, ...treeOptions]}
        onChange={(v) => onChange({ ...data, treeId: v })}
        tooltipTerm="gcDialogueTree"
      />
      <SliderRow label="Radius" value={data.triggerRadius} min={0.5} max={20} step={0.5} precision={1} onChange={(v) => onChange({ ...data, triggerRadius: v })} tooltipTerm="gcTriggerRadius" />
      <CheckboxRow label="Require Interact" checked={data.requireInteract} onChange={(v) => onChange({ ...data, requireInteract: v })} tooltipTerm="gcRequireInteract" />
      {data.requireInteract && (
        <TextInputRow label="Key" value={data.interactKey} onChange={(v) => onChange({ ...data, interactKey: v || 'e' })} tooltipTerm="gcInteractKey" />
      )}
      <CheckboxRow label="One Shot" checked={data.oneShot} onChange={(v) => onChange({ ...data, oneShot: v })} tooltipTerm="gcOneShot" />
    </ComponentSection>
  );
}

// Main inspector
export function GameComponentInspector() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const primaryGameComponents = useEditorStore((s) => s.primaryGameComponents);
  const addGameComponent = useEditorStore((s) => s.addGameComponent);
  const updateGameComponent = useEditorStore((s) => s.updateGameComponent);
  const removeGameComponent = useEditorStore((s) => s.removeGameComponent);

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
        component = { type: 'characterController', characterController: { speed: 5, jumpHeight: 8, gravityScale: 1, canDoubleJump: false } };
        break;
      case 'health':
        component = { type: 'health', health: { maxHp: 100, currentHp: 100, invincibilitySecs: 0.5, respawnOnDeath: true, respawnPoint: [0, 1, 0] } };
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
  }, [primaryId, addGameComponent]);

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

  if (!primaryId) return null;

  return (
    <div className="border-t border-zinc-800 pt-4 mt-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
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
        {(primaryGameComponents ?? []).map((comp) => {
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
        })}

        {(!primaryGameComponents || primaryGameComponents.length === 0) && (
          <p className="text-xs text-zinc-500">No game components attached</p>
        )}
      </div>
    </div>
  );
}
