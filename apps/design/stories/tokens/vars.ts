/**
 * Scoped CSS variable names for token demo stories.
 * Single source of truth — use these in both style={{ [VAR]: value }}
 * and className arbitrary values like bg-[var(${VAR})].
 * TypeScript catches any typo at compile time.
 */
export const DEMO_FONT_FAMILY = '--demo-ff' as const;
export const DEMO_FONT_SIZE = '--demo-fs' as const;
export const DEMO_FONT_WEIGHT = '--demo-fw' as const;
export const DEMO_WIDTH = '--demo-w' as const;
export const DEMO_RADIUS = '--demo-r' as const;
export const DEMO_BG = '--demo-bg' as const;
