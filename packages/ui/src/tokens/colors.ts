export const THEME_NAMES = ['dark', 'light', 'ember', 'rust', 'ice', 'leaf', 'mech'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/** All semantic color tokens. Values are static hex strings (WCAG AA verified). */
export interface ThemeColorTokens {
  '--sf-bg-app': string;
  '--sf-bg-surface': string;
  '--sf-bg-elevated': string;
  '--sf-bg-overlay': string;
  '--sf-text': string;
  '--sf-text-secondary': string;
  '--sf-text-muted': string;
  '--sf-text-disabled': string;
  /** Structural/layout borders: cards, dividers, section separators */
  '--sf-border': string;
  /** Interactive/emphasized element borders: inputs, selects, checkboxes, switches, badges, avatars, button outlines */
  '--sf-border-strong': string;
  '--sf-accent': string;
  /** Button resting-CTA background (one step from --sf-accent); also the hover for inline accents */
  '--sf-accent-hover': string;
  /**
   * Button hover/pressed-CTA background. Chosen per theme so --sf-on-accent meets
   * WCAG AA (>=4.5:1) against BOTH --sf-accent-hover (resting CTA) and this value.
   * White-on-accent themes step darker; dark-on-accent themes step brighter — hover
   * always *increases* text contrast. See #8742.
   */
  '--sf-accent-active': string;
  '--sf-on-accent': string;
  '--sf-destructive': string;
  '--sf-success': string;
  '--sf-warning': string;
}

/** Non-color tokens that vary per theme */
export interface ThemeStructureTokens {
  '--sf-radius-sm': string;
  '--sf-radius-md': string;
  '--sf-radius-lg': string;
  '--sf-radius-xl': string;
  '--sf-radius-full': string;
  '--sf-border-width': string;
  '--sf-font-ui': string;
  '--sf-font-mono': string;
  '--sf-transition': string;
}

export type ThemeTokens = ThemeColorTokens & ThemeStructureTokens;
