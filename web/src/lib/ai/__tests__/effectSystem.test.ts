import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createEffect,
  isValidBinding,
  EFFECT_PRESETS,
  PRESET_KEYS,
  applyEffect,
  applyBinding,
  generateEffectBindings,
  loadBindings,
  saveBindings,
  type EffectBinding,
  type Effect,
  type GameEvent,
  type EffectType,
  type EventCategory,
  type CommandDispatcher,
} from '../effectSystem';

// ---------------------------------------------------------------------------
// createEffect
// ---------------------------------------------------------------------------

describe('createEffect', () => {
  it('creates an effect with given values', () => {
    const eff = createEffect('screen_shake', 0.5, 0.3);
    expect(eff.type).toBe('screen_shake');
    expect(eff.intensity).toBe(0.5);
    expect(eff.duration).toBe(0.3);
    expect(eff.config).toBeUndefined();
  });

  it('clamps intensity to 0 when negative', () => {
    const eff = createEffect('flash', -0.5, 0.1);
    expect(eff.intensity).toBe(0);
  });

  it('clamps intensity to 1 when above 1', () => {
    const eff = createEffect('flash', 2.5, 0.1);
    expect(eff.intensity).toBe(1);
  });

  it('clamps intensity at boundary values', () => {
    expect(createEffect('flash', 0, 0.1).intensity).toBe(0);
    expect(createEffect('flash', 1, 0.1).intensity).toBe(1);
  });

  it('clamps duration to 0 when negative', () => {
    const eff = createEffect('sound', 0.5, -1);
    expect(eff.duration).toBe(0);
  });

  it('attaches config when provided', () => {
    const eff = createEffect('particle_burst', 0.5, 0.3, { color: '#ff0000', count: 10 });
    expect(eff.config).toEqual({ color: '#ff0000', count: 10 });
  });

  it('does not attach config key when undefined', () => {
    const eff = createEffect('sound', 0.5, 0.1);
    expect('config' in eff).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidBinding
// ---------------------------------------------------------------------------

describe('isValidBinding', () => {
  const validBinding: EffectBinding = {
    event: { name: 'test', category: 'combat' },
    effects: [createEffect('flash', 0.5, 0.1)],
  };

  it('returns true for a valid binding', () => {
    expect(isValidBinding(validBinding)).toBe(true);
  });

  it('returns false for null/undefined', () => {
    expect(isValidBinding(null)).toBe(false);
    expect(isValidBinding(undefined)).toBe(false);
  });

  it('returns false when event is missing', () => {
    expect(isValidBinding({ effects: [] })).toBe(false);
  });

  it('returns false when event.name is empty', () => {
    expect(isValidBinding({ event: { name: '', category: 'combat' }, effects: [] })).toBe(false);
  });

  it('returns false for invalid category', () => {
    expect(isValidBinding({ event: { name: 'x', category: 'invalid' }, effects: [] })).toBe(false);
  });

  it('returns false when effects is not an array', () => {
    expect(isValidBinding({ event: { name: 'x', category: 'combat' }, effects: 'nope' })).toBe(false);
  });

  it('returns false when an effect is missing required fields', () => {
    expect(isValidBinding({
      event: { name: 'x', category: 'combat' },
      effects: [{ type: 'flash' }], // missing intensity + duration
    })).toBe(false);
  });

  it('accepts all valid categories', () => {
    const categories: EventCategory[] = ['combat', 'collection', 'movement', 'ui', 'environment'];
    for (const cat of categories) {
      expect(isValidBinding({ event: { name: 'x', category: cat }, effects: [] })).toBe(true);
    }
  });

  it('accepts binding with empty effects array', () => {
    expect(isValidBinding({ event: { name: 'x', category: 'ui' }, effects: [] })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EFFECT_PRESETS
// ---------------------------------------------------------------------------

describe('EFFECT_PRESETS', () => {
  it('has all 8 expected preset keys', () => {
    const expected = [
      'enemy_hit', 'coin_collected', 'player_jump', 'player_land',
      'level_complete', 'damage_taken', 'button_hover', 'button_press',
    ];
    expect(PRESET_KEYS).toEqual(expect.arrayContaining(expected));
    expect(PRESET_KEYS.length).toBe(8);
  });

  it('every preset is a valid binding', () => {
    for (const key of PRESET_KEYS) {
      expect(isValidBinding(EFFECT_PRESETS[key])).toBe(true);
    }
  });

  it('every preset has at least one effect', () => {
    for (const key of PRESET_KEYS) {
      expect(EFFECT_PRESETS[key].effects.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('all preset intensities are in [0, 1]', () => {
    for (const key of PRESET_KEYS) {
      for (const eff of EFFECT_PRESETS[key].effects) {
        expect(eff.intensity).toBeGreaterThanOrEqual(0);
        expect(eff.intensity).toBeLessThanOrEqual(1);
      }
    }
  });

  it('all preset durations are non-negative', () => {
    for (const key of PRESET_KEYS) {
      for (const eff of EFFECT_PRESETS[key].effects) {
        expect(eff.duration).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('enemy_hit includes screen_shake and sound effects', () => {
    const types = EFFECT_PRESETS.enemy_hit.effects.map((e) => e.type);
    expect(types).toContain('screen_shake');
    expect(types).toContain('sound');
  });

  it('level_complete includes slow_motion', () => {
    const types = EFFECT_PRESETS.level_complete.effects.map((e) => e.type);
    expect(types).toContain('slow_motion');
  });

  it('button_hover has subtle intensity (< 0.3)', () => {
    for (const eff of EFFECT_PRESETS.button_hover.effects) {
      expect(eff.intensity).toBeLessThanOrEqual(0.3);
    }
  });
});

// ---------------------------------------------------------------------------
// applyEffect
// ---------------------------------------------------------------------------

describe('applyEffect', () => {
  let dispatch: CommandDispatcher;

  beforeEach(() => {
    dispatch = vi.fn();
  });

  it('dispatches camera_shake for screen_shake effect', () => {
    applyEffect(createEffect('screen_shake', 0.5, 0.3), dispatch);
    expect(dispatch).toHaveBeenCalledWith('camera_shake', {
      intensity: 0.5,
      duration: 0.3,
    });
  });

  it('dispatches burst_particle for particle_burst effect', () => {
    applyEffect(createEffect('particle_burst', 0.6, 0.4, { color: '#ff0000', count: 15 }), dispatch);
    expect(dispatch).toHaveBeenCalledWith('burst_particle', {
      count: 15,
      color: '#ff0000',
      duration: 0.4,
    });
  });

  it('dispatches burst_particle with defaults when config is missing', () => {
    applyEffect(createEffect('particle_burst', 0.6, 0.4), dispatch);
    expect(dispatch).toHaveBeenCalledWith('burst_particle', {
      count: 10,
      color: '#ffffff',
      duration: 0.4,
    });
  });

  it('dispatches post_processing_flash for flash effect', () => {
    applyEffect(createEffect('flash', 0.4, 0.1), dispatch);
    expect(dispatch).toHaveBeenCalledWith('post_processing_flash', {
      intensity: 0.4,
      duration: 0.1,
    });
  });

  it('dispatches set_time_scale for slow_motion effect', () => {
    applyEffect(createEffect('slow_motion', 0.5, 0.5, { timeScale: 0.3 }), dispatch);
    expect(dispatch).toHaveBeenCalledWith('set_time_scale', {
      scale: 0.3,
      duration: 0.5,
    });
  });

  it('dispatches play_one_shot_audio for sound effect', () => {
    applyEffect(createEffect('sound', 0.7, 0.3, { sound: 'hit' }), dispatch);
    expect(dispatch).toHaveBeenCalledWith('play_one_shot_audio', {
      sound: 'hit',
      volume: 0.7,
    });
  });

  it('dispatches animate_scale_pop for scale_pop effect', () => {
    applyEffect(createEffect('scale_pop', 0.3, 0.15, { axis: 'y', squash: true }), dispatch);
    expect(dispatch).toHaveBeenCalledWith('animate_scale_pop', {
      intensity: 0.3,
      duration: 0.15,
      axis: 'y',
      squash: true,
    });
  });

  it('dispatches post_processing_color_flash for color_flash effect', () => {
    applyEffect(createEffect('color_flash', 0.6, 0.2, { color: '#ff0000' }), dispatch);
    expect(dispatch).toHaveBeenCalledWith('post_processing_color_flash', {
      color: '#ff0000',
      intensity: 0.6,
      duration: 0.2,
    });
  });

  it('handles all 7 effect types without throwing', () => {
    const types: EffectType[] = [
      'screen_shake', 'particle_burst', 'flash', 'slow_motion',
      'sound', 'scale_pop', 'color_flash',
    ];
    for (const t of types) {
      expect(() => applyEffect(createEffect(t, 0.5, 0.2), dispatch)).not.toThrow();
    }
    expect(dispatch).toHaveBeenCalledTimes(7);
  });
});

// ---------------------------------------------------------------------------
// applyBinding
// ---------------------------------------------------------------------------

describe('applyBinding', () => {
  it('dispatches all effects in a binding', () => {
    const dispatch = vi.fn();
    applyBinding(EFFECT_PRESETS.enemy_hit, dispatch);
    expect(dispatch).toHaveBeenCalledTimes(EFFECT_PRESETS.enemy_hit.effects.length);
  });

  it('does nothing for binding with no effects', () => {
    const dispatch = vi.fn();
    applyBinding({ event: { name: 'empty', category: 'ui' }, effects: [] }, dispatch);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// generateEffectBindings (with mock fetcher)
// ---------------------------------------------------------------------------

describe('generateEffectBindings', () => {
  it('returns validated bindings from AI response', async () => {
    const mockBindings: EffectBinding[] = [
      {
        event: { name: 'enemy_defeated', category: 'combat' },
        effects: [
          { type: 'screen_shake', intensity: 0.4, duration: 0.3 },
          { type: 'sound', intensity: 0.8, duration: 0.2, config: { sound: 'explosion' } },
        ],
      },
    ];
    const fetcher = vi.fn().mockResolvedValue(mockBindings);
    const result = await generateEffectBindings('A space shooter game', fetcher);
    expect(result).toHaveLength(1);
    expect(result[0].event.name).toBe('enemy_defeated');
    expect(fetcher).toHaveBeenCalledWith('A space shooter game');
  });

  it('filters out invalid bindings from AI response', async () => {
    const mockBindings = [
      { event: { name: 'valid', category: 'combat' }, effects: [] },
      { event: { name: '', category: 'combat' }, effects: [] }, // invalid: empty name
      { broken: true }, // invalid structure
    ];
    const fetcher = vi.fn().mockResolvedValue(mockBindings);
    const result = await generateEffectBindings('test', fetcher);
    expect(result).toHaveLength(1);
    expect(result[0].event.name).toBe('valid');
  });

  it('clamps out-of-range intensities from AI output', async () => {
    const mockBindings: EffectBinding[] = [
      {
        event: { name: 'big_boom', category: 'combat' },
        effects: [
          { type: 'screen_shake', intensity: 5.0, duration: 0.5 },
          { type: 'flash', intensity: -1.0, duration: 0.2 },
        ],
      },
    ];
    const fetcher = vi.fn().mockResolvedValue(mockBindings);
    const result = await generateEffectBindings('test', fetcher);
    expect(result[0].effects[0].intensity).toBe(1);
    expect(result[0].effects[1].intensity).toBe(0);
  });

  it('returns empty array when fetcher returns no results', async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    const result = await generateEffectBindings('empty game', fetcher);
    expect(result).toEqual([]);
  });

  it('propagates fetcher errors', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network failure'));
    await expect(generateEffectBindings('test', fetcher)).rejects.toThrow('network failure');
  });
});

// ---------------------------------------------------------------------------
// loadBindings / saveBindings (localStorage)
// ---------------------------------------------------------------------------

describe('loadBindings / saveBindings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns empty array when nothing stored', () => {
    expect(loadBindings()).toEqual([]);
  });

  it('round-trips valid bindings through localStorage', () => {
    const bindings: EffectBinding[] = [
      {
        event: { name: 'test_event', category: 'ui' },
        effects: [createEffect('flash', 0.5, 0.1)],
      },
    ];
    saveBindings(bindings);
    const loaded = loadBindings();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].event.name).toBe('test_event');
  });

  it('filters invalid entries on load', () => {
    localStorage.setItem('forge-effect-bindings', JSON.stringify([
      { event: { name: 'good', category: 'combat' }, effects: [] },
      { bad: true },
    ]));
    const loaded = loadBindings();
    expect(loaded).toHaveLength(1);
  });

  it('returns empty array for corrupted JSON', () => {
    localStorage.setItem('forge-effect-bindings', 'not-json');
    expect(loadBindings()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Type coverage
// ---------------------------------------------------------------------------

describe('type coverage', () => {
  it('GameEvent has required fields', () => {
    const evt: GameEvent = { name: 'test', category: 'combat' };
    expect(evt.name).toBe('test');
    expect(evt.category).toBe('combat');
  });

  it('Effect has required fields', () => {
    const eff: Effect = { type: 'flash', intensity: 0.5, duration: 0.1 };
    expect(eff.type).toBe('flash');
  });

  it('EffectBinding combines event and effects', () => {
    const binding: EffectBinding = {
      event: { name: 'x', category: 'environment' },
      effects: [createEffect('sound', 0.5, 0.1)],
    };
    expect(binding.effects).toHaveLength(1);
  });
});
