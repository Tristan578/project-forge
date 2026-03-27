import { useState, useEffect, useCallback, useMemo } from 'react';
import { THEME_NAMES, type ThemeName, THEME_DEFINITIONS } from '../tokens';

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

function applyThemeToDOM(theme: ThemeName) {
  const tokens = THEME_DEFINITIONS[theme];
  const root = document.documentElement;
  root.setAttribute('data-sf-theme', theme);
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value);
  }
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
    applyThemeToDOM(theme);
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
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      localStorage.setItem(STORAGE_KEY_EFFECTS, 'off');
      setEffectsEnabledState(false);
      return;
    }
    localStorage.setItem(STORAGE_KEY_EFFECTS, enabled ? 'on' : 'off');
    setEffectsEnabledState(enabled);
  }, []);

  return useMemo(() => ({
    theme,
    setTheme,
    effectsEnabled,
    setEffectsEnabled,
    themes: THEME_NAMES,
  }), [theme, setTheme, effectsEnabled, setEffectsEnabled]);
}
