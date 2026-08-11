import { describe, it, expect } from 'vitest';
import { resolveInputPreset } from '../inputPresetResolution';

/**
 * The engine ships NO input bindings. `InputMap` derives `Default` (an empty
 * action map) and `capture_input` iterates `input_map.actions` with no fallback
 * to `default_bindings()`, which is reachable only through `set_input_preset`.
 * So the preset a generated game gets is not a nicety — it is the difference
 * between a player that moves and one that does not.
 *
 * Every expected value below is one of the four names `InputPreset::from_str`
 * accepts. An unknown string is rejected by the command handler outright, so a
 * fifth spelling here would be a silent no-op in production.
 */
describe('resolveInputPreset', () => {
  describe('3D', () => {
    // `fps` is the only preset binding `move_forward` — the action the engine's
    // 3D branch of `system_character_controller` maps onto -Z. A 3D player on
    // any other preset has no forward axis at all.
    it('maps the systemDecomposer walk+jump vocabulary to fps', () => {
      expect(resolveInputPreset('3d', 'walk+jump')).toBe('fps');
    });

    it('maps a bare walk to fps', () => {
      expect(resolveInputPreset('3d', 'walk')).toBe('fps');
    });

    it('falls back to fps when no movement type is given', () => {
      expect(resolveInputPreset('3d')).toBe('fps');
      expect(resolveInputPreset('3d', '')).toBe('fps');
    });

    it('falls back to fps for an unrecognized movement type', () => {
      expect(resolveInputPreset('3d', 'grappling swing')).toBe('fps');
    });

    // A 3D top-down camera is a real design (isometric ARPGs), and it needs the
    // two-axis preset rather than the forward/strafe one.
    it('honours a top-down movement type in 3D', () => {
      expect(resolveInputPreset('3d', 'top-down')).toBe('topdown');
    });
  });

  describe('2D', () => {
    // `platformer` binds `move_horizontal` and `jump` and deliberately binds NO
    // vertical axis. That is the correct behaviour, not an omission: a
    // side-scroller whose player could hold "up" to translate upward forever has
    // no level design left. Preset choice IS the vertical-walking gate — no
    // extra flag on the controller is needed.
    it('maps walk+jump to the platformer preset', () => {
      expect(resolveInputPreset('2d', 'walk+jump')).toBe('platformer');
    });

    it('maps side-scroller phrasing to the platformer preset', () => {
      expect(resolveInputPreset('2d', 'side-scroller')).toBe('platformer');
      expect(resolveInputPreset('2d', 'sidescroll')).toBe('platformer');
    });

    // `topdown` is the only preset binding BOTH `move_horizontal` and
    // `move_vertical`, and `move_vertical` is exactly what the 2D Y-mapping
    // consumes.
    it('maps top-down to the topdown preset', () => {
      expect(resolveInputPreset('2d', 'top-down')).toBe('topdown');
    });

    it('maps overhead and isometric phrasing to the topdown preset', () => {
      expect(resolveInputPreset('2d', 'overhead')).toBe('topdown');
      expect(resolveInputPreset('2d', 'isometric')).toBe('topdown');
    });

    it('maps twin-stick phrasing to the topdown preset', () => {
      expect(resolveInputPreset('2d', 'twin stick')).toBe('topdown');
      expect(resolveInputPreset('2d', 'twin-stick shooter')).toBe('topdown');
    });

    // Two working axes is the outcome that leaves the player controllable in the
    // widest range of designs, so an unrecognized 2D movement type takes
    // `topdown` rather than the single-axis `platformer`.
    it('falls back to topdown for an unrecognized movement type', () => {
      expect(resolveInputPreset('2d', 'auto-run')).toBe('topdown');
      expect(resolveInputPreset('2d', 'grappling swing')).toBe('topdown');
    });

    it('falls back to topdown when no movement type is given', () => {
      expect(resolveInputPreset('2d')).toBe('topdown');
      expect(resolveInputPreset('2d', '')).toBe('topdown');
    });
  });

  // Racing is its own control scheme (throttle/brake/steer), so it wins over the
  // project-type split in both dimensions.
  describe('vehicles', () => {
    it('maps the vehicle vocabulary to racing in both project types', () => {
      expect(resolveInputPreset('3d', 'vehicle')).toBe('racing');
      expect(resolveInputPreset('2d', 'vehicle')).toBe('racing');
    });

    it('maps looser driving phrasing to racing', () => {
      expect(resolveInputPreset('3d', 'kart racing')).toBe('racing');
      expect(resolveInputPreset('2d', 'top-down driving')).toBe('racing');
    });
  });

  // `movementType` is `GameSystem.type`, which `systemDecomposer` fills from a
  // keyword table but which is typed `z.string()` and ultimately LLM-authored.
  // Matching has to survive casing, spacing and punctuation the model chose, or
  // a perfectly reasonable phrase silently lands on the wrong bindings.
  describe('normalization', () => {
    it('ignores case, spaces, and punctuation', () => {
      expect(resolveInputPreset('2d', 'TOP_DOWN')).toBe('topdown');
      expect(resolveInputPreset('2d', 'Top Down')).toBe('topdown');
      expect(resolveInputPreset('2d', '  top—down  ')).toBe('topdown');
      expect(resolveInputPreset('3d', 'Vehicle / Racing')).toBe('racing');
    });

    it('never answers with a name the engine would reject', () => {
      const valid = new Set(['fps', 'platformer', 'topdown', 'racing']);
      const phrasings = [
        undefined, '', 'walk', 'walk+jump', 'top-down', 'auto-run', 'vehicle',
        'flight', 'swimming', 'grid movement', 'zelda-like', 'twin stick',
        'sidescroller', 'metroidvania', '???', '2', 'MOVEMENT',
      ];

      for (const projectType of ['2d', '3d'] as const) {
        for (const phrasing of phrasings) {
          expect(valid).toContain(resolveInputPreset(projectType, phrasing));
        }
      }
    });
  });
});
