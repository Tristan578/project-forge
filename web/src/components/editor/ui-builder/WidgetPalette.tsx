'use client';

import {
  Type,
  Image as ImageIcon,
  Square,
  BarChart3,
  LayoutGrid,
  Grid3X3,
  ScrollText,
  SlidersHorizontal,
  ToggleLeft,
  Map,
} from 'lucide-react';
import { useUIBuilderStore, type WidgetType } from '@/stores/uiBuilderStore';

const WIDGET_TYPES: { type: WidgetType; icon: typeof Type; label: string }[] = [
  { type: 'text', icon: Type, label: 'Text' },
  { type: 'image', icon: ImageIcon, label: 'Image' },
  { type: 'button', icon: Square, label: 'Button' },
  { type: 'progress_bar', icon: BarChart3, label: 'Progress' },
  { type: 'panel', icon: LayoutGrid, label: 'Panel' },
  { type: 'grid', icon: Grid3X3, label: 'Grid' },
  { type: 'scroll_view', icon: ScrollText, label: 'Scroll' },
  { type: 'slider', icon: SlidersHorizontal, label: 'Slider' },
  { type: 'toggle', icon: ToggleLeft, label: 'Toggle' },
  { type: 'minimap', icon: Map, label: 'Minimap' },
];

export function WidgetPalette() {
  const activeScreenId = useUIBuilderStore((s) => s.activeScreenId);
  const addWidget = useUIBuilderStore((s) => s.addWidget);

  const handleAddWidget = (type: WidgetType) => {
    if (!activeScreenId) return;
    addWidget(activeScreenId, type);
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {WIDGET_TYPES.map(({ type, icon: Icon, label }) => (
        <button
          key={type}
          onClick={() => handleAddWidget(type)}
          className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-400 hover:border-zinc-600 hover:bg-zinc-750 hover:text-zinc-300 transition-colors"
        >
          <Icon size={14} className="shrink-0" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
