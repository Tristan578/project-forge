'use client';

import { useState } from 'react';
import { useUIBuilderStore, type UITheme } from '@/stores/uiBuilderStore';

const THEME_PRESETS: Record<string, UITheme> = {
  Dark: {
    primaryColor: '#3b82f6',
    secondaryColor: '#8b5cf6',
    backgroundColor: '#18181b',
    textColor: '#ffffff',
    fontFamily: 'system-ui',
    fontSize: 16,
    borderRadius: 4,
  },
  Light: {
    primaryColor: '#2563eb',
    secondaryColor: '#7c3aed',
    backgroundColor: '#ffffff',
    textColor: '#000000',
    fontFamily: 'system-ui',
    fontSize: 16,
    borderRadius: 4,
  },
  'Sci-Fi': {
    primaryColor: '#00ffff',
    secondaryColor: '#ff00ff',
    backgroundColor: '#0a0a0a',
    textColor: '#00ff00',
    fontFamily: 'monospace',
    fontSize: 14,
    borderRadius: 0,
  },
  Fantasy: {
    primaryColor: '#d97706',
    secondaryColor: '#a16207',
    backgroundColor: '#292524',
    textColor: '#fef3c7',
    fontFamily: 'serif',
    fontSize: 18,
    borderRadius: 8,
  },
  Retro: {
    primaryColor: '#ef4444',
    secondaryColor: '#f59e0b',
    backgroundColor: '#1c1917',
    textColor: '#fbbf24',
    fontFamily: 'monospace',
    fontSize: 16,
    borderRadius: 2,
  },
};

export function ThemeEditor() {
  const globalTheme = useUIBuilderStore((s) => s.globalTheme);
  const applyTheme = useUIBuilderStore((s) => s.applyTheme);
  const [showPresets, setShowPresets] = useState(false);

  const currentTheme = globalTheme || THEME_PRESETS.Dark;

  const handleChange = (field: keyof UITheme, value: string | number) => {
    applyTheme({ ...currentTheme, [field]: value });
  };

  const handlePresetSelect = (name: string) => {
    applyTheme(THEME_PRESETS[name]);
    setShowPresets(false);
  };

  return (
    <div className="space-y-3 text-xs">
      {/* Preset selector */}
      <div className="relative">
        <button
          onClick={() => setShowPresets(!showPresets)}
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-left text-zinc-300 hover:border-zinc-600 transition-colors"
        >
          Theme Presets
        </button>

        {showPresets && (
          <div className="absolute top-full left-0 right-0 z-10 mt-1 rounded border border-zinc-700 bg-zinc-800 shadow-lg">
            {Object.keys(THEME_PRESETS).map((name) => (
              <button
                key={name}
                onClick={() => handlePresetSelect(name)}
                className="w-full px-3 py-2 text-left text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 transition-colors"
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Color settings */}
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-zinc-500">Primary Color</span>
          <input
            type="color"
            value={currentTheme.primaryColor}
            onChange={(e) => handleChange('primaryColor', e.target.value)}
            className="mt-1 w-full h-8 rounded border border-zinc-700 bg-zinc-800"
          />
        </label>

        <label className="block">
          <span className="text-zinc-500">Secondary Color</span>
          <input
            type="color"
            value={currentTheme.secondaryColor}
            onChange={(e) => handleChange('secondaryColor', e.target.value)}
            className="mt-1 w-full h-8 rounded border border-zinc-700 bg-zinc-800"
          />
        </label>

        <label className="block">
          <span className="text-zinc-500">Background Color</span>
          <input
            type="color"
            value={currentTheme.backgroundColor}
            onChange={(e) => handleChange('backgroundColor', e.target.value)}
            className="mt-1 w-full h-8 rounded border border-zinc-700 bg-zinc-800"
          />
        </label>

        <label className="block">
          <span className="text-zinc-500">Text Color</span>
          <input
            type="color"
            value={currentTheme.textColor}
            onChange={(e) => handleChange('textColor', e.target.value)}
            className="mt-1 w-full h-8 rounded border border-zinc-700 bg-zinc-800"
          />
        </label>
      </div>

      {/* Font settings */}
      <label className="block">
        <span className="text-zinc-500">Font Family</span>
        <select
          value={currentTheme.fontFamily}
          onChange={(e) => handleChange('fontFamily', e.target.value)}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
        >
          <option value="system-ui">System UI</option>
          <option value="monospace">Monospace</option>
          <option value="serif">Serif</option>
          <option value="sans-serif">Sans-serif</option>
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-zinc-500">Font Size (px)</span>
          <input
            type="number"
            min="0"
            value={currentTheme.fontSize}
            onChange={(e) => handleChange('fontSize', parseFloat(e.target.value))}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
          />
        </label>

        <label className="block">
          <span className="text-zinc-500">Border Radius (px)</span>
          <input
            type="number"
            min="0"
            value={currentTheme.borderRadius}
            onChange={(e) => handleChange('borderRadius', parseFloat(e.target.value))}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
          />
        </label>
      </div>

      {/* Apply to all widgets button */}
      <button
        onClick={() => {
          // TODO: Implement applying theme to all widgets
          console.log('Apply theme to all widgets');
        }}
        className="w-full rounded border border-blue-700 bg-blue-900/20 px-3 py-2 text-xs text-blue-400 hover:bg-blue-900/40 transition-colors"
      >
        Apply to All Widgets
      </button>
    </div>
  );
}
