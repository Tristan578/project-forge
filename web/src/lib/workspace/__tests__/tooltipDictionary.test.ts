import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { TOOLTIP_DICTIONARY } from '../tooltipDictionary';

/** `web/src` — the base every reported path is relative to. */
const SRC = join(__dirname, '..', '..', '..');

function collectTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsxFiles(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('TOOLTIP_DICTIONARY', () => {
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
   * `InfoTooltip` renders NOTHING when its `term` misses the dictionary — no
   * throw, no warning, no empty tooltip. A term that was never added is
   * therefore indistinguishable from a control that was deliberately given no
   * help text, which is how eighteen dead tooltips shipped across the game
   * camera and 2D physics inspectors: every `<InfoTooltip term="gameCamera…" />`
   * in `GameCameraInspector` resolved to null for the panel's whole life.
   *
   * Scope, stated honestly: this reads the literal `term="…"` form, which is
   * how every call site spells it today. A computed `term={someVar}` is invisible
   * to it. It is a tripwire for the mistake that actually happened, not a proof.
   */
  it('resolves every literal term= used in the app', () => {
    const offenders: string[] = [];
    for (const file of collectTsxFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bterm="([A-Za-z0-9_]+)"/g)) {
        const term = match[1];
        if (!(term in TOOLTIP_DICTIONARY)) {
          offenders.push(`${relative(SRC, file)}: term="${term}"`);
        }
      }
    }
    expect(offenders, `unresolved tooltip terms render nothing:\n${offenders.join('\n')}`).toEqual(
      []
    );
  });

  it('scans a non-trivial number of call sites', () => {
    // Fails closed: a broken path or an over-eager filter would make the scan
    // above pass vacuously against zero files.
    const files = collectTsxFiles(SRC);
    expect(files.length).toBeGreaterThan(50);
    const terms = files.flatMap((f) => [
      ...readFileSync(f, 'utf8').matchAll(/\bterm="([A-Za-z0-9_]+)"/g),
    ]);
    expect(terms.length).toBeGreaterThan(100);
  });

  it('tooltip values should be user-friendly (no raw code)', () => {
    for (const [key, value] of Object.entries(TOOLTIP_DICTIONARY)) {
      // Tooltips should not contain code-like constructs
      expect(value, `${key} should not contain code`).not.toMatch(/function\s*\(/);
      expect(value, `${key} should not contain code`).not.toMatch(/=>/);
    }
  });
});
