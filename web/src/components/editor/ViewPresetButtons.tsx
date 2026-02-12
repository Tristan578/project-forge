/**
 * Camera preset view buttons for quick viewport navigation.
 *
 * Provides buttons to switch between Top, Front, Right, and Perspective views.
 * Highlights the currently active preset.
 */

'use client';

import { ArrowUp, Box, Eye, Square } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';

interface PresetButtonProps {
  preset: 'top' | 'front' | 'right' | 'perspective';
  icon: React.ReactNode;
  label: string;
  shortcut: string;
  isActive: boolean;
  onClick: () => void;
}

function PresetButton({ icon, label, shortcut, isActive, onClick }: PresetButtonProps) {
  return (
    <button
      onClick={onClick}
      title={`${label} (${shortcut})`}
      className={`
        flex items-center justify-center w-8 h-8 rounded
        transition-colors duration-150
        ${isActive
          ? 'bg-blue-600 text-white'
          : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
        }
      `}
    >
      {icon}
    </button>
  );
}

export function ViewPresetButtons() {
  const currentPreset = useEditorStore((s) => s.currentCameraPreset);
  const setCameraPreset = useEditorStore((s) => s.setCameraPreset);

  return (
    <div className="flex items-center gap-1 p-1 bg-neutral-800 rounded">
      <PresetButton
        preset="top"
        icon={<ArrowUp className="w-4 h-4" />}
        label="Top View"
        shortcut="Numpad 7"
        isActive={currentPreset === 'top'}
        onClick={() => setCameraPreset('top')}
      />
      <PresetButton
        preset="front"
        icon={<Square className="w-4 h-4" />}
        label="Front View"
        shortcut="Numpad 1"
        isActive={currentPreset === 'front'}
        onClick={() => setCameraPreset('front')}
      />
      <PresetButton
        preset="right"
        icon={<Box className="w-4 h-4" />}
        label="Right View"
        shortcut="Numpad 3"
        isActive={currentPreset === 'right'}
        onClick={() => setCameraPreset('right')}
      />
      <PresetButton
        preset="perspective"
        icon={<Eye className="w-4 h-4" />}
        label="Perspective View"
        shortcut="Numpad 5"
        isActive={currentPreset === 'perspective'}
        onClick={() => setCameraPreset('perspective')}
      />
    </div>
  );
}
