/**
 * Render tests for ScreenSettingsPanel component.
 *
 * Tests cover name editing, visibility toggles (showOnStart, blockInput),
 * showOnKey, background color, z-index, transition type/duration/easing,
 * and screen deletion with confirm guard.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ScreenSettingsPanel } from '../ScreenSettingsPanel';
import { useUIBuilderStore } from '@/stores/uiBuilderStore';

vi.mock('@/stores/uiBuilderStore', () => ({
  useUIBuilderStore: vi.fn(() => ({})),
}));

const mockConfirm = vi.fn().mockResolvedValue(true);
vi.mock('@/hooks/useConfirmDialog', () => ({
  useConfirmDialog: () => ({
    confirm: mockConfirm,
    ConfirmDialogPortal: () => null,
  }),
}));

const makeScreen = (overrides: Record<string, unknown> = {}) => ({
  id: 'screen1',
  name: 'Main Menu',
  widgets: [],
  visible: false,
  showOnStart: false,
  showOnKey: null,
  transition: { type: 'none', durationMs: 300, easing: 'ease_out' },
  zIndex: 0,
  backgroundColor: 'transparent',
  blockInput: false,
  ...overrides,
});

describe('ScreenSettingsPanel', () => {
  const mockUpdateScreen = vi.fn();
  const mockRenameScreen = vi.fn();
  const mockDeleteScreen = vi.fn();

  function setupStore(screenOverrides: Record<string, unknown> = {}) {
    const screen = makeScreen(screenOverrides);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useUIBuilderStore).mockImplementation((selector: any) => {
      const state = {
        activeScreenId: 'screen1',
        screens: [screen],
        updateScreen: mockUpdateScreen,
        renameScreen: mockRenameScreen,
        deleteScreen: mockDeleteScreen,
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

  it('returns null when no active screen matches', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useUIBuilderStore).mockImplementation((selector: any) => {
      const state = {
        activeScreenId: 'nonexistent',
        screens: [],
        updateScreen: mockUpdateScreen,
        renameScreen: mockRenameScreen,
        deleteScreen: mockDeleteScreen,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
    const { container } = render(<ScreenSettingsPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders screen name in the name input', () => {
    setupStore();
    render(<ScreenSettingsPanel />);
    const input = screen.getByDisplayValue('Main Menu');
    expect(input).toBeDefined();
  });

  it('calls renameScreen when name input changes', () => {
    setupStore();
    render(<ScreenSettingsPanel />);
    const input = screen.getByDisplayValue('Main Menu');
    fireEvent.change(input, { target: { value: 'Pause Menu' } });
    expect(mockRenameScreen).toHaveBeenCalledWith('screen1', 'Pause Menu');
  });

  it('calls updateScreen with showOnStart when checkbox is toggled', () => {
    setupStore();
    render(<ScreenSettingsPanel />);
    const checkbox = screen.getByLabelText('Show on start') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(mockUpdateScreen).toHaveBeenCalledWith('screen1', { showOnStart: true });
  });

  it('renders showOnStart checked when screen has showOnStart=true', () => {
    setupStore({ showOnStart: true });
    render(<ScreenSettingsPanel />);
    const checkbox = screen.getByLabelText('Show on start') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('calls updateScreen with blockInput when Block 3D input is toggled', () => {
    setupStore();
    render(<ScreenSettingsPanel />);
    const checkbox = screen.getByLabelText('Block 3D input') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(mockUpdateScreen).toHaveBeenCalledWith('screen1', { blockInput: true });
  });

  it('calls updateScreen with showOnKey when key field changes', () => {
    setupStore();
    render(<ScreenSettingsPanel />);
    const input = screen.getByPlaceholderText('Escape, Tab, etc.');
    fireEvent.change(input, { target: { value: 'Escape' } });
    expect(mockUpdateScreen).toHaveBeenCalledWith('screen1', { showOnKey: 'Escape' });
  });

  it('passes null for showOnKey when key field is cleared', () => {
    setupStore({ showOnKey: 'Tab' });
    render(<ScreenSettingsPanel />);
    const input = screen.getByDisplayValue('Tab');
    fireEvent.change(input, { target: { value: '' } });
    expect(mockUpdateScreen).toHaveBeenCalledWith('screen1', { showOnKey: null });
  });

  it('calls updateScreen with backgroundColor when field changes', () => {
    setupStore();
    render(<ScreenSettingsPanel />);
    const input = screen.getByPlaceholderText('transparent, #000, rgba(0,0,0,0.5)');
    fireEvent.change(input, { target: { value: '#ff0000' } });
    expect(mockUpdateScreen).toHaveBeenCalledWith('screen1', { backgroundColor: '#ff0000' });
  });

  it('calls updateScreen with zIndex when z-index input changes', () => {
    setupStore();
    render(<ScreenSettingsPanel />);
    const zIndexInput = screen.getByDisplayValue('0');
    fireEvent.change(zIndexInput, { target: { value: '10' } });
    expect(mockUpdateScreen).toHaveBeenCalledWith('screen1', { zIndex: 10 });
  });

  describe('transition settings', () => {
    it('renders the Transition section heading', () => {
      setupStore();
      render(<ScreenSettingsPanel />);
      expect(screen.getByText('Transition')).toBeDefined();
    });

    it('calls updateScreen with transition type when changed to fade', () => {
      setupStore();
      render(<ScreenSettingsPanel />);
      const typeSelect = screen.getByDisplayValue('None');
      fireEvent.change(typeSelect, { target: { value: 'fade' } });
      expect(mockUpdateScreen).toHaveBeenCalledWith('screen1', {
        transition: { type: 'fade', durationMs: 300, easing: 'ease_out' },
      });
    });

    it('calls updateScreen with transition duration when changed', () => {
      setupStore();
      render(<ScreenSettingsPanel />);
      const durationInput = screen.getByDisplayValue('300');
      fireEvent.change(durationInput, { target: { value: '500' } });
      expect(mockUpdateScreen).toHaveBeenCalledWith('screen1', {
        transition: { type: 'none', durationMs: 500, easing: 'ease_out' },
      });
    });

    it('calls updateScreen with transition easing when changed', () => {
      setupStore();
      render(<ScreenSettingsPanel />);
      const easingSelect = screen.getByDisplayValue('Ease Out');
      fireEvent.change(easingSelect, { target: { value: 'ease_in' } });
      expect(mockUpdateScreen).toHaveBeenCalledWith('screen1', {
        transition: { type: 'none', durationMs: 300, easing: 'ease_in' },
      });
    });

    it('renders all transition type options', () => {
      setupStore();
      render(<ScreenSettingsPanel />);
      expect(screen.getByRole('option', { name: 'None' })).toBeDefined();
      expect(screen.getByRole('option', { name: 'Fade' })).toBeDefined();
      expect(screen.getByRole('option', { name: 'Slide Left' })).toBeDefined();
      expect(screen.getByRole('option', { name: 'Slide Right' })).toBeDefined();
      expect(screen.getByRole('option', { name: 'Slide Up' })).toBeDefined();
      expect(screen.getByRole('option', { name: 'Slide Down' })).toBeDefined();
      expect(screen.getByRole('option', { name: 'Scale' })).toBeDefined();
    });

    it('renders all easing options', () => {
      setupStore();
      render(<ScreenSettingsPanel />);
      expect(screen.getByRole('option', { name: 'Linear' })).toBeDefined();
      expect(screen.getByRole('option', { name: 'Ease In' })).toBeDefined();
      expect(screen.getByRole('option', { name: 'Ease Out' })).toBeDefined();
      expect(screen.getByRole('option', { name: 'Ease In Out' })).toBeDefined();
    });
  });

  describe('screen deletion', () => {
    it('renders Delete Screen button', () => {
      setupStore();
      render(<ScreenSettingsPanel />);
      expect(screen.getByText('Delete Screen')).toBeDefined();
    });

    it('calls deleteScreen when delete is confirmed', async () => {
      setupStore();
      mockConfirm.mockResolvedValue(true);
      render(<ScreenSettingsPanel />);
      fireEvent.click(screen.getByText('Delete Screen'));
      await vi.waitFor(() => {
        expect(mockDeleteScreen).toHaveBeenCalledWith('screen1');
      });
    });

    it('does not call deleteScreen when delete is cancelled', async () => {
      setupStore();
      mockConfirm.mockResolvedValue(false);
      render(<ScreenSettingsPanel />);
      fireEvent.click(screen.getByText('Delete Screen'));
      // Give the async confirm time to resolve
      await vi.waitFor(() => {
        expect(mockConfirm).toHaveBeenCalled();
      });
      expect(mockDeleteScreen).not.toHaveBeenCalled();
    });
  });
});
