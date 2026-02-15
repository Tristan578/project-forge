'use client';

import { useUIBuilderStore } from '@/stores/uiBuilderStore';

export function ScreenSettingsPanel() {
  const activeScreenId = useUIBuilderStore((s) => s.activeScreenId);
  const screens = useUIBuilderStore((s) => s.screens);
  const updateScreen = useUIBuilderStore((s) => s.updateScreen);
  const renameScreen = useUIBuilderStore((s) => s.renameScreen);
  const deleteScreen = useUIBuilderStore((s) => s.deleteScreen);

  const activeScreen = screens.find((s) => s.id === activeScreenId);

  if (!activeScreen) return null;

  const handleChange = (field: string, value: unknown) => {
    updateScreen(activeScreen.id, { [field]: value });
  };

  const handleTransitionChange = (field: string, value: unknown) => {
    updateScreen(activeScreen.id, {
      transition: { ...activeScreen.transition, [field]: value },
    });
  };

  const handleDelete = () => {
    if (confirm(`Delete screen "${activeScreen.name}"?`)) {
      deleteScreen(activeScreen.id);
    }
  };

  return (
    <div className="space-y-3 text-xs">
      {/* Screen name */}
      <label className="block">
        <span className="text-zinc-500">Screen Name</span>
        <input
          type="text"
          value={activeScreen.name}
          onChange={(e) => renameScreen(activeScreen.id, e.target.value)}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
        />
      </label>

      {/* Visibility settings */}
      <div className="space-y-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={activeScreen.showOnStart}
            onChange={(e) => handleChange('showOnStart', e.target.checked)}
            className="rounded border-zinc-700 bg-zinc-800 text-blue-600"
          />
          <span className="text-zinc-400">Show on start</span>
        </label>

        <label className="block">
          <span className="text-zinc-500">Show on key</span>
          <input
            type="text"
            value={activeScreen.showOnKey || ''}
            onChange={(e) => handleChange('showOnKey', e.target.value || null)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
            placeholder="Escape, Tab, etc."
          />
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={activeScreen.blockInput}
            onChange={(e) => handleChange('blockInput', e.target.checked)}
            className="rounded border-zinc-700 bg-zinc-800 text-blue-600"
          />
          <span className="text-zinc-400">Block 3D input</span>
        </label>
      </div>

      {/* Background */}
      <label className="block">
        <span className="text-zinc-500">Background Color</span>
        <input
          type="text"
          value={activeScreen.backgroundColor}
          onChange={(e) => handleChange('backgroundColor', e.target.value)}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
          placeholder="transparent, #000, rgba(0,0,0,0.5)"
        />
      </label>

      {/* Z-index */}
      <label className="block">
        <span className="text-zinc-500">Z-Index</span>
        <input
          type="number"
          value={activeScreen.zIndex}
          onChange={(e) => handleChange('zIndex', parseInt(e.target.value, 10))}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
        />
      </label>

      {/* Transition */}
      <div className="space-y-2 border-t border-zinc-800 pt-3">
        <h4 className="text-zinc-500 font-semibold">Transition</h4>

        <label className="block">
          <span className="text-zinc-500">Type</span>
          <select
            value={activeScreen.transition.type}
            onChange={(e) => handleTransitionChange('type', e.target.value)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
          >
            <option value="none">None</option>
            <option value="fade">Fade</option>
            <option value="slide_left">Slide Left</option>
            <option value="slide_right">Slide Right</option>
            <option value="slide_up">Slide Up</option>
            <option value="slide_down">Slide Down</option>
            <option value="scale">Scale</option>
          </select>
        </label>

        <label className="block">
          <span className="text-zinc-500">Duration (ms)</span>
          <input
            type="number"
            min="0"
            step="50"
            value={activeScreen.transition.durationMs}
            onChange={(e) => handleTransitionChange('durationMs', parseInt(e.target.value, 10))}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
          />
        </label>

        <label className="block">
          <span className="text-zinc-500">Easing</span>
          <select
            value={activeScreen.transition.easing}
            onChange={(e) => handleTransitionChange('easing', e.target.value)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300"
          >
            <option value="linear">Linear</option>
            <option value="ease_in">Ease In</option>
            <option value="ease_out">Ease Out</option>
            <option value="ease_in_out">Ease In Out</option>
          </select>
        </label>
      </div>

      {/* Delete button */}
      <button
        onClick={handleDelete}
        className="w-full rounded border border-red-700 bg-red-900/20 px-3 py-2 text-xs text-red-400 hover:bg-red-900/40 transition-colors"
      >
        Delete Screen
      </button>
    </div>
  );
}
