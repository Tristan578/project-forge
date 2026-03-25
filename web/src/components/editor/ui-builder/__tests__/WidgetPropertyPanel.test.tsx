/**
 * Render tests for WidgetPropertyPanel component.
 *
 * Tests cover: null rendering when no widget is selected, common property
 * editing (name, x/y clamping, width/height clamping, anchor, visible,
 * interactable), and type-specific panels for text, image, button,
 * progress_bar, slider, and toggle widgets.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { WidgetPropertyPanel } from '../WidgetPropertyPanel';
import { useUIBuilderStore } from '@/stores/uiBuilderStore';

vi.mock('@/stores/uiBuilderStore', () => ({
  useUIBuilderStore: vi.fn(() => ({})),
}));

// DataBindingEditor is a real child — we stub the store for it too via the same mock.
// We don't need to separately stub DataBindingEditor because it reads from the same mock.

type AnyWidget = {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  anchor: string;
  visible: boolean;
  interactable: boolean;
  parentWidgetId: null;
  children: string[];
  style: Record<string, unknown>;
  config: Record<string, unknown>;
};

function makeWidget(type: string, configOverrides: Record<string, unknown> = {}): AnyWidget {
  const baseConfig: Record<string, Record<string, unknown>> = {
    text: { content: 'Hello', binding: null },
    image: { assetId: null, src: null, fit: 'contain', alt: '' },
    button: { label: 'Click Me', hoverStyle: {}, activeStyle: {}, action: { type: 'none' } },
    progress_bar: {
      valueBinding: { stateKey: 'health', direction: 'read', transform: null },
      min: 0, max: 100, direction: 'horizontal', fillColor: '#22c55e', trackColor: '#374151',
      showLabel: false, labelFormat: '{percent}%',
    },
    panel: { layout: 'free', gap: 0, alignItems: 'start' },
    slider: {
      valueBinding: { stateKey: 'volume', direction: 'read_write', transform: null },
      min: 0, max: 100, step: 1, orientation: 'horizontal',
      trackColor: '#374151', thumbColor: '#3b82f6', fillColor: '#3b82f6',
    },
    toggle: {
      valueBinding: { stateKey: 'enabled', direction: 'read_write', transform: null },
      onLabel: 'ON', offLabel: 'OFF', trackColorOn: '#22c55e', trackColorOff: '#6b7280', thumbColor: '#ffffff',
    },
  };

  return {
    id: 'widget1',
    name: `${type}_widget`,
    type,
    x: 10,
    y: 20,
    width: 15,
    height: 5,
    anchor: 'top_left',
    visible: true,
    interactable: true,
    parentWidgetId: null,
    children: [],
    style: {},
    config: { ...(baseConfig[type] ?? {}), ...configOverrides },
  };
}

describe('WidgetPropertyPanel', () => {
  const mockUpdateWidget = vi.fn();
  const mockMoveWidget = vi.fn();
  const mockResizeWidget = vi.fn();
  const mockSetBinding = vi.fn();
  const mockRemoveBinding = vi.fn();

  function setupStore(widget: AnyWidget | null) {
    const screens = widget
      ? [{ id: 'screen1', widgets: [widget] }]
      : [{ id: 'screen1', widgets: [] }];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useUIBuilderStore).mockImplementation((selector: any) => {
      const state = {
        activeScreenId: 'screen1',
        selectedWidgetId: widget ? widget.id : null,
        screens,
        updateWidget: mockUpdateWidget,
        moveWidget: mockMoveWidget,
        resizeWidget: mockResizeWidget,
        setBinding: mockSetBinding,
        removeBinding: mockRemoveBinding,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('null states', () => {
    it('returns null when no activeScreenId', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useUIBuilderStore).mockImplementation((selector: any) => {
        const state = {
          activeScreenId: null,
          selectedWidgetId: null,
          screens: [],
          updateWidget: mockUpdateWidget,
          moveWidget: mockMoveWidget,
          resizeWidget: mockResizeWidget,
          setBinding: mockSetBinding,
          removeBinding: mockRemoveBinding,
        };
        return typeof selector === 'function' ? selector(state) : state;
      });
      const { container } = render(<WidgetPropertyPanel />);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when no widget is selected', () => {
      setupStore(null);
      const { container } = render(<WidgetPropertyPanel />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('common properties', () => {
    it('renders widget name in the name input', () => {
      setupStore(makeWidget('text'));
      render(<WidgetPropertyPanel />);
      const input = screen.getByDisplayValue('text_widget');
      expect(input).not.toBeNull();
    });

    it('calls updateWidget when name is changed', () => {
      setupStore(makeWidget('text'));
      render(<WidgetPropertyPanel />);
      const nameInput = screen.getByDisplayValue('text_widget');
      fireEvent.change(nameInput, { target: { value: 'ScoreLabel' } });
      expect(mockUpdateWidget).toHaveBeenCalledWith('screen1', 'widget1', { name: 'ScoreLabel' });
    });

    it('renders x and y position inputs', () => {
      setupStore(makeWidget('text'));
      render(<WidgetPropertyPanel />);
      expect(screen.getByDisplayValue('10').tagName.toLowerCase()).toMatch(/input|select|textarea/);
      expect(screen.getByDisplayValue('20').tagName.toLowerCase()).toMatch(/input|select|textarea/);
    });

    it('calls moveWidget with new x value when x input changes', () => {
      setupStore(makeWidget('text'));
      render(<WidgetPropertyPanel />);
      const xInput = screen.getByDisplayValue('10');
      fireEvent.change(xInput, { target: { value: '30' } });
      expect(mockMoveWidget).toHaveBeenCalledWith('screen1', 'widget1', 30, 20);
    });

    it('clamps x to 100 when value exceeds maximum', () => {
      setupStore(makeWidget('text'));
      render(<WidgetPropertyPanel />);
      const xInput = screen.getByDisplayValue('10');
      fireEvent.change(xInput, { target: { value: '150' } });
      expect(mockMoveWidget).toHaveBeenCalledWith('screen1', 'widget1', 100, 20);
    });

    it('clamps x to 0 when value is negative', () => {
      setupStore(makeWidget('text'));
      render(<WidgetPropertyPanel />);
      const xInput = screen.getByDisplayValue('10');
      fireEvent.change(xInput, { target: { value: '-5' } });
      expect(mockMoveWidget).toHaveBeenCalledWith('screen1', 'widget1', 0, 20);
    });

    it('calls moveWidget with new y value when y input changes', () => {
      setupStore(makeWidget('text'));
      render(<WidgetPropertyPanel />);
      const yInput = screen.getByDisplayValue('20');
      fireEvent.change(yInput, { target: { value: '50' } });
      expect(mockMoveWidget).toHaveBeenCalledWith('screen1', 'widget1', 10, 50);
    });

    it('calls resizeWidget when width input changes', () => {
      setupStore(makeWidget('text'));
      render(<WidgetPropertyPanel />);
      const widthInput = screen.getByDisplayValue('15');
      fireEvent.change(widthInput, { target: { value: '30' } });
      expect(mockResizeWidget).toHaveBeenCalledWith('screen1', 'widget1', 30, 5);
    });

    it('calls resizeWidget when height input changes', () => {
      setupStore(makeWidget('text'));
      render(<WidgetPropertyPanel />);
      const heightInput = screen.getByDisplayValue('5');
      fireEvent.change(heightInput, { target: { value: '10' } });
      expect(mockResizeWidget).toHaveBeenCalledWith('screen1', 'widget1', 15, 10);
    });

    it('calls updateWidget with anchor when anchor select changes', () => {
      setupStore(makeWidget('text'));
      render(<WidgetPropertyPanel />);
      const anchorSelect = screen.getByDisplayValue('Top Left');
      fireEvent.change(anchorSelect, { target: { value: 'center' } });
      expect(mockUpdateWidget).toHaveBeenCalledWith('screen1', 'widget1', { anchor: 'center' });
    });

    it('renders all 9 anchor options', () => {
      setupStore(makeWidget('text'));
      render(<WidgetPropertyPanel />);
      const options = [
        'Top Left', 'Top Center', 'Top Right',
        'Center Left', 'Center', 'Center Right',
        'Bottom Left', 'Bottom Center', 'Bottom Right',
      ];
      for (const label of options) {
        expect(screen.getByRole('option', { name: label })).not.toBeNull();
      }
    });

    it('calls updateWidget with visible=false when Visible checkbox is unchecked', () => {
      setupStore(makeWidget('text'));
      render(<WidgetPropertyPanel />);
      const visibleCheckbox = screen.getByLabelText('Visible') as HTMLInputElement;
      expect(visibleCheckbox.checked).toBe(true);
      fireEvent.click(visibleCheckbox);
      expect(mockUpdateWidget).toHaveBeenCalledWith('screen1', 'widget1', { visible: false });
    });

    it('calls updateWidget with interactable=false when Interactable checkbox is unchecked', () => {
      setupStore(makeWidget('text'));
      render(<WidgetPropertyPanel />);
      const interactableCheckbox = screen.getByLabelText('Interactable') as HTMLInputElement;
      expect(interactableCheckbox.checked).toBe(true);
      fireEvent.click(interactableCheckbox);
      expect(mockUpdateWidget).toHaveBeenCalledWith('screen1', 'widget1', { interactable: false });
    });
  });

  describe('type-specific settings', () => {
    it('renders Type-Specific Settings section heading', () => {
      setupStore(makeWidget('text'));
      render(<WidgetPropertyPanel />);
      expect(screen.getByText('Type-Specific Settings').textContent).toBe('Type-Specific Settings');
    });

    describe('text widget', () => {
      it('renders content textarea with widget content', () => {
        setupStore(makeWidget('text'));
        render(<WidgetPropertyPanel />);
        const textarea = screen.getByDisplayValue('Hello');
        expect(textarea).not.toBeNull();
      });

      it('calls updateWidget with updated config when content changes', () => {
        setupStore(makeWidget('text'));
        render(<WidgetPropertyPanel />);
        const textarea = screen.getByDisplayValue('Hello');
        fireEvent.change(textarea, { target: { value: 'Score: 100' } });
        expect(mockUpdateWidget).toHaveBeenCalledWith(
          'screen1',
          'widget1',
          expect.objectContaining({ config: expect.objectContaining({ content: 'Score: 100' }) })
        );
      });

      it('renders DataBindingEditor with Data Binding label', () => {
        setupStore(makeWidget('text'));
        render(<WidgetPropertyPanel />);
        expect(screen.getByText('Data Binding').textContent).toBe('Data Binding');
      });

      it('does not render image or button fields', () => {
        setupStore(makeWidget('text'));
        render(<WidgetPropertyPanel />);
        expect(screen.queryByPlaceholderText('asset_123')).toBeNull();
        expect(screen.queryByDisplayValue('None')).toBeNull();
      });
    });

    describe('image widget', () => {
      it('renders Asset ID input', () => {
        setupStore(makeWidget('image'));
        render(<WidgetPropertyPanel />);
        expect(screen.getByPlaceholderText('asset_123')).not.toBeNull();
      });

      it('calls updateWidget with assetId when Asset ID changes', () => {
        setupStore(makeWidget('image'));
        render(<WidgetPropertyPanel />);
        const assetInput = screen.getByPlaceholderText('asset_123');
        fireEvent.change(assetInput, { target: { value: 'asset_hero_sprite' } });
        expect(mockUpdateWidget).toHaveBeenCalledWith(
          'screen1',
          'widget1',
          expect.objectContaining({ config: expect.objectContaining({ assetId: 'asset_hero_sprite' }) })
        );
      });

      it('renders fit select with all options', () => {
        setupStore(makeWidget('image'));
        render(<WidgetPropertyPanel />);
        expect(screen.getByRole('option', { name: 'Contain' })).not.toBeNull();
        expect(screen.getByRole('option', { name: 'Cover' })).not.toBeNull();
        expect(screen.getByRole('option', { name: 'Fill' })).not.toBeNull();
        expect(screen.getByRole('option', { name: 'None' })).not.toBeNull();
      });

      it('calls updateWidget with fit when fit select changes', () => {
        setupStore(makeWidget('image'));
        render(<WidgetPropertyPanel />);
        const fitSelect = screen.getByDisplayValue('Contain');
        fireEvent.change(fitSelect, { target: { value: 'cover' } });
        expect(mockUpdateWidget).toHaveBeenCalledWith(
          'screen1',
          'widget1',
          expect.objectContaining({ config: expect.objectContaining({ fit: 'cover' }) })
        );
      });
    });

    describe('button widget', () => {
      it('renders label input with current label', () => {
        setupStore(makeWidget('button'));
        render(<WidgetPropertyPanel />);
        expect(screen.getByDisplayValue('Click Me').tagName.toLowerCase()).toMatch(/input|select|textarea/);
      });

      it('calls updateWidget when button label changes', () => {
        setupStore(makeWidget('button'));
        render(<WidgetPropertyPanel />);
        const labelInput = screen.getByDisplayValue('Click Me');
        fireEvent.change(labelInput, { target: { value: 'Play' } });
        expect(mockUpdateWidget).toHaveBeenCalledWith(
          'screen1',
          'widget1',
          expect.objectContaining({ config: expect.objectContaining({ label: 'Play' }) })
        );
      });

      it('renders Action select with all action type options', () => {
        setupStore(makeWidget('button'));
        render(<WidgetPropertyPanel />);
        const options = ['None', 'Show Screen', 'Hide Screen', 'Toggle Screen', 'Set State', 'Call Function', 'Reset Scene'];
        for (const label of options) {
          expect(screen.getByRole('option', { name: label })).not.toBeNull();
        }
      });

      it('calls updateWidget with new action type when action select changes', () => {
        setupStore(makeWidget('button'));
        render(<WidgetPropertyPanel />);
        const actionSelect = screen.getByDisplayValue('None');
        fireEvent.change(actionSelect, { target: { value: 'show_screen' } });
        expect(mockUpdateWidget).toHaveBeenCalledWith(
          'screen1',
          'widget1',
          expect.objectContaining({ config: expect.objectContaining({ action: { type: 'show_screen' } }) })
        );
      });
    });

    describe('progress_bar widget', () => {
      it('renders Min and Max inputs', () => {
        setupStore(makeWidget('progress_bar'));
        render(<WidgetPropertyPanel />);
        // Progress bar has min=0 max=100
        const inputs = screen.getAllByRole('spinbutton');
        expect(inputs.length).toBeGreaterThanOrEqual(2);
      });

      it('renders Direction select with all options', () => {
        setupStore(makeWidget('progress_bar'));
        render(<WidgetPropertyPanel />);
        expect(screen.getByRole('option', { name: 'Horizontal' })).not.toBeNull();
        expect(screen.getByRole('option', { name: 'Vertical' })).not.toBeNull();
        expect(screen.getByRole('option', { name: 'Radial' })).not.toBeNull();
      });

      it('calls updateWidget when direction changes', () => {
        setupStore(makeWidget('progress_bar'));
        render(<WidgetPropertyPanel />);
        const directionSelect = screen.getByDisplayValue('Horizontal');
        fireEvent.change(directionSelect, { target: { value: 'vertical' } });
        expect(mockUpdateWidget).toHaveBeenCalledWith(
          'screen1',
          'widget1',
          expect.objectContaining({ config: expect.objectContaining({ direction: 'vertical' }) })
        );
      });

      it('renders DataBindingEditor for valueBinding', () => {
        setupStore(makeWidget('progress_bar'));
        render(<WidgetPropertyPanel />);
        expect(screen.getByText('Data Binding').textContent).toBe('Data Binding');
      });
    });

    describe('slider widget', () => {
      it('renders Min, Max, and Step inputs', () => {
        setupStore(makeWidget('slider'));
        render(<WidgetPropertyPanel />);
        expect(screen.getByText('Min').textContent).toBe('Min');
        expect(screen.getByText('Max').textContent).toBe('Max');
        expect(screen.getByText('Step').textContent).toBe('Step');
      });

      it('renders DataBindingEditor for valueBinding', () => {
        setupStore(makeWidget('slider'));
        render(<WidgetPropertyPanel />);
        expect(screen.getByText('Data Binding').textContent).toBe('Data Binding');
      });
    });

    describe('toggle widget', () => {
      it('renders On Label and Off Label inputs', () => {
        setupStore(makeWidget('toggle'));
        render(<WidgetPropertyPanel />);
        expect(screen.getByDisplayValue('ON').tagName.toLowerCase()).toMatch(/input|select|textarea/);
        expect(screen.getByDisplayValue('OFF').tagName.toLowerCase()).toMatch(/input|select|textarea/);
      });

      it('calls updateWidget when On Label changes', () => {
        setupStore(makeWidget('toggle'));
        render(<WidgetPropertyPanel />);
        const onLabelInput = screen.getByDisplayValue('ON');
        fireEvent.change(onLabelInput, { target: { value: 'Yes' } });
        expect(mockUpdateWidget).toHaveBeenCalledWith(
          'screen1',
          'widget1',
          expect.objectContaining({ config: expect.objectContaining({ onLabel: 'Yes' }) })
        );
      });

      it('calls updateWidget when Off Label changes', () => {
        setupStore(makeWidget('toggle'));
        render(<WidgetPropertyPanel />);
        const offLabelInput = screen.getByDisplayValue('OFF');
        fireEvent.change(offLabelInput, { target: { value: 'No' } });
        expect(mockUpdateWidget).toHaveBeenCalledWith(
          'screen1',
          'widget1',
          expect.objectContaining({ config: expect.objectContaining({ offLabel: 'No' }) })
        );
      });

      it('renders DataBindingEditor for valueBinding', () => {
        setupStore(makeWidget('toggle'));
        render(<WidgetPropertyPanel />);
        expect(screen.getByText('Data Binding').textContent).toBe('Data Binding');
      });
    });

    describe('panel widget', () => {
      it('does not render type-specific panel fields in common properties (panel has no extra UI)', () => {
        // Panel widget has layout config but no dedicated fields in WidgetPropertyPanel
        setupStore(makeWidget('panel'));
        render(<WidgetPropertyPanel />);
        // Should still render the common properties section
        expect(screen.getByText('Type-Specific Settings').textContent).toBe('Type-Specific Settings');
      });
    });
  });
});
