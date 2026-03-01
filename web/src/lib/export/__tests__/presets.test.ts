import { describe, it, expect } from 'vitest';
import { getPresetNames, getPreset, EXPORT_PRESETS } from '../presets';

describe('EXPORT_PRESETS', () => {
  it('should have all expected presets', () => {
    const names = Object.keys(EXPORT_PRESETS);
    expect(names).toContain('web-optimized');
    expect(names).toContain('self-contained');
    expect(names).toContain('itch-io');
    expect(names).toContain('newgrounds');
    expect(names).toContain('pwa-mobile');
    expect(names).toContain('embed');
    expect(names).toContain('debug');
  });

  it('should have valid format for each preset', () => {
    const validFormats = ['single-html', 'zip', 'pwa', 'embed'];
    for (const [key, preset] of Object.entries(EXPORT_PRESETS)) {
      expect(validFormats, `${key} format`).toContain(preset.format);
    }
  });

  it('should have loading screen config for each preset', () => {
    for (const [key, preset] of Object.entries(EXPORT_PRESETS)) {
      expect(preset.loadingScreen, `${key} loadingScreen`).toBeDefined();
      expect(preset.loadingScreen.backgroundColor, `${key} bg color`).toBeDefined();
      expect(preset.loadingScreen.progressBarColor, `${key} progress color`).toBeDefined();
    }
  });

  it('debug preset should include source maps and debug info', () => {
    expect(EXPORT_PRESETS['debug'].includeSourceMaps).toBe(true);
    expect(EXPORT_PRESETS['debug'].includeDebug).toBe(true);
  });

  it('production presets should not include source maps', () => {
    for (const key of ['web-optimized', 'self-contained', 'itch-io', 'embed']) {
      expect(EXPORT_PRESETS[key].includeSourceMaps, `${key}`).toBe(false);
      expect(EXPORT_PRESETS[key].includeDebug, `${key}`).toBe(false);
    }
  });
});

describe('getPresetNames', () => {
  it('should return all preset keys', () => {
    const names = getPresetNames();
    expect(names.length).toBe(Object.keys(EXPORT_PRESETS).length);
    expect(names).toContain('web-optimized');
    expect(names).toContain('debug');
  });
});

describe('getPreset', () => {
  it('should return a preset by name', () => {
    const preset = getPreset('itch-io');
    expect(preset).toBeDefined();
    expect(preset!.name).toBe('itch.io');
    expect(preset!.format).toBe('zip');
  });

  it('should return undefined for unknown preset', () => {
    expect(getPreset('nonexistent')).toBeUndefined();
  });
});
