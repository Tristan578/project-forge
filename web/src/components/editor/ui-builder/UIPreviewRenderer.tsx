'use client';

import type { UIScreen, UIWidget } from '@/stores/uiBuilderStore';

interface UIPreviewRendererProps {
  screen: UIScreen;
  selectedWidgetId?: string | null;
  onWidgetClick?: (widgetId: string) => void;
  editorMode?: boolean;
}

export function UIPreviewRenderer({
  screen,
  selectedWidgetId,
  onWidgetClick,
  editorMode = false,
}: UIPreviewRendererProps) {
  const renderWidget = (widget: UIWidget) => {
    const isSelected = editorMode && widget.id === selectedWidgetId;

    const style: React.CSSProperties = {
      position: 'absolute',
      left: `${widget.x}%`,
      top: `${widget.y}%`,
      width: `${widget.width}%`,
      height: `${widget.height}%`,
      backgroundColor: widget.style.backgroundColor || undefined,
      borderWidth: widget.style.borderWidth,
      borderColor: widget.style.borderColor,
      borderStyle: widget.style.borderWidth > 0 ? 'solid' : 'none',
      borderRadius: widget.style.borderRadius,
      padding: widget.style.padding.map((p) => `${p}px`).join(' '),
      opacity: widget.style.opacity,
      color: widget.style.color,
      fontSize: widget.style.fontSize,
      fontFamily: widget.style.fontFamily,
      fontWeight: widget.style.fontWeight,
      textAlign: widget.style.textAlign,
      lineHeight: widget.style.lineHeight,
      transform: `rotate(${widget.style.rotation}deg) scaleX(${widget.style.scaleX}) scaleY(${widget.style.scaleY})`,
      transformOrigin: 'top left',
      display: widget.visible ? 'block' : 'none',
      overflow: widget.style.overflow,
      pointerEvents: widget.interactable ? 'auto' : 'none',
      boxShadow: isSelected ? '0 0 0 2px #3b82f6' : undefined,
      outline: editorMode ? '1px dotted rgba(255,255,255,0.3)' : undefined,
    };

    const handleClick = (e: React.MouseEvent) => {
      if (editorMode && onWidgetClick) {
        e.stopPropagation();
        onWidgetClick(widget.id);
      }
    };

    let content: React.ReactNode = null;

    switch (widget.type) {
      case 'text':
        content = <div>{widget.config.content}</div>;
        break;

      case 'button':
        content = (
          <button className="w-full h-full flex items-center justify-center">
            {widget.config.label}
          </button>
        );
        break;

      case 'image':
        content = (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={widget.config.src || undefined}
            alt={widget.config.alt}
            style={{
              width: '100%',
              height: '100%',
              objectFit: widget.config.fit,
            }}
          />
        );
        break;

      case 'progress_bar':
        content = (
          <div className="relative w-full h-full">
            <div
              className="absolute inset-0 rounded"
              style={{ backgroundColor: widget.config.trackColor }}
            />
            <div
              className="absolute inset-0 rounded"
              style={{
                backgroundColor: widget.config.fillColor,
                width: widget.config.direction === 'horizontal' ? '50%' : '100%',
                height: widget.config.direction === 'vertical' ? '50%' : '100%',
              }}
            />
            {widget.config.showLabel && (
              <div className="absolute inset-0 flex items-center justify-center text-xs">
                50%
              </div>
            )}
          </div>
        );
        break;

      case 'panel':
        content = <div className="w-full h-full" />;
        break;

      case 'slider':
        content = (
          <div className="relative w-full h-full flex items-center">
            <div
              className="w-full h-1 rounded"
              style={{ backgroundColor: widget.config.trackColor }}
            />
            <div
              className="absolute w-4 h-4 rounded-full"
              style={{
                backgroundColor: widget.config.thumbColor,
                left: '50%',
                transform: 'translateX(-50%)',
              }}
            />
          </div>
        );
        break;

      case 'toggle':
        content = (
          <div className="flex items-center gap-2 h-full">
            <div
              className="w-12 h-6 rounded-full relative"
              style={{ backgroundColor: widget.config.trackColorOff }}
            >
              <div
                className="absolute w-5 h-5 rounded-full top-0.5 left-0.5"
                style={{ backgroundColor: widget.config.thumbColor }}
              />
            </div>
            <span className="text-xs">{widget.config.offLabel}</span>
          </div>
        );
        break;

      default:
        content = (
          <div className="flex items-center justify-center text-xs text-zinc-600">
            {widget.type}
          </div>
        );
    }

    return (
      <div
        key={widget.id}
        style={style}
        onClick={handleClick}
        className={editorMode ? 'cursor-pointer' : ''}
      >
        {content}
      </div>
    );
  };

  return (
    <div
      className="relative h-full w-full"
      style={{
        backgroundColor: screen.backgroundColor,
      }}
    >
      {screen.widgets.map((widget) => renderWidget(widget))}
    </div>
  );
}
