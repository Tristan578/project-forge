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
  '--sf-border': string;
  '--sf-border-strong': string;
  '--sf-accent': string;
  '--sf-accent-hover': string;
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
