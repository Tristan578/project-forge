/**
 * Unified event-to-effect system ("juice" engine).
 *
 * Maps game events (enemy_hit, coin_collected, etc.) to satisfying
 * visual and audio feedback — screen shake, particle bursts, flashes,
 * slow-motion, sound cues, scale pops, and color flashes.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventCategory = 'combat' | 'collection' | 'movement' | 'ui' | 'environment';

export interface GameEvent {
  name: string;
  category: EventCategory;
}

export type EffectType =
  | 'screen_shake'
  | 'particle_burst'
  | 'flash'
  | 'slow_motion'
  | 'sound'
  | 'scale_pop'
  | 'color_flash';

export interface Effect {
  type: EffectType;
  /** 0-1 normalized intensity. Clamped on creation. */
  intensity: number;
  /** Duration in seconds. */
  duration: number;
  /** Optional extra configuration per effect type. */
  config?: Record<string, unknown>;
}

export interface EffectBinding {
  event: GameEvent;
  effects: Effect[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a number to the [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Create an Effect with intensity clamped to [0, 1]. */
export function createEffect(
  type: EffectType,
  intensity: number,
  duration: number,
  config?: Record<string, unknown>,
): Effect {
  const eff: Effect = {
    type,
    intensity: clamp(intensity, 0, 1),
    duration: Math.max(duration, 0),
  };
  if (config) eff.config = config;
  return eff;
}

/** Validate that an EffectBinding has the required structure. */
export function isValidBinding(binding: unknown): binding is EffectBinding {
  if (!binding || typeof binding !== 'object') return false;
  const b = binding as Record<string, unknown>;
  if (!b.event || typeof b.event !== 'object') return false;
  const evt = b.event as Record<string, unknown>;
  if (typeof evt.name !== 'string' || evt.name.length === 0) return false;
  const validCategories: EventCategory[] = ['combat', 'collection', 'movement', 'ui', 'environment'];
  if (!validCategories.includes(evt.category as EventCategory)) return false;
  if (!Array.isArray(b.effects)) return false;
  return (b.effects as unknown[]).every((e) => {
    if (!e || typeof e !== 'object') return false;
    const eff = e as Record<string, unknown>;
    return typeof eff.type === 'string' && typeof eff.intensity === 'number' && typeof eff.duration === 'number';
  });
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const EFFECT_PRESETS: Record<string, EffectBinding> = {
  enemy_hit: {
    event: { name: 'enemy_hit', category: 'combat' },
    effects: [
      createEffect('screen_shake', 0.3, 0.2),
      createEffect('particle_burst', 0.6, 0.4, { color: '#ff4444', count: 12 }),
      createEffect('sound', 0.7, 0.3, { sound: 'hit' }),
      createEffect('flash', 0.4, 0.1),
    ],
  },
  coin_collected: {
    event: { name: 'coin_collected', category: 'collection' },
    effects: [
      createEffect('scale_pop', 0.5, 0.2),
      createEffect('particle_burst', 0.4, 0.5, { color: '#ffdd44', count: 8, shape: 'sparkle' }),
      createEffect('sound', 0.6, 0.2, { sound: 'coin' }),
    ],
  },
  player_jump: {
    event: { name: 'player_jump', category: 'movement' },
    effects: [
      createEffect('scale_pop', 0.3, 0.15, { axis: 'y', squash: true }),
      createEffect('sound', 0.4, 0.15, { sound: 'whoosh' }),
    ],
  },
  player_land: {
    event: { name: 'player_land', category: 'movement' },
    effects: [
      createEffect('screen_shake', 0.1, 0.15),
      createEffect('particle_burst', 0.3, 0.3, { color: '#aaaaaa', count: 6, shape: 'dust' }),
      createEffect('sound', 0.5, 0.2, { sound: 'thud' }),
    ],
  },
  level_complete: {
    event: { name: 'level_complete', category: 'environment' },
    effects: [
      createEffect('slow_motion', 0.5, 0.5, { timeScale: 0.3 }),
      createEffect('particle_burst', 0.8, 1.0, { color: '#44ff88', count: 30, shape: 'confetti' }),
      createEffect('sound', 0.8, 1.0, { sound: 'fanfare' }),
    ],
  },
  damage_taken: {
    event: { name: 'damage_taken', category: 'combat' },
    effects: [
      createEffect('screen_shake', 0.5, 0.3),
      createEffect('color_flash', 0.6, 0.2, { color: '#ff0000' }),
      createEffect('sound', 0.7, 0.3, { sound: 'damage' }),
    ],
  },
  button_hover: {
    event: { name: 'button_hover', category: 'ui' },
    effects: [
      createEffect('scale_pop', 0.15, 0.1),
      createEffect('sound', 0.2, 0.05, { sound: 'click' }),
    ],
  },
  button_press: {
    event: { name: 'button_press', category: 'ui' },
    effects: [
      createEffect('scale_pop', 0.3, 0.12),
      createEffect('sound', 0.4, 0.08, { sound: 'confirm' }),
    ],
  },
};

/** All preset keys, useful for iteration. */
export const PRESET_KEYS = Object.keys(EFFECT_PRESETS) as (keyof typeof EFFECT_PRESETS)[];

// ---------------------------------------------------------------------------
// Command dispatcher interface
// ---------------------------------------------------------------------------

export type CommandDispatcher = (command: string, payload: unknown) => void;

// ---------------------------------------------------------------------------
// Apply a single effect via engine commands
// ---------------------------------------------------------------------------

/**
 * Execute one Effect by dispatching the appropriate engine commands.
 *
 * Each effect type maps to a concrete engine command (or set of commands)
 * already supported by the Bevy bridge.
 */
export function applyEffect(effect: Effect, dispatch: CommandDispatcher): void {
  switch (effect.type) {
    case 'screen_shake':
      dispatch('camera_shake', {
        intensity: effect.intensity,
        duration: effect.duration,
      });
      break;

    case 'particle_burst':
      dispatch('burst_particle', {
        count: (effect.config?.count as number) ?? 10,
        color: effect.config?.color ?? '#ffffff',
        duration: effect.duration,
      });
      break;

    case 'flash':
      dispatch('post_processing_flash', {
        intensity: effect.intensity,
        duration: effect.duration,
      });
      break;

    case 'slow_motion':
      dispatch('set_time_scale', {
        scale: (effect.config?.timeScale as number) ?? 0.5,
        duration: effect.duration,
      });
      break;

    case 'sound':
      dispatch('play_one_shot_audio', {
        sound: effect.config?.sound ?? 'default',
        volume: effect.intensity,
      });
      break;

    case 'scale_pop':
      dispatch('animate_scale_pop', {
        intensity: effect.intensity,
        duration: effect.duration,
        axis: effect.config?.axis ?? 'all',
        squash: effect.config?.squash ?? false,
      });
      break;

    case 'color_flash':
      dispatch('post_processing_color_flash', {
        color: (effect.config?.color as string) ?? '#ffffff',
        intensity: effect.intensity,
        duration: effect.duration,
      });
      break;
  }
}

/**
 * Apply all effects in a binding (fires them simultaneously).
 */
export function applyBinding(binding: EffectBinding, dispatch: CommandDispatcher): void {
  for (const effect of binding.effects) {
    applyEffect(effect, dispatch);
  }
}

// ---------------------------------------------------------------------------
// AI-powered binding generation
// ---------------------------------------------------------------------------

/**
 * Generate effect bindings from a game description using AI.
 *
 * Accepts a fetcher so callers can supply their own AI endpoint.
 * Defaults to the local `/api/ai/effects` route.
 */
export async function generateEffectBindings(
  gameDescription: string,
  fetcher: (description: string) => Promise<EffectBinding[]> = defaultFetcher,
): Promise<EffectBinding[]> {
  const raw = await fetcher(gameDescription);
  // Validate & clamp intensities from AI output
  return raw
    .filter(isValidBinding)
    .map((b) => ({
      ...b,
      effects: b.effects.map((e) => createEffect(e.type, e.intensity, e.duration, e.config)),
    }));
}

async function defaultFetcher(description: string): Promise<EffectBinding[]> {
  const res = await fetch('/api/ai/effects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  if (!res.ok) throw new Error(`AI effect generation failed: ${res.status}`);
  const data = (await res.json()) as { bindings: EffectBinding[] };
  return data.bindings ?? [];
}

// ---------------------------------------------------------------------------
// Custom binding management (localStorage persistence)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'forge-effect-bindings';

export function loadBindings(): EffectBinding[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    return parsed.filter(isValidBinding) as EffectBinding[];
  } catch {
    return [];
  }
}

export function saveBindings(bindings: EffectBinding[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Storage quota exceeded or unavailable — silently ignore
  }
}
