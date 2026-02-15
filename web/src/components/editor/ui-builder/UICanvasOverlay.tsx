'use client';

import { useUIBuilderStore } from '@/stores/uiBuilderStore';
import { UIPreviewRenderer } from './UIPreviewRenderer';

export function UICanvasOverlay() {
  const activeScreenId = useUIBuilderStore((s) => s.activeScreenId);
  const screens = useUIBuilderStore((s) => s.screens);
  const selectedWidgetId = useUIBuilderStore((s) => s.selectedWidgetId);
  const selectWidget = useUIBuilderStore((s) => s.selectWidget);
  const showGrid = useUIBuilderStore((s) => s.showGrid);

  const activeScreen = screens.find((s) => s.id === activeScreenId);

  if (!activeScreen) return null;

  const handleWidgetClick = (widgetId: string) => {
    selectWidget(widgetId);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* Grid overlay */}
      {showGrid && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)',
            backgroundSize: '5% 5%',
          }}
        />
      )}

      {/* Widget preview */}
      <div className="pointer-events-auto relative h-full w-full">
        <UIPreviewRenderer
          screen={activeScreen}
          selectedWidgetId={selectedWidgetId}
          onWidgetClick={handleWidgetClick}
          editorMode
        />
      </div>
    </div>
  );
}
