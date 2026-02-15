import { describe, it, expect } from 'vitest';
import { getPreset, getPresetNames } from './presets';

describe('export presets', () => {
  it('should have at least 5 presets', () => {
    const names = getPresetNames();
    expect(names.length).toBeGreaterThanOrEqual(5);
  });

  it('should retrieve preset by name', () => {
    const preset = getPreset('web-optimized');
    expect(preset).toBeDefined();
    expect(preset?.name).toBe('Web Optimized');
    expect(preset?.format).toBe('zip');
  });

  it('should return undefined for unknown preset', () => {
    const preset = getPreset('non-existent-preset');
    expect(preset).toBeUndefined();
  });

  it('should have valid loading screen config for all presets', () => {
    const names = getPresetNames();
    names.forEach((name) => {
      const preset = getPreset(name);
      expect(preset).toBeDefined();
      expect(preset?.loadingScreen).toBeDefined();
      expect(preset?.loadingScreen.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(preset?.loadingScreen.progressBarColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(['bar', 'spinner', 'dots', 'none']).toContain(preset?.loadingScreen.progressStyle);
    });
  });

  it('should have itch-io preset with correct settings', () => {
    const preset = getPreset('itch-io');
    expect(preset?.format).toBe('zip');
    expect(preset?.compressTextures).toBe(true);
    expect(preset?.includeDebug).toBe(false);
  });

  it('should have debug preset with source maps', () => {
    const preset = getPreset('debug');
    expect(preset?.includeSourceMaps).toBe(true);
    expect(preset?.includeDebug).toBe(true);
  });
});
