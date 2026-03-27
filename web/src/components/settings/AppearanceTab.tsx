'use client';

import { useTheme, THEME_NAMES, type ThemeName } from '@spawnforge/ui';

export function AppearanceTab() {
  const { theme, setTheme, effectsEnabled, setEffectsEnabled } = useTheme();

  return (
    <div className="space-y-6 p-4">
      <div className="space-y-2">
        <label htmlFor="sf-theme-select" className="block text-sm font-medium text-zinc-200">
          Theme
        </label>
        <select
          id="sf-theme-select"
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemeName) /* cast is safe: select options are always THEME_NAMES values; setTheme also validates with VALID_THEMES internally */}
          className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {THEME_NAMES.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
        <p className="text-xs text-zinc-500">
          Changes the color scheme across the entire editor.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={effectsEnabled}
          onChange={(e) => setEffectsEnabled(e.target.checked)}
          id="sf-effects-toggle"
          className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
        />
        <label htmlFor="sf-effects-toggle" className="text-sm text-zinc-300">
          Ambient effects
        </label>
      </div>
      <p className="text-xs text-zinc-500">
        Theme-specific visual effects (particles, gradients). Automatically disabled when your system prefers reduced motion.
      </p>
    </div>
  );
}
