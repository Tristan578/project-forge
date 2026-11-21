export interface WidgetStyle {
  backgroundColor: string | null;
  borderWidth: number;
  borderColor: string;
  borderRadius: number;
  padding: [number, number, number, number];
  opacity: number;
  overflow: 'visible' | 'hidden' | 'scroll';
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  color: string;
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  textShadow: string | null;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface WidgetPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  anchor: string;
}

export function widgetStyleToCSS(style: WidgetStyle): React.CSSProperties {
  const css: React.CSSProperties = {};

  if (style.backgroundColor !== null) {
    css.backgroundColor = style.backgroundColor;
  }

  if (style.borderWidth > 0) {
    css.border = `${style.borderWidth}px solid ${style.borderColor}`;
  }

  if (style.borderRadius > 0) {
    css.borderRadius = `${style.borderRadius}px`;
  }

  if (style.padding) {
    css.padding = `${style.padding[0]}px ${style.padding[1]}px ${style.padding[2]}px ${style.padding[3]}px`;
  }

  css.opacity = style.opacity;
  css.overflow = style.overflow;
  css.fontFamily = style.fontFamily;
  css.fontSize = `${style.fontSize}px`;
  css.fontWeight = style.fontWeight;
  css.color = style.color;
  css.textAlign = style.textAlign;
  css.lineHeight = style.lineHeight;

  if (style.textShadow) {
    css.textShadow = style.textShadow;
  }

  const transforms: string[] = [];
  if (style.rotation !== 0) {
    transforms.push(`rotate(${style.rotation}deg)`);
  }
  if (style.scaleX !== 1 || style.scaleY !== 1) {
    transforms.push(`scale(${style.scaleX}, ${style.scaleY})`);
  }

  if (transforms.length > 0) {
    css.transform = transforms.join(' ');
  }

  return css;
}

export function widgetPositionCSS(widget: WidgetPosition): React.CSSProperties {
  const css: React.CSSProperties = {
    position: 'absolute',
    width: `${widget.width}%`,
    height: `${widget.height}%`,
  };

  const anchor = widget.anchor;
  const transforms: string[] = [];

  if (anchor === 'top_left') {
    css.left = `${widget.x}%`;
    css.top = `${widget.y}%`;
  } else if (anchor === 'top_center') {
    css.left = `${widget.x}%`;
    css.top = `${widget.y}%`;
    transforms.push('translateX(-50%)');
  } else if (anchor === 'top_right') {
    css.right = `${100 - widget.x}%`;
    css.top = `${widget.y}%`;
  } else if (anchor === 'center_left') {
    css.left = `${widget.x}%`;
    css.top = `${widget.y}%`;
    transforms.push('translateY(-50%)');
  } else if (anchor === 'center') {
    css.left = `${widget.x}%`;
    css.top = `${widget.y}%`;
    transforms.push('translate(-50%, -50%)');
  } else if (anchor === 'center_right') {
    css.right = `${100 - widget.x}%`;
    css.top = `${widget.y}%`;
    transforms.push('translateY(-50%)');
  } else if (anchor === 'bottom_left') {
    css.left = `${widget.x}%`;
    css.bottom = `${100 - widget.y}%`;
  } else if (anchor === 'bottom_center') {
    css.left = `${widget.x}%`;
    css.bottom = `${100 - widget.y}%`;
    transforms.push('translateX(-50%)');
  } else if (anchor === 'bottom_right') {
    css.right = `${100 - widget.x}%`;
    css.bottom = `${100 - widget.y}%`;
  }

  if (transforms.length > 0) {
    css.transform = transforms.join(' ');
  }

  return css;
}
