'use client';

import { useEditorStore } from '@/stores/editorStore';

export function SceneTransitionOverlay() {
  const active = useEditorStore((s) => s.sceneTransition.active);
  const config = useEditorStore((s) => s.sceneTransition.config);

  if (!active || !config) return null;

  const { type, duration, color, direction, easing } = config;

  const typeClass = type === 'fade'
    ? 'scene-transition-fade'
    : type === 'wipe'
    ? `scene-transition-wipe scene-transition-wipe-${direction || 'left'}`
    : '';

  return (
    <div
      className={`scene-transition-overlay ${typeClass}`}
      style={{
        '--st-duration': `${duration}ms`,
        '--st-color': color,
        '--st-easing': easing,
      } as React.CSSProperties}
    />
  );
}
