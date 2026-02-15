'use client';

import { useCallback, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { useUIBuilderStore } from '@/stores/uiBuilderStore';
import { useEditorStore } from '@/stores/editorStore';
import { ScreenList } from './ui-builder/ScreenList';
import { WidgetPalette } from './ui-builder/WidgetPalette';
import { WidgetTree } from './ui-builder/WidgetTree';
import { WidgetPropertyPanel } from './ui-builder/WidgetPropertyPanel';
import { WidgetStyleEditor } from './ui-builder/WidgetStyleEditor';
import { ScreenSettingsPanel } from './ui-builder/ScreenSettingsPanel';

export function UIBuilderPanel() {
  const activeScreenId = useUIBuilderStore((s) => s.activeScreenId);
  const selectedWidgetId = useUIBuilderStore((s) => s.selectedWidgetId);
  const uiUndo = useUIBuilderStore((s) => s.uiUndo);
  const uiRedo = useUIBuilderStore((s) => s.uiRedo);
  const engineMode = useEditorStore((s) => s.engineMode);

  // Intercept Ctrl+Z/Ctrl+Y when UI tab is active
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Only intercept if we're in edit mode and a widget is selected
      if (engineMode !== 'edit') return;
      if (!activeScreenId) return;

      const isUndo = (e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey;
      const isRedo = (e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey));

      if (isUndo && selectedWidgetId) {
        e.preventDefault();
        e.stopPropagation();
        uiUndo();
      } else if (isRedo && selectedWidgetId) {
        e.preventDefault();
        e.stopPropagation();
        uiRedo();
      }
    },
    [engineMode, activeScreenId, selectedWidgetId, uiUndo, uiRedo]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  return (
    <div className="flex h-full flex-col bg-zinc-900 text-zinc-300 overflow-hidden">
      {/* Header: Screen selector + settings */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <div className="flex-1">
          <ScreenList />
        </div>
        <button
          className="rounded p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
          title="UI Settings"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {!activeScreenId ? (
          <div className="flex items-center justify-center h-32 text-zinc-600 text-sm">
            Select or create a screen to begin
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-3">
            {/* Widget Palette */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                Add Widget
              </h3>
              <WidgetPalette />
            </div>

            {/* Widget Tree */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                Widget Tree
              </h3>
              <WidgetTree />
            </div>

            {/* Widget Properties or Screen Settings */}
            {selectedWidgetId ? (
              <>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                    Widget Properties
                  </h3>
                  <WidgetPropertyPanel />
                </div>

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                    Widget Style
                  </h3>
                  <WidgetStyleEditor />
                </div>
              </>
            ) : (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  Screen Settings
                </h3>
                <ScreenSettingsPanel />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
