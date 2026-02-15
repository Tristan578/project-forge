'use client';

import { useUIBuilderStore } from '@/stores/uiBuilderStore';
import { UIPreviewRenderer } from './UIPreviewRenderer';

export function UIRuntimeRenderer() {
  const screens = useUIBuilderStore((s) => s.screens);

  // Only render visible screens in play mode
  const visibleScreens = screens.filter((s) => s.visible);

  if (visibleScreens.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {visibleScreens
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((screen) => (
          <div
            key={screen.id}
            className="absolute inset-0"
            style={{
              zIndex: screen.zIndex,
              pointerEvents: screen.blockInput ? 'auto' : 'none',
            }}
          >
            <UIPreviewRenderer screen={screen} editorMode={false} />
          </div>
        ))}
    </div>
  );
}
