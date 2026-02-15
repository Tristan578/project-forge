/**
 * Widget Defaults
 *
 * Default configurations and styles for each widget type.
 */

import type { WidgetType, WidgetStyle } from '@/stores/uiBuilderStore';

export const DEFAULT_WIDGET_STYLE: WidgetStyle = {
  backgroundColor: null,
  borderWidth: 0,
  borderColor: '#333333',
  borderRadius: 0,
  padding: [0, 0, 0, 0],
  opacity: 1,
  overflow: 'visible',
  fontFamily: 'system-ui',
  fontSize: 16,
  fontWeight: 'normal',
  color: '#ffffff',
  textAlign: 'left',
  lineHeight: 1.2,
  textShadow: null,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
};

// For each widget type, return the default config object, default size, and style overrides
export function getWidgetDefaults(type: WidgetType): {
  config: Record<string, unknown>;
  width: number;
  height: number;
  style: Partial<WidgetStyle>;
} {
  switch (type) {
    case 'text':
      return {
        config: { content: 'Text', binding: null },
        width: 20,
        height: 5,
        style: { fontSize: 16, color: '#ffffff' },
      };

    case 'image':
      return {
        config: { assetId: null, src: null, fit: 'contain', alt: '' },
        width: 15,
        height: 15,
        style: {},
      };

    case 'button':
      return {
        config: {
          label: 'Button',
          hoverStyle: { opacity: 0.8 },
          activeStyle: { opacity: 0.6 },
          action: { type: 'none' },
        },
        width: 15,
        height: 5,
        style: {
          backgroundColor: '#3b82f6',
          borderRadius: 4,
          textAlign: 'center',
          color: '#ffffff',
        },
      };

    case 'progress_bar':
      return {
        config: {
          valueBinding: { stateKey: 'health', direction: 'read', transform: null },
          min: 0,
          max: 100,
          direction: 'horizontal',
          fillColor: '#22c55e',
          trackColor: '#374151',
          showLabel: false,
          labelFormat: '{percent}%',
        },
        width: 20,
        height: 3,
        style: {},
      };

    case 'panel':
      return {
        config: { layout: 'free', gap: 0, alignItems: 'start' },
        width: 30,
        height: 30,
        style: { backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 4 },
      };

    case 'grid':
      return {
        config: {
          columns: 4,
          rows: 4,
          cellWidth: 64,
          cellHeight: 64,
          gap: 8,
          itemBinding: null,
          cellTemplate: null,
        },
        width: 40,
        height: 40,
        style: { backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 4 },
      };

    case 'scroll_view':
      return {
        config: {
          direction: 'vertical',
          showScrollbar: true,
          scrollbarColor: '#666666',
        },
        width: 30,
        height: 40,
        style: { backgroundColor: 'rgba(0,0,0,0.3)', overflow: 'scroll' },
      };

    case 'slider':
      return {
        config: {
          valueBinding: { stateKey: 'value', direction: 'read_write', transform: null },
          min: 0,
          max: 100,
          step: 1,
          orientation: 'horizontal',
          trackColor: '#374151',
          thumbColor: '#3b82f6',
          fillColor: '#3b82f6',
        },
        width: 20,
        height: 3,
        style: {},
      };

    case 'toggle':
      return {
        config: {
          valueBinding: { stateKey: 'enabled', direction: 'read_write', transform: null },
          onLabel: 'ON',
          offLabel: 'OFF',
          trackColorOn: '#22c55e',
          trackColorOff: '#6b7280',
          thumbColor: '#ffffff',
        },
        width: 8,
        height: 4,
        style: {},
      };

    case 'minimap':
      return {
        config: {
          zoom: 1,
          trackedEntityIds: [],
          trackedEntityTags: [],
          dotColor: '#ef4444',
          dotSize: 4,
          playerDotColor: '#22c55e',
          backgroundColor: 'rgba(0,0,0,0.7)',
          showBorder: true,
        },
        width: 20,
        height: 20,
        style: { borderWidth: 1, borderColor: '#666666' },
      };

    default:
      return {
        config: {},
        width: 20,
        height: 20,
        style: {},
      };
  }
}
