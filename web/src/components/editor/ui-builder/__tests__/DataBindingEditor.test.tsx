/**
 * Render tests for DataBindingEditor component.
 *
 * Tests cover binding toggle, stateKey/direction/transform editing,
 * and transform-specific sub-fields for all five transform types.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { DataBindingEditor } from '../DataBindingEditor';
import { useUIBuilderStore } from '@/stores/uiBuilderStore';
import type { DataBinding } from '@/stores/uiBuilderStore';

vi.mock('@/stores/uiBuilderStore', () => ({
  useUIBuilderStore: vi.fn(),
}));

const BASE_PROPS = {
  screenId: 'screen1',
  widgetId: 'widget1',
  property: 'binding',
};

describe('DataBindingEditor', () => {
  const mockSetBinding = vi.fn();
  const mockRemoveBinding = vi.fn();

  function setupStore() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useUIBuilderStore).mockImplementation((selector: any) => {
      const state = {
        setBinding: mockSetBinding,
        removeBinding: mockRemoveBinding,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  describe('when no binding is present', () => {
    it('renders "Add" button', () => {
      render(<DataBindingEditor {...BASE_PROPS} binding={null} />);
      expect(screen.getByText('Add')).toBeDefined();
    });

    it('does not render stateKey input', () => {
      render(<DataBindingEditor {...BASE_PROPS} binding={null} />);
      expect(screen.queryByPlaceholderText('health, score, etc.')).toBeNull();
    });

    it('calls setBinding with default read binding when Add is clicked', () => {
      render(<DataBindingEditor {...BASE_PROPS} binding={null} />);
      fireEvent.click(screen.getByText('Add'));
      expect(mockSetBinding).toHaveBeenCalledWith('screen1', 'widget1', 'binding', {
        stateKey: '',
        direction: 'read',
        transform: null,
      });
    });
  });

  describe('when a binding is present', () => {
    const binding: DataBinding = {
      stateKey: 'playerHealth',
      direction: 'read',
      transform: null,
    };

    it('renders "Remove" button', () => {
      render(<DataBindingEditor {...BASE_PROPS} binding={binding} />);
      expect(screen.getByText('Remove')).toBeDefined();
    });

    it('renders stateKey input with current value', () => {
      render(<DataBindingEditor {...BASE_PROPS} binding={binding} />);
      const input = screen.getByPlaceholderText('health, score, etc.');
      expect((input as HTMLInputElement).value).toBe('playerHealth');
    });

    it('calls removeBinding when Remove is clicked', () => {
      render(<DataBindingEditor {...BASE_PROPS} binding={binding} />);
      fireEvent.click(screen.getByText('Remove'));
      expect(mockRemoveBinding).toHaveBeenCalledWith('screen1', 'widget1', 'binding');
    });

    it('calls setBinding when stateKey is changed', () => {
      render(<DataBindingEditor {...BASE_PROPS} binding={binding} />);
      const input = screen.getByPlaceholderText('health, score, etc.');
      fireEvent.change(input, { target: { value: 'score' } });
      expect(mockSetBinding).toHaveBeenCalledWith('screen1', 'widget1', 'binding', {
        ...binding,
        stateKey: 'score',
      });
    });

    it('calls setBinding when direction is changed to write', () => {
      render(<DataBindingEditor {...BASE_PROPS} binding={binding} />);
      const select = screen.getByDisplayValue('Read');
      fireEvent.change(select, { target: { value: 'write' } });
      expect(mockSetBinding).toHaveBeenCalledWith('screen1', 'widget1', 'binding', {
        ...binding,
        direction: 'write',
      });
    });

    it('calls setBinding when direction is changed to read_write', () => {
      render(<DataBindingEditor {...BASE_PROPS} binding={binding} />);
      const select = screen.getByDisplayValue('Read');
      fireEvent.change(select, { target: { value: 'read_write' } });
      expect(mockSetBinding).toHaveBeenCalledWith('screen1', 'widget1', 'binding', {
        ...binding,
        direction: 'read_write',
      });
    });

    it('calls setBinding with null transform when transform is set to none', () => {
      const bindingWithTransform: DataBinding = {
        stateKey: 'score',
        direction: 'read',
        transform: { type: 'multiply', factor: 2 },
      };
      render(<DataBindingEditor {...BASE_PROPS} binding={bindingWithTransform} />);
      // The transform select shows current value "multiply"
      const transformSelect = screen.getByDisplayValue('Multiply');
      fireEvent.change(transformSelect, { target: { value: 'none' } });
      expect(mockSetBinding).toHaveBeenCalledWith('screen1', 'widget1', 'binding', {
        ...bindingWithTransform,
        transform: null,
      });
    });
  });

  describe('transform type selection', () => {
    const baseBinding: DataBinding = {
      stateKey: 'health',
      direction: 'read',
      transform: null,
    };

    it('shows format template field when format transform is selected', () => {
      const bindingWithFormat: DataBinding = {
        ...baseBinding,
        transform: { type: 'format', template: 'HP: {value}' },
      };
      render(<DataBindingEditor {...BASE_PROPS} binding={bindingWithFormat} />);
      const input = screen.getByPlaceholderText('HP: {value}/{max}');
      expect((input as HTMLInputElement).value).toBe('HP: {value}');
    });

    it('updates format template when changed', () => {
      const bindingWithFormat: DataBinding = {
        ...baseBinding,
        transform: { type: 'format', template: 'Old' },
      };
      render(<DataBindingEditor {...BASE_PROPS} binding={bindingWithFormat} />);
      const input = screen.getByPlaceholderText('HP: {value}/{max}');
      fireEvent.change(input, { target: { value: 'Score: {value}' } });
      expect(mockSetBinding).toHaveBeenCalledWith('screen1', 'widget1', 'binding', {
        ...bindingWithFormat,
        transform: { type: 'format', template: 'Score: {value}' },
      });
    });

    it('shows clamp min and max fields when clamp transform is active', () => {
      const bindingWithClamp: DataBinding = {
        ...baseBinding,
        transform: { type: 'clamp', min: 0, max: 100 },
      };
      render(<DataBindingEditor {...BASE_PROPS} binding={bindingWithClamp} />);
      // Should have Min and Max labels
      const labels = screen.getAllByText('Min');
      expect(labels.length).toBeGreaterThan(0);
      const maxLabels = screen.getAllByText('Max');
      expect(maxLabels.length).toBeGreaterThan(0);
    });

    it('shows multiply factor field when multiply transform is active', () => {
      const bindingWithMultiply: DataBinding = {
        ...baseBinding,
        transform: { type: 'multiply', factor: 2.5 },
      };
      render(<DataBindingEditor {...BASE_PROPS} binding={bindingWithMultiply} />);
      expect(screen.getByText('Factor')).toBeDefined();
    });

    it('updates multiply factor when changed', () => {
      const bindingWithMultiply: DataBinding = {
        ...baseBinding,
        transform: { type: 'multiply', factor: 2 },
      };
      render(<DataBindingEditor {...BASE_PROPS} binding={bindingWithMultiply} />);
      // Find the factor input by its container context (label text "Factor")
      const factorLabel = screen.getByText('Factor');
      const input = factorLabel.parentElement!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '5' } });
      expect(mockSetBinding).toHaveBeenCalledWith('screen1', 'widget1', 'binding', {
        ...bindingWithMultiply,
        transform: { type: 'multiply', factor: 5 },
      });
    });

    it('shows round decimals field when round transform is active', () => {
      const bindingWithRound: DataBinding = {
        ...baseBinding,
        transform: { type: 'round', decimals: 2 },
      };
      render(<DataBindingEditor {...BASE_PROPS} binding={bindingWithRound} />);
      expect(screen.getByText('Decimals')).toBeDefined();
    });

    it('does not show transform-specific fields when transform is null', () => {
      render(<DataBindingEditor {...BASE_PROPS} binding={baseBinding} />);
      expect(screen.queryByText('Factor')).toBeNull();
      expect(screen.queryByText('Decimals')).toBeNull();
      expect(screen.queryByText('Template')).toBeNull();
    });
  });
});
