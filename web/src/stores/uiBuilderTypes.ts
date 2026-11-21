// ========== UI Builder Type Definitions ==========

export type WidgetType =
  | 'text'
  | 'image'
  | 'button'
  | 'progress_bar'
  | 'panel'
  | 'grid'
  | 'scroll_view'
  | 'slider'
  | 'toggle'
  | 'minimap';

export type WidgetAnchor =
  | 'top_left' | 'top_center' | 'top_right'
  | 'center_left' | 'center' | 'center_right'
  | 'bottom_left' | 'bottom_center' | 'bottom_right';

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

export interface DataBinding {
  stateKey: string;
  direction: 'read' | 'write' | 'read_write';
  transform: BindingTransform | null;
}

export type BindingTransform =
  | { type: 'format'; template: string }
  | { type: 'map'; entries: Array<{ from: unknown; to: string }> }
  | { type: 'clamp'; min: number; max: number }
  | { type: 'multiply'; factor: number }
  | { type: 'round'; decimals: number };

export interface TextWidgetConfig {
  content: string;
  binding: DataBinding | null;
}

export interface ImageWidgetConfig {
  assetId: string | null;
  src: string | null;
  fit: 'contain' | 'cover' | 'fill' | 'none';
  alt: string;
}

export type ButtonAction =
  | { type: 'show_screen'; screenId: string }
  | { type: 'hide_screen'; screenId: string }
  | { type: 'toggle_screen'; screenId: string }
  | { type: 'set_state'; key: string; value: unknown }
  | { type: 'call_function'; functionName: string }
  | { type: 'scene_reset' }
  | { type: 'none' };

export interface ButtonWidgetConfig {
  label: string;
  hoverStyle: Partial<WidgetStyle>;
  activeStyle: Partial<WidgetStyle>;
  action: ButtonAction;
}

export interface ProgressBarWidgetConfig {
  valueBinding: DataBinding;
  min: number;
  max: number;
  direction: 'horizontal' | 'vertical' | 'radial';
  fillColor: string;
  trackColor: string;
  showLabel: boolean;
  labelFormat: string;
}

export interface PanelWidgetConfig {
  layout: 'free' | 'vertical' | 'horizontal';
  gap: number;
  alignItems: 'start' | 'center' | 'end' | 'stretch';
}

export interface GridWidgetConfig {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  gap: number;
  itemBinding: DataBinding | null;
  cellTemplate: UIWidget | null;
}

export interface ScrollViewWidgetConfig {
  direction: 'vertical' | 'horizontal' | 'both';
  showScrollbar: boolean;
  scrollbarColor: string;
}

export interface SliderWidgetConfig {
  valueBinding: DataBinding;
  min: number;
  max: number;
  step: number;
  orientation: 'horizontal' | 'vertical';
  trackColor: string;
  thumbColor: string;
  fillColor: string;
}

export interface ToggleWidgetConfig {
  valueBinding: DataBinding;
  onLabel: string;
  offLabel: string;
  trackColorOn: string;
  trackColorOff: string;
  thumbColor: string;
}

export interface MinimapWidgetConfig {
  zoom: number;
  trackedEntityIds: string[];
  trackedEntityTags: string[];
  dotColor: string;
  dotSize: number;
  playerDotColor: string;
  backgroundColor: string;
  showBorder: boolean;
}

export interface UIWidgetBase {
  id: string;
  name: string;
  type: WidgetType;
  x: number;
  y: number;
  width: number;
  height: number;
  anchor: WidgetAnchor;
  style: WidgetStyle;
  visible: boolean;
  interactable: boolean;
  parentWidgetId: string | null;
  children: string[];
}

export type UIWidget = UIWidgetBase & (
  | { type: 'text'; config: TextWidgetConfig }
  | { type: 'image'; config: ImageWidgetConfig }
  | { type: 'button'; config: ButtonWidgetConfig }
  | { type: 'progress_bar'; config: ProgressBarWidgetConfig }
  | { type: 'panel'; config: PanelWidgetConfig }
  | { type: 'grid'; config: GridWidgetConfig }
  | { type: 'scroll_view'; config: ScrollViewWidgetConfig }
  | { type: 'slider'; config: SliderWidgetConfig }
  | { type: 'toggle'; config: ToggleWidgetConfig }
  | { type: 'minimap'; config: MinimapWidgetConfig }
);

export interface ScreenTransition {
  type: 'none' | 'fade' | 'slide_left' | 'slide_right' | 'slide_up' | 'slide_down' | 'scale';
  durationMs: number;
  easing: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out';
}

export interface UIScreen {
  id: string;
  name: string;
  widgets: UIWidget[];
  visible: boolean;
  showOnStart: boolean;
  showOnKey: string | null;
  transition: ScreenTransition;
  zIndex: number;
  backgroundColor: string;
  blockInput: boolean;
}

export interface UITheme {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize: number;
  borderRadius: number;
}

export interface GameUIData {
  version: 1;
  screens: UIScreen[];
  globalTheme: UITheme | null;
}

export type ScreenPreset = 'blank' | 'hud' | 'main_menu' | 'pause_menu' | 'game_over' | 'inventory' | 'dialog';

export type UIUndoAction =
  | { type: 'add_screen'; screen: UIScreen }
  | { type: 'delete_screen'; screen: UIScreen; index: number }
  | { type: 'update_screen'; screenId: string; before: Record<string, unknown>; after: Record<string, unknown> }
  | { type: 'add_widget'; screenId: string; widget: UIWidget }
  | { type: 'delete_widget'; screenId: string; widget: UIWidget; index: number }
  | { type: 'update_widget'; screenId: string; widgetId: string; before: Record<string, unknown>; after: Record<string, unknown> }
  | { type: 'move_widget'; screenId: string; widgetId: string; beforeX: number; beforeY: number; afterX: number; afterY: number }
  | { type: 'resize_widget'; screenId: string; widgetId: string; beforeW: number; beforeH: number; afterW: number; afterH: number };
