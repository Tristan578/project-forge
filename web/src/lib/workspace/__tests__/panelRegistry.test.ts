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

  // ── Structural integrity (catches lesson-learned #32: nesting bugs) ───

  it('no entry contains nested objects that look like panel definitions', () => {
    for (const [key, def] of Object.entries(PANEL_DEFINITIONS)) {
      const rawDef = def as unknown as Record<string, unknown>;
      for (const [field, value] of Object.entries(rawDef)) {
        if (value && typeof value === 'object' && !Array.isArray(value) && 'id' in (value as Record<string, unknown>)) {
          throw new Error(
            `Panel "${key}" has nested object at field "${field}" that looks like ` +
            `a panel definition (has "id" property). This is likely a missing closing "},". ` +
            `Nested id: "${(value as Record<string, unknown>).id}"`
          );
        }
      }
    }
  });

  it('every entry has only valid PanelDefinition fields (no unexpected keys)', () => {
    const validKeys = new Set(['id', 'title', 'component', 'minWidth', 'minHeight', 'unclosable', 'renderer']);
    for (const [key, def] of Object.entries(PANEL_DEFINITIONS)) {
      for (const field of Object.keys(def)) {
        expect(validKeys.has(field), `Panel "${key}" has unexpected field "${field}" — possible nesting bug`).toBe(true);
      }
    }
  });

  it('component values are unique (no duplicate registrations)', () => {
    const components = Object.values(PANEL_DEFINITIONS).map((d) => d.component);
    const duplicates = components.filter((c, i) => components.indexOf(c) !== i);
    expect(duplicates, 'Duplicate component values').toEqual([]);
  });

  it('has at least 10 panels (sanity — detect accidental deletion)', () => {
    expect(Object.keys(PANEL_DEFINITIONS).length).toBeGreaterThanOrEqual(10);
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
