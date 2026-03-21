'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  useComplexityStore,
  COMPLEXITY_LABELS,
  COMPLEXITY_DESCRIPTIONS,
  type ComplexityLevel,
} from '@/stores/slices/complexitySlice';

const LEVELS: ComplexityLevel[] = ['beginner', 'intermediate', 'expert'];

const LEVEL_COLORS: Record<ComplexityLevel, string> = {
  beginner: 'text-green-400',
  intermediate: 'text-yellow-400',
  expert: 'text-blue-400',
};

const LEVEL_BADGE_COLORS: Record<ComplexityLevel, string> = {
  beginner: 'bg-green-900/40 border-green-800/60 text-green-300',
  intermediate: 'bg-yellow-900/40 border-yellow-800/60 text-yellow-300',
  expert: 'bg-blue-900/40 border-blue-800/60 text-blue-300',
};

const LEVEL_ACTIVE_BG: Record<ComplexityLevel, string> = {
  beginner: 'bg-green-900/20 border-green-800/50',
  intermediate: 'bg-yellow-900/20 border-yellow-800/50',
  expert: 'bg-blue-900/20 border-blue-800/50',
};

/** Features unlocked when moving from one level to the next. */
const UNLOCK_PREVIEW: Record<ComplexityLevel, string[]> = {
  beginner: [],
  intermediate: [
    'Physics & Joints',
    'Audio & Reverb Zones',
    'Scripting',
    'Animation',
    'Game Components',
    'Asset Panel',
    'Export',
  ],
  expert: [
    'Particles',
    'Terrain Editor',
    'CSG Boolean Ops',
    'Shader Editor',
    'Performance Profiler',
    'Edit Mode Inspector',
  ],
};

interface ComplexityToggleProps {
  /** If true, renders a compact inline badge suitable for the settings panel */
  compact?: boolean;
}

/**
 * ComplexityToggle — lets users switch between beginner / intermediate / expert UI modes.
 *
 * Design:
 * - Clicking the badge opens a dropdown showing all three levels.
 * - Each level shows its description and what features it unlocks.
 * - The current level is highlighted; switching animates the transition.
 * - Critical features are always available — complexity only hides advanced UI.
 */
export function ComplexityToggle({ compact = false }: ComplexityToggleProps) {
  const level = useComplexityStore((s) => s.level);
  const setLevel = useComplexityStore((s) => s.setLevel);
  const [open, setOpen] = useState(false);

  const handleSelect = (next: ComplexityLevel) => {
    setLevel(next);
    setOpen(false);
  };

  if (compact) {
    return (
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={`Complexity level: ${COMPLEXITY_LABELS[level]}. Click to change.`}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-medium transition-colors hover:opacity-80 ${LEVEL_BADGE_COLORS[level]}`}
        >
          {COMPLEXITY_LABELS[level]}
          <ChevronDown size={10} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
        {open && (
          <ComplexityDropdown
            currentLevel={level}
            onSelect={handleSelect}
            onClose={() => setOpen(false)}
            alignRight
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-zinc-300">Complexity Level</h3>
          <p className="mt-0.5 text-[10px] text-zinc-400">
            Controls which editor features are visible. Critical features are always available.
          </p>
        </div>
      </div>

      <div role="listbox" aria-label="Complexity level" className="space-y-1.5">
        {LEVELS.map((lvl) => {
          const isActive = level === lvl;
          const unlocks = UNLOCK_PREVIEW[lvl];
          return (
            <button
              key={lvl}
              role="option"
              aria-selected={isActive}
              onClick={() => handleSelect(lvl)}
              className={`w-full rounded border px-3 py-2 text-left transition-all duration-150 ${
                isActive
                  ? LEVEL_ACTIVE_BG[lvl]
                  : 'border-zinc-800 bg-zinc-800/30 hover:bg-zinc-800/60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold ${isActive ? LEVEL_COLORS[lvl] : 'text-zinc-300'}`}>
                  {COMPLEXITY_LABELS[lvl]}
                </span>
                {isActive && (
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${LEVEL_BADGE_COLORS[lvl]}`}>
                    Active
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[10px] text-zinc-400">{COMPLEXITY_DESCRIPTIONS[lvl]}</p>
              {unlocks.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {unlocks.map((feat) => (
                    <span key={feat} className="rounded bg-zinc-700/50 px-1.5 py-0.5 text-[9px] text-zinc-400">
                      {feat}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-zinc-400">
        Keyboard shortcuts and critical workflows (save, undo, play, AI chat) are always available regardless of level.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dropdown variant (used by compact mode)
// ---------------------------------------------------------------------------

interface DropdownProps {
  currentLevel: ComplexityLevel;
  onSelect: (level: ComplexityLevel) => void;
  onClose: () => void;
  alignRight?: boolean;
}

function ComplexityDropdown({ currentLevel, onSelect, onClose, alignRight }: DropdownProps) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* Menu */}
      <div
        role="listbox"
        aria-label="Select complexity level"
        className={`absolute top-full z-50 mt-1 w-64 rounded border border-zinc-700 bg-zinc-900 py-1 shadow-xl ${alignRight ? 'right-0' : 'left-0'}`}
      >
        {LEVELS.map((lvl) => {
          const isActive = currentLevel === lvl;
          return (
            <button
              key={lvl}
              role="option"
              aria-selected={isActive}
              onClick={() => onSelect(lvl)}
              className={`w-full px-3 py-2 text-left transition-colors hover:bg-zinc-800 ${isActive ? 'bg-zinc-800/50' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-medium ${isActive ? LEVEL_COLORS[lvl] : 'text-zinc-300'}`}>
                  {COMPLEXITY_LABELS[lvl]}
                </span>
                {isActive && (
                  <span className={`rounded border px-1.5 py-0.5 text-[9px] ${LEVEL_BADGE_COLORS[lvl]}`}>
                    Active
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[10px] text-zinc-400">{COMPLEXITY_DESCRIPTIONS[lvl]}</p>
            </button>
          );
        })}
      </div>
    </>
  );
}
