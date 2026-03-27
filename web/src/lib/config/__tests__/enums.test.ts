import { describe, it, expect } from 'vitest';
import {
  AI_PANEL_CATEGORIES,
  AI_PANEL_CATEGORY_SET,
  GDD_SCOPES,
  GDD_SCOPE_SET,
  PIXEL_ART_PALETTE_IDS,
  type AIPanelCategory,
  type GddScope,
  type PixelArtPaletteId,
} from '../enums';

describe('AI_PANEL_CATEGORIES', () => {
  it('contains the four canonical categories', () => {
    expect([...AI_PANEL_CATEGORIES]).toEqual(['creation', 'polish', 'intelligence', 'tools']);
  });

  it('has no duplicates', () => {
    const cats = [...AI_PANEL_CATEGORIES];
    expect(cats.length).toBe(new Set(cats).size);
  });
});

describe('AI_PANEL_CATEGORY_SET', () => {
  it('contains all AI_PANEL_CATEGORIES members', () => {
    for (const cat of AI_PANEL_CATEGORIES) {
      expect(AI_PANEL_CATEGORY_SET.has(cat)).toBe(true);
    }
  });

  it('has the same size as AI_PANEL_CATEGORIES', () => {
    expect(AI_PANEL_CATEGORY_SET.size).toBe(AI_PANEL_CATEGORIES.length);
  });

  it('provides O(1) lookup for valid categories', () => {
    expect(AI_PANEL_CATEGORY_SET.has('creation')).toBe(true);
    expect(AI_PANEL_CATEGORY_SET.has('polish')).toBe(true);
    expect(AI_PANEL_CATEGORY_SET.has('intelligence')).toBe(true);
    expect(AI_PANEL_CATEGORY_SET.has('tools')).toBe(true);
  });

  it('rejects invalid categories', () => {
    expect(AI_PANEL_CATEGORY_SET.has('invalid-category')).toBe(false);
    expect(AI_PANEL_CATEGORY_SET.has('')).toBe(false);
  });

  it('type-checks AIPanelCategory correctly', () => {
    const valid: AIPanelCategory = 'creation';
    expect(AI_PANEL_CATEGORY_SET.has(valid)).toBe(true);
  });
});

describe('GDD_SCOPES', () => {
  it('contains small, medium, large', () => {
    expect([...GDD_SCOPES]).toEqual(['small', 'medium', 'large']);
  });

  it('has no duplicates', () => {
    const scopes = [...GDD_SCOPES];
    expect(scopes.length).toBe(new Set(scopes).size);
  });
});

describe('GDD_SCOPE_SET', () => {
  it('contains all GDD_SCOPES members', () => {
    for (const s of GDD_SCOPES) {
      expect(GDD_SCOPE_SET.has(s)).toBe(true);
    }
  });

  it('has the same size as GDD_SCOPES', () => {
    expect(GDD_SCOPE_SET.size).toBe(GDD_SCOPES.length);
  });

  it('rejects invalid scope strings', () => {
    expect(GDD_SCOPE_SET.has('tiny')).toBe(false);
    expect(GDD_SCOPE_SET.has('huge')).toBe(false);
    expect(GDD_SCOPE_SET.has('')).toBe(false);
  });

  it('type-checks GddScope correctly', () => {
    const valid: GddScope = 'medium';
    expect(GDD_SCOPE_SET.has(valid)).toBe(true);
  });
});

describe('PIXEL_ART_PALETTE_IDS', () => {
  it('contains the canonical palette ids', () => {
    const ids = [...PIXEL_ART_PALETTE_IDS];
    expect(ids).toContain('gameboy');
    expect(ids).toContain('nes');
    expect(ids).toContain('snes');
    expect(ids).toContain('cga');
    expect(ids).toContain('pico8');
    expect(ids).toContain('endesga32');
    expect(ids).toContain('lospec500');
  });

  it('has no duplicates', () => {
    const ids = [...PIXEL_ART_PALETTE_IDS];
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('type-checks PixelArtPaletteId correctly', () => {
    const valid: PixelArtPaletteId = 'pico8';
    expect(PIXEL_ART_PALETTE_IDS).toContain(valid);
  });
});
