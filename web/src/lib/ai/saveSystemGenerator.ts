/**
 * Save System Generator — AI-powered game persistence logic.
 *
 * Analyzes a scene to detect what needs saving (positions, health, scores, etc.)
 * and generates a complete save/load system with checkpoints and auto-save.
 */

import type { SceneGraph, SceneNode } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PersistedFieldType =
  | 'position'
  | 'inventory'
  | 'score'
  | 'health'
  | 'level'
  | 'custom';

export interface PersistedField {
  /** Dot-path to the data, e.g. "player.position" */
  path: string;
  type: PersistedFieldType;
  /** Optional custom serialiser function name */
  serializer?: string;
}

export type CheckpointTrigger =
  | 'zone_enter'
  | 'enemy_clear'
  | 'item_pickup'
  | 'manual';

export interface CheckpointConfig {
  id: string;
  name: string;
  trigger: CheckpointTrigger;
  position: { x: number; y: number; z: number };
}

export interface SaveSystemConfig {
  saveSlots: number;
  autoSaveInterval: number;
  checkpointTriggers: string[];
  persistedData: PersistedField[];
  compression: boolean;
}

export type SaveUIType =
  | 'save_indicator'
  | 'slot_picker'
  | 'checkpoint_notification';

export interface SaveUISpec {
  type: SaveUIType;
  position: string;
  style: Record<string, string>;
}

export interface SaveSystem {
  config: SaveSystemConfig;
  checkpoints: CheckpointConfig[];
  script: string;
  uiComponents: SaveUISpec[];
}

// ---------------------------------------------------------------------------
// Scene Analysis
// ---------------------------------------------------------------------------

/** Heuristic keywords mapped to persisted-field types. */
const ENTITY_TYPE_HINTS: Record<string, PersistedFieldType> = {
  player: 'position',
  character: 'position',
  hero: 'position',
  camera: 'position',
  coin: 'score',
  gem: 'score',
  collectible: 'score',
  pickup: 'inventory',
  item: 'inventory',
  weapon: 'inventory',
  key: 'inventory',
  health: 'health',
  heart: 'health',
  potion: 'health',
  checkpoint: 'level',
  door: 'level',
  portal: 'level',
  flag: 'level',
};

const COMPONENT_HINTS: Record<string, PersistedFieldType> = {
  Health: 'health',
  CharacterController: 'position',
  Collectible: 'score',
  Checkpoint: 'level',
  TriggerZone: 'level',
  DamageZone: 'health',
};

/**
 * Examine scene entities and infer what data should be persisted.
 * Pure function — no side effects, no AI calls.
 */
export function analyzeSaveNeeds(
  sceneGraph: SceneGraph,
  gameComponents?: Record<string, Array<{ type: string }>>,
): PersistedField[] {
  const fields: PersistedField[] = [];
  const seen = new Set<string>();

  function addField(path: string, type: PersistedFieldType) {
    const key = `${path}:${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    fields.push({ path, type });
  }

  for (const node of Object.values(sceneGraph.nodes) as SceneNode[]) {
    // Tokenize the ORIGINAL name (before lowercasing) so camelCase
    // splits like "PlayerHealth" → ["Player", "Health"] work correctly.
    // Then lowercase the tokens for case-insensitive keyword matching.
    const nameTokens = new Set(
      node.name.split(/(?<=[a-z])(?=[A-Z])|[_\s-]+|(?<=[a-zA-Z])(?=[0-9])|(?<=[0-9])(?=[a-zA-Z])/)
        .map((t) => t.toLowerCase()),
    );
    for (const [keyword, fieldType] of Object.entries(ENTITY_TYPE_HINTS)) {
      if (nameTokens.has(keyword)) {
        addField(`${node.name}.${fieldType}`, fieldType);
      }
    }

    // Check components list
    for (const comp of node.components) {
      const hint = COMPONENT_HINTS[comp];
      if (hint) {
        addField(`${node.name}.${hint}`, hint);
      }
    }

    // Check game components if provided
    const entityComps = gameComponents?.[node.entityId];
    if (entityComps) {
      for (const gc of entityComps) {
        const hint = COMPONENT_HINTS[gc.type] ?? COMPONENT_HINTS[capitalise(gc.type)];
        if (hint) {
          addField(`${node.name}.${hint}`, hint);
        }
      }
    }
  }

  return fields;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_FIELD_TYPES: ReadonlySet<string> = new Set<PersistedFieldType>([
  'position',
  'inventory',
  'score',
  'health',
  'level',
  'custom',
]);

const VALID_TRIGGER_TYPES: ReadonlySet<string> = new Set<CheckpointTrigger>([
  'zone_enter',
  'enemy_clear',
  'item_pickup',
  'manual',
]);

export function validateSaveSystemConfig(config: SaveSystemConfig): string[] {
  const errors: string[] = [];

  if (config.saveSlots < 1 || config.saveSlots > 20) {
    errors.push('saveSlots must be between 1 and 20');
  }
  if (config.autoSaveInterval < 0) {
    errors.push('autoSaveInterval must be non-negative');
  }
  for (const field of config.persistedData) {
    if (!VALID_FIELD_TYPES.has(field.type)) {
      errors.push(`Invalid field type: ${field.type}`);
    }
    if (!field.path || field.path.trim().length === 0) {
      errors.push('Persisted field path must not be empty');
    }
  }
  for (const trigger of config.checkpointTriggers) {
    if (!VALID_TRIGGER_TYPES.has(trigger)) {
      errors.push(`Invalid checkpoint trigger: ${trigger}`);
    }
  }

  return errors;
}

export function validateCheckpoint(cp: CheckpointConfig): string[] {
  const errors: string[] = [];
  if (!cp.id || cp.id.trim().length === 0) {
    errors.push('Checkpoint id must not be empty');
  }
  if (!cp.name || cp.name.trim().length === 0) {
    errors.push('Checkpoint name must not be empty');
  }
  if (!VALID_TRIGGER_TYPES.has(cp.trigger)) {
    errors.push(`Invalid checkpoint trigger: ${cp.trigger}`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Script Generation
// ---------------------------------------------------------------------------

/**
 * Generate a forge.* compatible script that implements localStorage-based
 * save/load with auto-save and checkpoint support.
 */
export function saveSystemToScript(system: SaveSystem): string {
  const { config, checkpoints } = system;
  const slotCount = config.saveSlots;
  const autoInterval = config.autoSaveInterval;
  const useCompression = config.compression;

  const fieldEntries = config.persistedData
    .map((f) => `  { path: ${JSON.stringify(f.path)}, type: ${JSON.stringify(f.type)} }`)
    .join(',\n');

  const cpEntries = checkpoints
    .map(
      (cp) =>
        `  { id: ${JSON.stringify(cp.id)}, name: ${JSON.stringify(cp.name)}, trigger: ${JSON.stringify(cp.trigger)}, position: { x: ${cp.position.x}, y: ${cp.position.y}, z: ${cp.position.z} } }`,
    )
    .join(',\n');

  return `// Auto-generated Save System
// Slots: ${slotCount} | Auto-save: ${autoInterval > 0 ? autoInterval + 's' : 'off'} | Compression: ${useCompression ? 'on' : 'off'}

const SAVE_KEY_PREFIX = 'forge_save_';
const SLOT_COUNT = ${slotCount};
const AUTO_SAVE_INTERVAL = ${autoInterval};
const CHECKPOINTS = [
${cpEntries}
];
const PERSISTED_FIELDS = [
${fieldEntries}
];

let autoSaveTimer = 0;
let currentSlot = 0;
let lastCheckpointId = null;

function gatherState() {
  const state = {};
  for (const field of PERSISTED_FIELDS) {
    switch (field.type) {
      case 'position': {
        // Extract entity name from path (e.g. "Player.position" → "Player")
        // and look it up by name — this is a global script, not per-entity
        const eName = field.path.split('.')[0];
        // findByName is a substring match — filter to exact name match
        const matches = forge.scene.findByName(eName)
          .filter(id => forge.scene.getEntityName(id) === eName);
        if (matches.length > 0) {
          const t = forge.getTransform(matches[0]);
          if (t) state[field.path] = t.position;
        }
        break;
      }
      case 'health': {
        const h = forge.state.get(field.path);
        state[field.path] = h ?? 100;
        break;
      }
      case 'score': {
        const s = forge.state.get(field.path);
        state[field.path] = s ?? 0;
        break;
      }
      case 'inventory': {
        const inv = forge.state.get(field.path);
        state[field.path] = inv ?? [];
        break;
      }
      case 'level': {
        state[field.path] = forge.state.get(field.path) ?? 1;
        break;
      }
      default: {
        state[field.path] = forge.state.get(field.path);
        break;
      }
    }
  }
  state._checkpoint = lastCheckpointId;
  state._timestamp = Date.now();
  return state;
}

function saveToSlot(slot) {
  const data = gatherState();
  const raw = JSON.stringify(data);
  ${useCompression ? "const payload = btoa(raw);" : "const payload = raw;"}
  localStorage.setItem(SAVE_KEY_PREFIX + slot, payload);
  forge.state.set('lastSaveSlot', slot);
  forge.state.set('lastSaveTime', data._timestamp);
}

function loadFromSlot(slot) {
  const stored = localStorage.getItem(SAVE_KEY_PREFIX + slot);
  if (!stored) return false;
  let data;
  try {
    ${useCompression ? "const raw = atob(stored);" : "const raw = stored;"}
    data = JSON.parse(raw);
  } catch { forge.warn('Corrupted save data in slot ' + slot); return false; }
  for (const field of PERSISTED_FIELDS) {
    if (data[field.path] !== undefined) {
      if (field.type === 'position' && Array.isArray(data[field.path])) {
        const eName = field.path.split('.')[0];
        const matches = forge.scene.findByName(eName)
          .filter(id => forge.scene.getEntityName(id) === eName);
        if (matches.length > 0) forge.setPosition(matches[0], data[field.path][0], data[field.path][1], data[field.path][2]);
      } else {
        forge.state.set(field.path, data[field.path]);
      }
    }
  }
  lastCheckpointId = data._checkpoint || null;
  return true;
}

function deleteSaveSlot(slot) {
  localStorage.removeItem(SAVE_KEY_PREFIX + slot);
}

function listSaves() {
  const saves = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const stored = localStorage.getItem(SAVE_KEY_PREFIX + i);
    if (stored) {
      try {
        ${useCompression ? "const raw = atob(stored);" : "const raw = stored;"}
        const data = JSON.parse(raw);
        saves.push({ slot: i, timestamp: data._timestamp, checkpoint: data._checkpoint });
      } catch { /* skip corrupted slot */ }
    }
  }
  return saves;
}

function onStart() {
  autoSaveTimer = 0;
  currentSlot = forge.state.get('lastSaveSlot') ?? 0;
}

function onUpdate(dt) {
  if (AUTO_SAVE_INTERVAL > 0) {
    autoSaveTimer += dt;
    if (autoSaveTimer >= AUTO_SAVE_INTERVAL) {
      autoSaveTimer = 0;
      saveToSlot(currentSlot);
    }
  }
}

// Expose save/load API via forge.state for other scripts
forge.state.set('save', saveToSlot);
forge.state.set('load', loadFromSlot);
forge.state.set('deleteSave', deleteSaveSlot);
forge.state.set('listSaves', listSaves);
`;
}

// ---------------------------------------------------------------------------
// Default UI specs
// ---------------------------------------------------------------------------

export function generateDefaultUISpecs(): SaveUISpec[] {
  return [
    {
      type: 'save_indicator',
      position: 'top-right',
      style: { opacity: '0.8', fontSize: '14px' },
    },
    {
      type: 'slot_picker',
      position: 'center',
      style: { background: 'rgba(0,0,0,0.7)', padding: '20px', borderRadius: '8px' },
    },
    {
      type: 'checkpoint_notification',
      position: 'top-center',
      style: { fontSize: '18px', color: '#4ade80' },
    },
  ];
}

// ---------------------------------------------------------------------------
// AI Prompt
// ---------------------------------------------------------------------------

export const SAVE_SYSTEM_PROMPT = `You are a game persistence architect. Given a description of a game and the entities/fields that need saving, design a save system with:

1. Save slot configuration (how many slots, auto-save interval)
2. Checkpoint placement (where checkpoints go, what triggers them)
3. What data to persist (positions, scores, health, inventory, etc.)

Output a JSON object with this structure:
{
  "config": {
    "saveSlots": number (1-20),
    "autoSaveInterval": number (seconds, 0 = disabled),
    "checkpointTriggers": string[] (from: zone_enter, enemy_clear, item_pickup, manual),
    "persistedData": [{ "path": string, "type": "position"|"inventory"|"score"|"health"|"level"|"custom" }],
    "compression": boolean
  },
  "checkpoints": [{ "id": string, "name": string, "trigger": "zone_enter"|"enemy_clear"|"item_pickup"|"manual", "position": { "x": number, "y": number, "z": number } }]
}

Keep the design practical and appropriate for the game type described.`;

// ---------------------------------------------------------------------------
// AI-powered generation (stub — callers provide their own AI backend)
// ---------------------------------------------------------------------------

export interface SaveSystemGeneratorOptions {
  description: string;
  fields: PersistedField[];
  /** Caller-provided function that sends a prompt to an AI and returns the response text. */
  aiComplete?: (prompt: string) => Promise<string>;
}

/**
 * Generate a full save system. If `aiComplete` is provided, the AI designs
 * the config and checkpoints. Otherwise falls back to sensible defaults.
 */
export async function generateSaveSystem(
  options: SaveSystemGeneratorOptions,
): Promise<SaveSystem> {
  const { description, fields, aiComplete } = options;

  let config: SaveSystemConfig;
  let checkpoints: CheckpointConfig[];

  if (aiComplete) {
    const userPrompt = `Game description: ${description}\n\nDetected fields:\n${fields.map((f) => `- ${f.path} (${f.type})`).join('\n')}\n\nDesign a save system.`;
    const raw = await aiComplete(`${SAVE_SYSTEM_PROMPT}\n\n${userPrompt}`);

    const parsed = parseAIResponse(raw);
    config = parsed.config;
    checkpoints = parsed.checkpoints;
  } else {
    config = buildDefaultConfig(fields);
    checkpoints = buildDefaultCheckpoints();
  }

  const system: SaveSystem = {
    config,
    checkpoints,
    script: '',
    uiComponents: generateDefaultUISpecs(),
  };

  system.script = saveSystemToScript(system);

  return system;
}

function parseAIResponse(raw: string): { config: SaveSystemConfig; checkpoints: CheckpointConfig[] } {
  // Extract JSON from the response (handle markdown code fences)
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) {
    throw new Error('Could not parse AI response as JSON');
  }

  const data = JSON.parse(jsonMatch[1]);

  const config: SaveSystemConfig = {
    saveSlots: Math.min(20, Math.max(1, Number.isFinite(Number(data.config?.saveSlots)) ? Number(data.config.saveSlots) : 3)),
    autoSaveInterval: Math.max(0, Number.isFinite(Number(data.config?.autoSaveInterval)) ? Number(data.config.autoSaveInterval) : 60),
    checkpointTriggers: Array.isArray(data.config?.checkpointTriggers)
      ? data.config.checkpointTriggers.filter((t: string) =>
          ['zone_enter', 'enemy_clear', 'item_pickup', 'manual'].includes(t),
        )
      : ['manual'],
    persistedData: Array.isArray(data.config?.persistedData)
      ? data.config.persistedData.map((f: Record<string, string>) => ({
          path: String(f.path ?? ''),
          type: VALID_FIELD_TYPES.has(f.type) ? f.type : 'custom',
        }))
      : [],
    compression: Boolean(data.config?.compression),
  };

  const checkpoints: CheckpointConfig[] = Array.isArray(data.checkpoints)
    ? data.checkpoints.map((cp: Record<string, unknown>, i: number) => ({
        id: String(cp.id ?? `checkpoint_${i}`),
        name: String(cp.name ?? `Checkpoint ${i + 1}`),
        trigger: VALID_TRIGGER_TYPES.has(String(cp.trigger)) ? (String(cp.trigger) as CheckpointTrigger) : 'manual',
        position: {
          x: Number((cp.position as Record<string, number>)?.x) || 0,
          y: Number((cp.position as Record<string, number>)?.y) || 0,
          z: Number((cp.position as Record<string, number>)?.z) || 0,
        },
      }))
    : [];

  return { config, checkpoints };
}

function buildDefaultConfig(fields: PersistedField[]): SaveSystemConfig {
  return {
    saveSlots: 3,
    autoSaveInterval: 60,
    checkpointTriggers: ['manual', 'zone_enter'],
    persistedData: fields,
    compression: false,
  };
}

function buildDefaultCheckpoints(): CheckpointConfig[] {
  return [
    {
      id: 'start',
      name: 'Starting Point',
      trigger: 'manual',
      position: { x: 0, y: 0, z: 0 },
    },
  ];
}
