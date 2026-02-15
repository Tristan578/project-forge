'use client';

import { ChevronDown, ChevronRight, Trash2, Copy } from 'lucide-react';
import { useState } from 'react';
import { useUIBuilderStore } from '@/stores/uiBuilderStore';

export function WidgetTree() {
  const activeScreenId = useUIBuilderStore((s) => s.activeScreenId);
  const screens = useUIBuilderStore((s) => s.screens);
  const selectedWidgetId = useUIBuilderStore((s) => s.selectedWidgetId);
  const selectWidget = useUIBuilderStore((s) => s.selectWidget);
  const removeWidget = useUIBuilderStore((s) => s.removeWidget);
  const duplicateWidget = useUIBuilderStore((s) => s.duplicateWidget);
  const reorderWidget = useUIBuilderStore((s) => s.reorderWidget);

  const [expandedWidgets, setExpandedWidgets] = useState<Set<string>>(new Set());

  const activeScreen = screens.find((s) => s.id === activeScreenId);
  if (!activeScreen) return null;

  const toggleExpanded = (widgetId: string) => {
    const newExpanded = new Set(expandedWidgets);
    if (newExpanded.has(widgetId)) {
      newExpanded.delete(widgetId);
    } else {
      newExpanded.add(widgetId);
    }
    setExpandedWidgets(newExpanded);
  };

  const handleRemove = (widgetId: string) => {
    if (!activeScreenId) return;
    if (confirm('Delete this widget?')) {
      removeWidget(activeScreenId, widgetId);
    }
  };

  const handleDuplicate = (widgetId: string) => {
    if (!activeScreenId) return;
    duplicateWidget(activeScreenId, widgetId);
  };

  const handleMoveUp = (widgetId: string) => {
    if (!activeScreenId) return;
    reorderWidget(activeScreenId, widgetId, 'up');
  };

  const handleMoveDown = (widgetId: string) => {
    if (!activeScreenId) return;
    reorderWidget(activeScreenId, widgetId, 'down');
  };

  if (activeScreen.widgets.length === 0) {
    return (
      <div className="rounded border border-zinc-700 bg-zinc-800 px-3 py-4 text-center text-xs text-zinc-600">
        No widgets. Add one from the palette above.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {activeScreen.widgets.map((widget, index) => {
        const hasChildren = widget.children.length > 0;
        const isExpanded = expandedWidgets.has(widget.id);
        const isSelected = widget.id === selectedWidgetId;

        return (
          <div key={widget.id}>
            <div
              className={`group flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                isSelected
                  ? 'bg-blue-600/20 border border-blue-600/40 text-zinc-200'
                  : 'bg-zinc-800 border border-transparent hover:bg-zinc-750 text-zinc-400'
              }`}
            >
              {/* Expand/collapse button */}
              {hasChildren && (
                <button
                  onClick={() => toggleExpanded(widget.id)}
                  className="shrink-0 text-zinc-600 hover:text-zinc-400"
                >
                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              )}

              {/* Widget name */}
              <button
                onClick={() => selectWidget(widget.id)}
                className="flex-1 text-left truncate"
              >
                <span className="text-zinc-600 text-[10px]">{widget.type}</span>{' '}
                <span>{widget.name}</span>
              </button>

              {/* Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleMoveUp(widget.id)}
                  disabled={index === 0}
                  className="p-0.5 text-zinc-600 hover:text-zinc-400 disabled:opacity-30"
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  onClick={() => handleMoveDown(widget.id)}
                  disabled={index === activeScreen.widgets.length - 1}
                  className="p-0.5 text-zinc-600 hover:text-zinc-400 disabled:opacity-30"
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  onClick={() => handleDuplicate(widget.id)}
                  className="p-0.5 text-zinc-600 hover:text-zinc-400"
                  title="Duplicate"
                >
                  <Copy size={10} />
                </button>
                <button
                  onClick={() => handleRemove(widget.id)}
                  className="p-0.5 text-zinc-600 hover:text-red-400"
                  title="Delete"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>

            {/* Render children (if expanded) */}
            {hasChildren && isExpanded && (
              <div className="ml-4 space-y-1 border-l border-zinc-700 pl-2">
                {/* TODO: Render child widgets recursively */}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
