import { useState, useEffect, useCallback, useMemo } from 'react';
import { THEME_NAMES, type ThemeName, THEME_DEFINITIONS } from '../tokens';
import { applyThemeTokens } from '../utils/applyThemeTokens';

const VALID_THEMES = new Set<string>(THEME_NAMES);
const STORAGE_KEY_THEME = 'sf-theme';
const STORAGE_KEY_EFFECTS = 'sf-effects';

function readTheme(): ThemeName {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(STORAGE_KEY_THEME);
  return VALID_THEMES.has(stored ?? '') ? (stored as ThemeName) : 'dark';
}

function readEffects(): boolean {
  if (typeof window === 'undefined') return true;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const stored = localStorage.getItem(STORAGE_KEY_EFFECTS);
  return stored !== 'off';
}

/**
 * Apply a built-in theme to the DOM via the single authoritative write path
 * (applyThemeTokens). Built-in themes are compile-time constants and do not
 * need runtime validation — they are passed as trusted TrustedTokenSource.
 */
function applyBuiltInTheme(theme: ThemeName) {
  document.documentElement.setAttribute('data-sf-theme', theme);
  applyThemeTokens({ tokens: THEME_DEFINITIONS[theme] });
}

export interface UseThemeOptions {
  projectTheme?: ThemeName | null;
}

export function useTheme(options?: UseThemeOptions) {
  const projectTheme = options?.projectTheme ?? null;

  const resolveTheme = useCallback((): ThemeName => {
    if (projectTheme && VALID_THEMES.has(projectTheme)) return projectTheme;
    return readTheme();
  }, [projectTheme]);

  const [theme, setThemeState] = useState<ThemeName>(resolveTheme);
  const [effectsEnabled, setEffectsEnabledState] = useState<boolean>(readEffects);

  useEffect(() => {
    setThemeState(resolveTheme());
  }, [resolveTheme]);

  useEffect(() => {
    applyBuiltInTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-sf-effects', effectsEnabled ? 'on' : 'off');
  }, [effectsEnabled]);

  const setTheme = useCallback((newTheme: ThemeName) => {
    if (!VALID_THEMES.has(newTheme)) return;
    localStorage.setItem(STORAGE_KEY_THEME, newTheme);
    setThemeState(newTheme);
  }, []);

  const setEffectsEnabled = useCallback((enabled: boolean) => {
    // Always persist the user's preference, even if reduced-motion overrides it at runtime
    localStorage.setItem(STORAGE_KEY_EFFECTS, enabled ? 'on' : 'off');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setEffectsEnabledState(reducedMotion ? false : enabled);
  }, []);

  return useMemo(() => ({
    theme,
    setTheme,
    effectsEnabled,
    setEffectsEnabled,
    themes: THEME_NAMES,
  }), [theme, setTheme, effectsEnabled, setEffectsEnabled]);
}
