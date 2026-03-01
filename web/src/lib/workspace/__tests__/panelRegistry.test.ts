import { describe, it, expect } from 'vitest';
import { PANEL_DEFINITIONS, UNCLOSABLE_PANELS } from '../panelRegistry';

describe('PANEL_DEFINITIONS', () => {
  it('should have consistent id and key', () => {
    for (const [key, def] of Object.entries(PANEL_DEFINITIONS)) {
      expect(def.id, `${key} id should match its key`).toBe(key);
    }
  });

  it('should have all required fields', () => {
    for (const [key, def] of Object.entries(PANEL_DEFINITIONS)) {
      expect(def.id, `${key} id`).toBeTruthy();
      expect(def.title, `${key} title`).toBeTruthy();
      expect(def.component, `${key} component`).toBeTruthy();
    }
  });

  it('should have known panel IDs', () => {
    const ids = Object.keys(PANEL_DEFINITIONS);
    expect(ids).toContain('scene-viewport');
    expect(ids).toContain('inspector');
    expect(ids).toContain('scene-hierarchy');
    expect(ids).toContain('asset-browser');
    expect(ids).toContain('script-editor');
  });

  it('should set minWidth/minHeight as positive numbers when provided', () => {
    for (const [key, def] of Object.entries(PANEL_DEFINITIONS)) {
      if (def.minWidth !== undefined) {
        expect(def.minWidth, `${key} minWidth`).toBeGreaterThan(0);
      }
      if (def.minHeight !== undefined) {
        expect(def.minHeight, `${key} minHeight`).toBeGreaterThan(0);
      }
    }
  });

  it('should only use valid renderer values', () => {
    for (const [key, def] of Object.entries(PANEL_DEFINITIONS)) {
      if (def.renderer !== undefined) {
        expect(['onlyWhenVisible', 'always'], `${key} renderer`).toContain(def.renderer);
      }
    }
  });

  it('scene-viewport should be unclosable with always renderer', () => {
    const viewport = PANEL_DEFINITIONS['scene-viewport'];
    expect(viewport.unclosable).toBe(true);
    expect(viewport.renderer).toBe('always');
  });
});

describe('UNCLOSABLE_PANELS', () => {
  it('should be a Set', () => {
    expect(UNCLOSABLE_PANELS).toBeInstanceOf(Set);
  });

  it('should contain scene-viewport', () => {
    expect(UNCLOSABLE_PANELS.has('scene-viewport')).toBe(true);
  });

  it('should match panels with unclosable=true', () => {
    const expected = Object.values(PANEL_DEFINITIONS)
      .filter(d => d.unclosable)
      .map(d => d.id);
    expect([...UNCLOSABLE_PANELS].sort()).toEqual(expected.sort());
  });

  it('should not contain panels without unclosable flag', () => {
    expect(UNCLOSABLE_PANELS.has('inspector')).toBe(false);
    expect(UNCLOSABLE_PANELS.has('script-editor')).toBe(false);
  });
});
