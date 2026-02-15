'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { LayoutGrid, Check, Save, RotateCcw } from 'lucide-react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { LAYOUT_PRESETS, type LayoutPresetId } from '@/lib/workspace/presets';

export function LayoutMenu() {
  const [open, setOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const activePreset = useWorkspaceStore((s) => s.activePreset);
  const applyPreset = useWorkspaceStore((s) => s.applyPreset);
  const customPresets = useWorkspaceStore((s) => s.customPresets);
  const saveCustomPreset = useWorkspaceStore((s) => s.saveCustomPreset);
  const deleteCustomPreset = useWorkspaceStore((s) => s.deleteCustomPreset);
  const loadCustomPreset = useWorkspaceStore((s) => s.loadCustomPreset);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowSaveInput(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handlePreset = useCallback(
    (id: LayoutPresetId) => {
      applyPreset(id);
      setOpen(false);
    },
    [applyPreset]
  );

  const handleSave = useCallback(() => {
    if (saveName.trim()) {
      saveCustomPreset(saveName.trim());
      setSaveName('');
      setShowSaveInput(false);
    }
  }, [saveName, saveCustomPreset]);

  const handleCustomLoad = useCallback(
    (index: number) => {
      loadCustomPreset(index);
      setOpen(false);
    },
    [loadCustomPreset]
  );

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
        title="Layout presets"
      >
        <LayoutGrid size={13} />
        <span className="text-[10px]">Layout</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded border border-zinc-700 bg-zinc-900 py-1 shadow-xl text-xs">
          {/* Built-in presets */}
          <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Presets
          </div>
          {Object.values(LAYOUT_PRESETS).map((preset) => (
            <button
              key={preset.id}
              onClick={() => handlePreset(preset.id)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              {activePreset === preset.id && <Check size={12} className="text-blue-400" />}
              {activePreset !== preset.id && <span className="w-3" />}
              <div>
                <div>{preset.name}</div>
                <div className="text-[10px] text-zinc-500">{preset.description}</div>
              </div>
            </button>
          ))}

          {/* Custom presets */}
          {customPresets.length > 0 && (
            <>
              <div className="my-1 h-px bg-zinc-800" />
              <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Custom
              </div>
              {customPresets.map((preset, i) => (
                <div key={i} className="flex items-center gap-1 px-2 py-1.5 hover:bg-zinc-800">
                  <button
                    onClick={() => handleCustomLoad(i)}
                    className="flex-1 text-left text-zinc-300"
                  >
                    {preset.name}
                  </button>
                  <button
                    onClick={() => deleteCustomPreset(i)}
                    className="text-zinc-600 hover:text-red-400"
                    title="Delete preset"
                  >
                    <RotateCcw size={10} />
                  </button>
                </div>
              ))}
            </>
          )}

          {/* Save current */}
          <div className="my-1 h-px bg-zinc-800" />
          {showSaveInput ? (
            <div className="flex items-center gap-1 px-2 py-1">
              <input
                autoFocus
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder="Preset name..."
                className="flex-1 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 outline-none placeholder:text-zinc-600"
              />
              <button
                onClick={handleSave}
                className="text-blue-400 hover:text-blue-300"
                disabled={!saveName.trim()}
              >
                <Check size={12} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowSaveInput(true)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
            >
              <Save size={12} />
              Save Current Layout
            </button>
          )}

          {/* Reset */}
          <button
            onClick={() => handlePreset('default')}
            className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            <RotateCcw size={12} />
            Reset to Default
          </button>
        </div>
      )}
    </div>
  );
}
