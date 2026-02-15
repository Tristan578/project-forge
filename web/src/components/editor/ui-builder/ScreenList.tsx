'use client';

import { useState } from 'react';
import { Plus, ChevronDown } from 'lucide-react';
import { useUIBuilderStore, type ScreenPreset } from '@/stores/uiBuilderStore';

export function ScreenList() {
  const screens = useUIBuilderStore((s) => s.screens);
  const activeScreenId = useUIBuilderStore((s) => s.activeScreenId);
  const setActiveScreen = useUIBuilderStore((s) => s.setActiveScreen);
  const createScreen = useUIBuilderStore((s) => s.createScreen);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showPresetPicker, setShowPresetPicker] = useState(false);

  const activeScreen = screens.find((s) => s.id === activeScreenId);

  const handleCreateScreen = (preset?: ScreenPreset) => {
    const name = prompt('Screen name:', preset ? `${preset} screen` : 'New Screen');
    if (!name) return;
    const id = createScreen(name, preset);
    setActiveScreen(id);
    setShowPresetPicker(false);
  };

  const presets: { value: ScreenPreset; label: string }[] = [
    { value: 'blank', label: 'Blank' },
    { value: 'hud', label: 'HUD' },
    { value: 'main_menu', label: 'Main Menu' },
    { value: 'pause_menu', label: 'Pause Menu' },
    { value: 'game_over', label: 'Game Over' },
    { value: 'inventory', label: 'Inventory' },
    { value: 'dialog', label: 'Dialog' },
  ];

  return (
    <div className="relative flex gap-1">
      {/* Screen selector dropdown */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex-1 flex items-center justify-between gap-2 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-600 transition-colors"
      >
        <span className="truncate">
          {activeScreen ? activeScreen.name : 'No screen selected'}
        </span>
        <ChevronDown size={12} className="shrink-0" />
      </button>

      {showDropdown && (
        <div className="absolute top-full left-0 right-0 z-10 mt-1 max-h-60 overflow-y-auto rounded border border-zinc-700 bg-zinc-800 shadow-lg">
          {screens.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-600">No screens</div>
          ) : (
            screens.map((screen) => (
              <button
                key={screen.id}
                onClick={() => {
                  setActiveScreen(screen.id);
                  setShowDropdown(false);
                }}
                className={`w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-zinc-700 ${
                  screen.id === activeScreenId ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-400'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate">{screen.name}</span>
                  <span className="text-[10px] text-zinc-600">{screen.widgets.length} widgets</span>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* New screen button */}
      <button
        onClick={() => setShowPresetPicker(!showPresetPicker)}
        className="shrink-0 rounded border border-zinc-700 bg-zinc-800 p-1 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300 transition-colors"
        title="Create new screen"
      >
        <Plus size={14} />
      </button>

      {/* Preset picker dropdown */}
      {showPresetPicker && (
        <div className="absolute top-full right-0 z-10 mt-1 w-40 rounded border border-zinc-700 bg-zinc-800 shadow-lg">
          {presets.map((preset) => (
            <button
              key={preset.value}
              onClick={() => handleCreateScreen(preset.value)}
              className="w-full px-3 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
