import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  PANEL_DEFINITIONS,
  UNCLOSABLE_PANELS,
  AI_PANELS_BY_CATEGORY,
  type AIPanelCategory,
} from '../panelRegistry';
import { AI_PANEL_CATEGORY_SET } from '@/lib/config/enums';

describe('PANEL_DEFINITIONS', () => {
  it('should have consistent id and key', () => {
    for (const [key, def] of Object.entries(PANEL_DEFINITIONS)) {
      expect(def.id, `${key} id should match its key`).toBe(key);
    }
  });

  it('should have all required fields', () => {
    for (const [key, def] of Object.entries(PANEL_DEFINITIONS)) {
      expect(def.id, `${key} id`).not.toBe('');
      expect(def.title, `${key} title`).not.toBe('');
      expect(def.component, `${key} component`).toBeDefined();
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
        const looksLikeNestedDefinition =
          !!value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          'id' in (value as Record<string, unknown>);
        const nestedId = looksLikeNestedDefinition
          ? String((value as Record<string, unknown>).id)
          : '';
        expect(
          looksLikeNestedDefinition,
          `Panel "${key}" has nested object at field "${field}" that looks like ` +
          `a panel definition (has "id" property). This is likely a missing closing "},". ` +
          `Nested id: "${nestedId}"`
        ).toBe(false);
      }
    }
  });

  it('every entry has only valid PanelDefinition fields (no unexpected keys)', () => {
    const validKeys = new Set(['id', 'title', 'component', 'minWidth', 'minHeight', 'unclosable', 'renderer', 'category']);
    for (const [key, def] of Object.entries(PANEL_DEFINITIONS)) {
      for (const field of Object.keys(def)) {
        expect(validKeys.has(field), `Panel "${key}" has unexpected field "${field}" — possible nesting bug`).toBe(true);
      }
    }
  });

  it('category field, when present, uses a valid AIPanelCategory value', () => {
    for (const [key, def] of Object.entries(PANEL_DEFINITIONS)) {
      if (def.category !== undefined) {
        expect(AI_PANEL_CATEGORY_SET.has(def.category), `Panel "${key}" has invalid category "${def.category}"`).toBe(true);
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

// ---------------------------------------------------------------------------
// Definition <-> component-registry parity
//
// Registering a panel is a TWO-part contract: a PANEL_DEFINITIONS entry here,
// and a matching key in WorkspaceProvider's PANEL_COMPONENTS map (the object
// handed to Dockview as `components={...}`). PanelsMenu enumerates every
// definition, so a panel with only half the contract is *offered* to the user
// and then cannot render — which is exactly how the `orchestrator` panel, and
// the whole Phase 2A game-creation pipeline behind it, sat unreachable.
//
// The map is a module-local const inside a component file that pulls in
// Dockview and every lazy panel, so this reads the source text rather than
// importing it. Any failure to locate or parse the map throws — an
// unverifiable contract is not a verified one.
// ---------------------------------------------------------------------------

function readPanelComponentKeys(): string[] {
  const file = resolve(__dirname, '../../../components/editor/WorkspaceProvider.tsx');
  const source = readFileSync(file, 'utf8');

  const block = /const PANEL_COMPONENTS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source);
  if (!block) {
    throw new Error(
      `Could not locate the PANEL_COMPONENTS object literal in ${file}. ` +
      `If it was renamed or moved, update this test — do not delete it.`
    );
  }

  const keys: string[] = [];
  for (const line of block[1].split('\n')) {
    const entry = /^\s*'?([A-Za-z0-9_-]+)'?\s*:/.exec(line);
    if (entry) keys.push(entry[1]);
  }
  if (keys.length === 0) {
    throw new Error(`Parsed zero keys out of PANEL_COMPONENTS in ${file} — parser is broken.`);
  }
  return keys;
}

describe('PANEL_DEFINITIONS <-> PANEL_COMPONENTS parity', () => {
  it('every defined panel has a component registered in WorkspaceProvider', () => {
    const registered = new Set(readPanelComponentKeys());
    const missing = Object.values(PANEL_DEFINITIONS)
      .filter((d) => !registered.has(d.component))
      .map((d) => `${d.id} (component: "${d.component}")`);

    expect(
      missing,
      'These panels are offered by PanelsMenu but have no entry in ' +
      "WorkspaceProvider's PANEL_COMPONENTS, so opening them renders nothing"
    ).toEqual([]);
  });

  it('every registered component is backed by a panel definition', () => {
    const defined = new Set(Object.values(PANEL_DEFINITIONS).map((d) => d.component));
    const orphans = readPanelComponentKeys().filter((k) => !defined.has(k));

    expect(
      orphans,
      'These components are registered with Dockview but no PANEL_DEFINITIONS ' +
      'entry can ever request them — dead code, or a definition was deleted'
    ).toEqual([]);
  });

  it('registers no duplicate component keys', () => {
    const keys = readPanelComponentKeys();
    const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(duplicates, 'Duplicate PANEL_COMPONENTS keys — the later one silently wins').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AI_PANELS_BY_CATEGORY
// ---------------------------------------------------------------------------

describe('AI_PANELS_BY_CATEGORY', () => {
  it('contains all four categories', () => {
    expect(Object.keys(AI_PANELS_BY_CATEGORY).sort()).toEqual(
      ['creation', 'intelligence', 'polish', 'tools'],
    );
  });

  it('every panel in the category lists has the matching category field', () => {
    for (const [cat, panels] of Object.entries(AI_PANELS_BY_CATEGORY) as [AIPanelCategory, typeof AI_PANELS_BY_CATEGORY[AIPanelCategory]][]) {
      for (const panel of panels) {
        expect(panel.category, `${panel.id} should have category ${cat}`).toBe(cat);
      }
    }
  });

  it('contains known AI panel IDs in correct categories', () => {
    const creationIds = AI_PANELS_BY_CATEGORY.creation.map((p) => p.id);
    expect(creationIds).toContain('behavior-tree');
    expect(creationIds).toContain('level-generator');
    expect(creationIds).toContain('narrative');
    expect(creationIds).toContain('auto-rigging');
    expect(creationIds).toContain('procedural-anim');

    const polishIds = AI_PANELS_BY_CATEGORY.polish.map((p) => p.id);
    expect(polishIds).toContain('art-style');
    expect(polishIds).toContain('tutorial');
    expect(polishIds).toContain('accessibility');
    expect(polishIds).toContain('save-system');
    expect(polishIds).toContain('texture-painter');

    const intelligenceIds = AI_PANELS_BY_CATEGORY.intelligence.map((p) => p.id);
    expect(intelligenceIds).toContain('review');
    expect(intelligenceIds).toContain('auto-iteration');
    expect(intelligenceIds).toContain('game-analytics');
    expect(intelligenceIds).toContain('playtest');
    expect(intelligenceIds).toContain('difficulty');
    expect(intelligenceIds).toContain('pacing-analyzer');
    expect(intelligenceIds).toContain('physics-feel');

    const toolsIds = AI_PANELS_BY_CATEGORY.tools.map((p) => p.id);
    expect(toolsIds).toContain('idea-generator');
    expect(toolsIds).toContain('design-teacher');
    expect(toolsIds).toContain('world-builder');
    expect(toolsIds).toContain('economy');
    expect(toolsIds).toContain('quest-generator');
  });

  it('non-AI panels are not included in any category list', () => {
    const nonAIPanelIds = ['scene-viewport', 'inspector', 'scene-hierarchy', 'script-editor', 'asset-browser'];
    for (const panels of Object.values(AI_PANELS_BY_CATEGORY)) {
      for (const panelId of nonAIPanelIds) {
        expect(panels.map((p) => p.id)).not.toContain(panelId);
      }
    }
  });

  it('each panel appears in exactly one category', () => {
    const allCategoryPanelIds = Object.values(AI_PANELS_BY_CATEGORY).flatMap((panels) =>
      panels.map((p) => p.id),
    );
    const duplicates = allCategoryPanelIds.filter((id, i) => allCategoryPanelIds.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
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
