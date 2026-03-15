/**
 * Additional unit tests for uiBuilderStore focused on all 10 widget types.
 *
 * Tests verify that each widget type gets the correct default config, dimensions,
 * style overrides, and that type-specific config fields are populated correctly.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useUIBuilderStore,
  type UIWidget,
  type WidgetType,
} from '../uiBuilderStore';

describe('uiBuilderStore — all 10 widget type defaults', () => {
  let screenId: string;

  beforeEach(() => {
    useUIBuilderStore.setState({
      screens: [],
      activeScreenId: null,
      selectedWidgetId: null,
      hoveredWidgetId: null,
      copiedWidget: null,
      isUIEditorActive: false,
      previewMode: false,
      zoom: 1,
      showGrid: false,
      snapToGrid: false,
      gridSize: 5,
      globalTheme: null,
      undoStack: [],
      redoStack: [],
    });

    const { createScreen } = useUIBuilderStore.getState();
    screenId = createScreen('Test Screen');
  });

  function addAndGet(type: WidgetType): UIWidget {
    const { addWidget } = useUIBuilderStore.getState();
    const widgetId = addWidget(screenId, type);
    const screen = useUIBuilderStore.getState().screens.find(s => s.id === screenId);
    const widget = screen!.widgets.find(w => w.id === widgetId);
    return widget!;
  }

  describe('text widget', () => {
    it('creates text widget with content and null binding', () => {
      const widget = addAndGet('text');
      expect(widget.type).toBe('text');
      const config = widget.config as { content: string; binding: null };
      expect(config.content).toBe('Text');
      expect(config.binding).toBeNull();
    });

    it('text widget has correct default dimensions', () => {
      const widget = addAndGet('text');
      expect(widget.width).toBe(20);
      expect(widget.height).toBe(5);
    });
  });

  describe('image widget', () => {
    it('creates image widget with null assetId and contain fit', () => {
      const widget = addAndGet('image');
      expect(widget.type).toBe('image');
      const config = widget.config as { assetId: null; src: null; fit: string; alt: string };
      expect(config.assetId).toBeNull();
      expect(config.src).toBeNull();
      expect(config.fit).toBe('contain');
      expect(config.alt).toBe('');
    });

    it('image widget has square default dimensions', () => {
      const widget = addAndGet('image');
      expect(widget.width).toBe(15);
      expect(widget.height).toBe(15);
    });
  });

  describe('button widget', () => {
    it('creates button widget with default label and none action', () => {
      const widget = addAndGet('button');
      expect(widget.type).toBe('button');
      const config = widget.config as { label: string; action: { type: string } };
      expect(config.label).toBe('Button');
      expect(config.action.type).toBe('none');
    });

    it('button widget has hover and active style objects', () => {
      const widget = addAndGet('button');
      const config = widget.config as { hoverStyle: { opacity: number }; activeStyle: { opacity: number } };
      expect(config.hoverStyle).toEqual({ opacity: 0.8 });
      expect(config.activeStyle).toEqual({ opacity: 0.6 });
    });

    it('button widget has blue background and centered text style', () => {
      const widget = addAndGet('button');
      expect(widget.style.backgroundColor).toBe('#3b82f6');
      expect(widget.style.textAlign).toBe('center');
    });
  });

  describe('progress_bar widget', () => {
    it('creates progress_bar with health valueBinding', () => {
      const widget = addAndGet('progress_bar');
      expect(widget.type).toBe('progress_bar');
      const config = widget.config as {
        valueBinding: { stateKey: string; direction: string; transform: null };
        min: number; max: number; direction: string;
        fillColor: string; trackColor: string;
      };
      expect(config.valueBinding.stateKey).toBe('health');
      expect(config.valueBinding.direction).toBe('read');
      expect(config.min).toBe(0);
      expect(config.max).toBe(100);
      expect(config.direction).toBe('horizontal');
      expect(config.fillColor).toBe('#22c55e');
      expect(config.trackColor).toBe('#374151');
    });

    it('progress_bar widget has wide but short default dimensions', () => {
      const widget = addAndGet('progress_bar');
      expect(widget.width).toBe(20);
      expect(widget.height).toBe(3);
    });
  });

  describe('panel widget', () => {
    it('creates panel widget with free layout', () => {
      const widget = addAndGet('panel');
      expect(widget.type).toBe('panel');
      const config = widget.config as { layout: string; gap: number; alignItems: string };
      expect(config.layout).toBe('free');
      expect(config.gap).toBe(0);
      expect(config.alignItems).toBe('start');
    });

    it('panel widget has semi-transparent background style', () => {
      const widget = addAndGet('panel');
      expect(widget.style.backgroundColor).toBe('rgba(0,0,0,0.5)');
    });

    it('panel widget has square default dimensions', () => {
      const widget = addAndGet('panel');
      expect(widget.width).toBe(30);
      expect(widget.height).toBe(30);
    });
  });

  describe('grid widget', () => {
    it('creates grid widget with 4x4 cells', () => {
      const widget = addAndGet('grid');
      expect(widget.type).toBe('grid');
      const config = widget.config as {
        columns: number; rows: number; cellWidth: number; cellHeight: number;
        gap: number; itemBinding: null; cellTemplate: null;
      };
      expect(config.columns).toBe(4);
      expect(config.rows).toBe(4);
      expect(config.cellWidth).toBe(64);
      expect(config.cellHeight).toBe(64);
      expect(config.gap).toBe(8);
      expect(config.itemBinding).toBeNull();
      expect(config.cellTemplate).toBeNull();
    });

    it('grid widget has large default dimensions', () => {
      const widget = addAndGet('grid');
      expect(widget.width).toBe(40);
      expect(widget.height).toBe(40);
    });
  });

  describe('scroll_view widget', () => {
    it('creates scroll_view with vertical direction', () => {
      const widget = addAndGet('scroll_view');
      expect(widget.type).toBe('scroll_view');
      const config = widget.config as {
        direction: string; showScrollbar: boolean; scrollbarColor: string;
      };
      expect(config.direction).toBe('vertical');
      expect(config.showScrollbar).toBe(true);
      expect(config.scrollbarColor).toBe('#666666');
    });

    it('scroll_view widget has scroll overflow style', () => {
      const widget = addAndGet('scroll_view');
      expect(widget.style.overflow).toBe('scroll');
    });

    it('scroll_view widget has taller than wide default', () => {
      const widget = addAndGet('scroll_view');
      expect(widget.width).toBe(30);
      expect(widget.height).toBe(40);
    });
  });

  describe('slider widget', () => {
    it('creates slider widget with read_write binding', () => {
      const widget = addAndGet('slider');
      expect(widget.type).toBe('slider');
      const config = widget.config as {
        valueBinding: { stateKey: string; direction: string; transform: null };
        min: number; max: number; step: number; orientation: string;
        trackColor: string; thumbColor: string; fillColor: string;
      };
      expect(config.valueBinding.stateKey).toBe('value');
      expect(config.valueBinding.direction).toBe('read_write');
      expect(config.min).toBe(0);
      expect(config.max).toBe(100);
      expect(config.step).toBe(1);
      expect(config.orientation).toBe('horizontal');
      expect(config.thumbColor).toBe('#3b82f6');
    });

    it('slider widget has wide but short default dimensions', () => {
      const widget = addAndGet('slider');
      expect(widget.width).toBe(20);
      expect(widget.height).toBe(3);
    });
  });

  describe('toggle widget', () => {
    it('creates toggle widget with ON/OFF labels', () => {
      const widget = addAndGet('toggle');
      expect(widget.type).toBe('toggle');
      const config = widget.config as {
        valueBinding: { stateKey: string; direction: string };
        onLabel: string; offLabel: string;
        trackColorOn: string; trackColorOff: string; thumbColor: string;
      };
      expect(config.valueBinding.stateKey).toBe('enabled');
      expect(config.valueBinding.direction).toBe('read_write');
      expect(config.onLabel).toBe('ON');
      expect(config.offLabel).toBe('OFF');
      expect(config.trackColorOn).toBe('#22c55e');
      expect(config.trackColorOff).toBe('#6b7280');
      expect(config.thumbColor).toBe('#ffffff');
    });

    it('toggle widget has small default dimensions', () => {
      const widget = addAndGet('toggle');
      expect(widget.width).toBe(8);
      expect(widget.height).toBe(4);
    });
  });

  describe('minimap widget', () => {
    it('creates minimap widget with correct defaults', () => {
      const widget = addAndGet('minimap');
      expect(widget.type).toBe('minimap');
      const config = widget.config as {
        zoom: number;
        trackedEntityIds: string[];
        trackedEntityTags: string[];
        dotColor: string;
        dotSize: number;
        playerDotColor: string;
        backgroundColor: string;
        showBorder: boolean;
      };
      expect(config.zoom).toBe(1);
      expect(config.trackedEntityIds).toEqual([]);
      expect(config.trackedEntityTags).toEqual([]);
      expect(config.dotColor).toBe('#ef4444');
      expect(config.dotSize).toBe(4);
      expect(config.playerDotColor).toBe('#22c55e');
      expect(config.showBorder).toBe(true);
    });

    it('minimap widget has square default dimensions', () => {
      const widget = addAndGet('minimap');
      expect(widget.width).toBe(20);
      expect(widget.height).toBe(20);
    });

    it('minimap widget has border style', () => {
      const widget = addAndGet('minimap');
      expect(widget.style.borderWidth).toBe(1);
      expect(widget.style.borderColor).toBe('#666666');
    });
  });

  describe('common widget base properties', () => {
    it('all 10 widget types are created with visible=true', () => {
      const types: UIWidget['type'][] = [
        'text', 'image', 'button', 'progress_bar', 'panel',
        'grid', 'scroll_view', 'slider', 'toggle', 'minimap',
      ];

      for (const type of types) {
        const widget = addAndGet(type);
        expect(widget.visible).toBe(true);
        expect(widget.interactable).toBe(true);
        expect(widget.parentWidgetId).toBeNull();
        expect(widget.children).toEqual([]);
        expect(widget.anchor).toBe('top_left');
      }
    });

    it('all 10 widget types use default position (50, 50) when no position is provided', () => {
      const types: UIWidget['type'][] = [
        'text', 'image', 'button', 'progress_bar', 'panel',
        'grid', 'scroll_view', 'slider', 'toggle', 'minimap',
      ];

      for (const type of types) {
        const widget = addAndGet(type);
        expect(widget.x).toBe(50);
        expect(widget.y).toBe(50);
      }
    });

    it('widget name is auto-generated from type', () => {
      const widget = addAndGet('minimap');
      expect(widget.name).toMatch(/^minimap_/);
    });

    it('selectedWidgetId is set to the newly added widget after addWidget', () => {
      const { addWidget } = useUIBuilderStore.getState();
      const widgetId = addWidget(screenId, 'text');
      expect(useUIBuilderStore.getState().selectedWidgetId).toBe(widgetId);
    });
  });

  describe('widget config updates', () => {
    it('can update minimap trackedEntityIds', () => {
      const { addWidget, updateWidget } = useUIBuilderStore.getState();
      const widgetId = addWidget(screenId, 'minimap');

      updateWidget(screenId, widgetId, {
        config: {
          zoom: 2,
          trackedEntityIds: ['enemy_1', 'enemy_2'],
          trackedEntityTags: ['enemy'],
          dotColor: '#ef4444',
          dotSize: 6,
          playerDotColor: '#22c55e',
          backgroundColor: 'rgba(0,0,0,0.7)',
          showBorder: false,
        },
      } as Partial<UIWidget>);

      const widget = useUIBuilderStore.getState().screens
        .find(s => s.id === screenId)!.widgets
        .find(w => w.id === widgetId)!;

      const config = widget.config as { trackedEntityIds: string[]; showBorder: boolean; zoom: number };
      expect(config.trackedEntityIds).toEqual(['enemy_1', 'enemy_2']);
      expect(config.showBorder).toBe(false);
      expect(config.zoom).toBe(2);
    });

    it('can update grid columns and rows', () => {
      const { addWidget, updateWidget } = useUIBuilderStore.getState();
      const widgetId = addWidget(screenId, 'grid');

      updateWidget(screenId, widgetId, {
        config: {
          columns: 6,
          rows: 3,
          cellWidth: 48,
          cellHeight: 48,
          gap: 4,
          itemBinding: null,
          cellTemplate: null,
        },
      } as Partial<UIWidget>);

      const widget = useUIBuilderStore.getState().screens
        .find(s => s.id === screenId)!.widgets
        .find(w => w.id === widgetId)!;

      const config = widget.config as { columns: number; rows: number };
      expect(config.columns).toBe(6);
      expect(config.rows).toBe(3);
    });

    it('can update progress_bar min and max', () => {
      const { addWidget, updateWidget } = useUIBuilderStore.getState();
      const widgetId = addWidget(screenId, 'progress_bar');

      updateWidget(screenId, widgetId, {
        config: {
          valueBinding: { stateKey: 'mana', direction: 'read', transform: null },
          min: 0,
          max: 200,
          direction: 'radial',
          fillColor: '#3b82f6',
          trackColor: '#1e3a5f',
          showLabel: true,
          labelFormat: '{value}/{max}',
        },
      } as Partial<UIWidget>);

      const widget = useUIBuilderStore.getState().screens
        .find(s => s.id === screenId)!.widgets
        .find(w => w.id === widgetId)!;

      const config = widget.config as { min: number; max: number; direction: string };
      expect(config.min).toBe(0);
      expect(config.max).toBe(200);
      expect(config.direction).toBe('radial');
    });
  });

  describe('screen preset widgets', () => {
    it('hud preset creates progress_bar and text widgets', () => {
      const { createScreen } = useUIBuilderStore.getState();
      const hudScreenId = createScreen('HUD', 'hud');

      const { screens } = useUIBuilderStore.getState();
      const hudScreen = screens.find(s => s.id === hudScreenId)!;

      const progressBars = hudScreen.widgets.filter(w => w.type === 'progress_bar');
      const textWidgets = hudScreen.widgets.filter(w => w.type === 'text');

      expect(progressBars.length).toBeGreaterThanOrEqual(1);
      expect(textWidgets.length).toBeGreaterThanOrEqual(1);
    });

    it('main_menu preset creates button widgets', () => {
      const { createScreen } = useUIBuilderStore.getState();
      const menuScreenId = createScreen('Main Menu', 'main_menu');

      const { screens } = useUIBuilderStore.getState();
      const menuScreen = screens.find(s => s.id === menuScreenId)!;

      const buttons = menuScreen.widgets.filter(w => w.type === 'button');
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });

    it('pause_menu preset creates button widgets', () => {
      const { createScreen } = useUIBuilderStore.getState();
      const pauseScreenId = createScreen('Pause Menu', 'pause_menu');

      const { screens } = useUIBuilderStore.getState();
      const pauseScreen = screens.find(s => s.id === pauseScreenId)!;

      const buttons = pauseScreen.widgets.filter(w => w.type === 'button');
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });
  });
});
