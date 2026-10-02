import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLTIP_DICTIONARY } from '../tooltipDictionary';

describe('TOOLTIP_DICTIONARY', () => {
  /**
   * `InfoTooltip` returns null for a term the dictionary lacks, so a panel can
   * reference a dozen terms and render no help at all with nothing failing.
   * `GameCameraInspector` did exactly that (review-board finding on #10295):
   * every one of its twelve `term="gameCamera…"` props was unknown. Scanning
   * the source rather than listing the terms here means a term added to the
   * panel without a definition fails on its own, with no test to remember.
   */
  it('defines every term GameCameraInspector references', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', '..', 'components', 'editor', 'GameCameraInspector.tsx'),
      'utf8',
    );
    const terms = [...source.matchAll(/\bterm="([^"]+)"/g)].map((m) => m[1]!);
    // Non-vacuous: the panel has a dozen (?) icons, so a scan that finds none
    // is a broken scan, not a panel with nothing to define.
    expect(terms.length).toBeGreaterThanOrEqual(10);

    const missing = [...new Set(terms)].filter((term) => !TOOLTIP_DICTIONARY[term]);
    expect(missing, 'terms the panel shows a (?) for that have no definition').toEqual([]);
  });

  /**
   * The first draft of this tooltip said a blank Target ID makes the camera
   * "follow whichever object is selected". Nothing does that: the engine
   * resolves a missing target to none and skips every follow arm
   * (`game_camera.rs`), `cameraModeNeedsTarget` lists five of six modes as
   * inert without one, and `cameraSetupExecutor` already warns "it will not
   * move". The inspector placeholder and the docs say the same thing now, and
   * this pins the tooltip's half (review-board round 4 on #10295).
   */
  it('does not promise that a blank camera target follows the selection', () => {
    const tooltip = TOOLTIP_DICTIONARY['gameCameraTarget']!;
    expect(tooltip).not.toMatch(/selected|selection/i);
    expect(tooltip).toMatch(/will not move/);
  });

  /**
   * One vocabulary across the guide, this tooltip and the inspector
   * placeholder: every mode but Fixed TRACKS its target, and "follow" is
   * reserved for the three modes that ease toward it and have Smoothing. The
   * target tooltip said "the object the camera follows" while the guide said
   * First Person and Orbital "do not follow" — both true under different
   * meanings, contradictory side by side (review-board ux finding on #10295).
   */
  it('describes the camera target as tracked, not followed', () => {
    const tooltip = TOOLTIP_DICTIONARY['gameCameraTarget']!;
    expect(tooltip).toMatch(/\btracks\b/);
    expect(tooltip).not.toMatch(/follow/i);
  });

  it('should be a non-empty record', () => {
    const keys = Object.keys(TOOLTIP_DICTIONARY);
    expect(keys.length).toBeGreaterThan(50);
  });

  it('should have non-empty string values', () => {
    for (const [key, value] of Object.entries(TOOLTIP_DICTIONARY)) {
      expect(typeof value, `${key} should be a string`).toBe('string');
      expect(value.length, `${key} should not be empty`).toBeGreaterThan(0);
    }
  });

  it('should include transform tooltips', () => {
    expect(TOOLTIP_DICTIONARY['position']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['rotation']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['scale']).toBeDefined();
  });

  it('should include material tooltips', () => {
    expect(TOOLTIP_DICTIONARY['metallic']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['roughness']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['baseColor']).toBeDefined();
  });

  it('should include physics tooltips', () => {
    expect(TOOLTIP_DICTIONARY['restitution']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['friction']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['bodyType']).toBeDefined();
  });

  it('should include audio tooltips', () => {
    expect(TOOLTIP_DICTIONARY['audioVolume']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['audioSpatial']).toBeDefined();
  });

  it('should include game component tooltips', () => {
    expect(TOOLTIP_DICTIONARY['characterController']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['health']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['collectible']).toBeDefined();
  });

  it('should include lighting tooltips', () => {
    expect(TOOLTIP_DICTIONARY['intensity']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['range']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['lightShadows']).toBeDefined();
  });

  /**
   * A tooltip is read in a hover, at the size of a hover. `gcJumpHeight` had
   * grown to a 43-word two-sentence paragraph explaining the 2D/3D divergence —
   * more text than the panel it annotates, which is where a reader stops reading
   * tooltips at all (PF-1228). The ceiling is deliberately loose: it exists to
   * catch the next paragraph, not to police wording. Longest entry today is 29
   * words, so a regrowth past 30 is a real change, not drift.
   */
  it('should keep every tooltip short enough to read in a hover', () => {
    const LIMIT = 30;
    const tooLong = Object.entries(TOOLTIP_DICTIONARY)
      .map(([key, value]) => [key, value.trim().split(/\s+/).length] as const)
      .filter(([, words]) => words > LIMIT);
    expect(
      tooLong,
      `tooltips over ${LIMIT} words — move the detail into the panel or the docs`,
    ).toEqual([]);
  });

  it('tooltip values should be user-friendly (no raw code)', () => {
    for (const [key, value] of Object.entries(TOOLTIP_DICTIONARY)) {
      // Tooltips should not contain code-like constructs
      expect(value, `${key} should not contain code`).not.toMatch(/function\s*\(/);
      expect(value, `${key} should not contain code`).not.toMatch(/=>/);
    }
  });
});
