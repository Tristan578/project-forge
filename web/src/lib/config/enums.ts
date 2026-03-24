/**
 * Centralized enum-like constant objects.
 *
 * These are NOT TypeScript enums (which are problematic for tree-shaking).
 * Instead they use `as const` objects with derived union types.
 */

// ---------------------------------------------------------------------------
// AI Panel Categories
// ---------------------------------------------------------------------------

/**
 * Categories for grouping AI panels in the AI Studio sidebar.
 * Source of truth for `AIPanelCategory` used by panelRegistry.
 */
export const AI_PANEL_CATEGORIES = ['creation', 'polish', 'intelligence', 'tools'] as const;
export type AIPanelCategory = (typeof AI_PANEL_CATEGORIES)[number];

/** Set for O(1) validation */
export const AI_PANEL_CATEGORY_SET = new Set<string>(AI_PANEL_CATEGORIES);

// ---------------------------------------------------------------------------
// GDD Scope
// ---------------------------------------------------------------------------

/**
 * Valid game design document scope levels.
 * Used by `gddGenerator.ts` for scope validation.
 */
export const GDD_SCOPES = ['small', 'medium', 'large'] as const;
export type GddScope = (typeof GDD_SCOPES)[number];

/** Set for O(1) validation */
export const GDD_SCOPE_SET = new Set<string>(GDD_SCOPES);

// ---------------------------------------------------------------------------
// Pixel Art Palettes (IDs only — full palette data stays in pixelArtHandlers)
// ---------------------------------------------------------------------------

/**
 * Valid palette IDs for pixel art generation.
 * The actual color arrays remain in the handler module; this array
 * is for validation in shared code.
 */
export const PIXEL_ART_PALETTE_IDS = [
  'gameboy',
  'nes',
  'snes',
  'cga',
  'pico8',
  'endesga32',
  'lospec500',
] as const;

export type PixelArtPaletteId = (typeof PIXEL_ART_PALETTE_IDS)[number];
