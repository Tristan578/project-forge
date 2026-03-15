/**
 * Render tests for ScreenList component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ScreenList } from '../ScreenList';
import { useUIBuilderStore } from '@/stores/uiBuilderStore';

vi.mock('@/stores/uiBuilderStore', () => ({
  useUIBuilderStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  Plus: (props: Record<string, unknown>) => <span data-testid="plus-icon" {...props} />,
  ChevronDown: (props: Record<string, unknown>) => <span data-testid="chevron-down" {...props} />,
}));

const mockScreens = [
  { id: 'screen1', name: 'HUD', widgets: [] },
  { id: 'screen2', name: 'Main Menu', widgets: [{ id: 'w1' }, { id: 'w2' }] },
];

describe('ScreenList', () => {
  const mockSetActiveScreen = vi.fn();
  const mockCreateScreen = vi.fn().mockReturnValue('new-screen-id');

  function setupStore({
    screens = mockScreens,
    activeScreenId = 'screen1',
  }: { screens?: typeof mockScreens; activeScreenId?: string } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useUIBuilderStore).mockImplementation((selector: any) => {
      const state = {
        screens,
        activeScreenId,
        setActiveScreen: mockSetActiveScreen,
        createScreen: mockCreateScreen,
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

  it('shows the active screen name', () => {
    setupStore();
    render(<ScreenList />);
    expect(screen.getByText('HUD')).toBeDefined();
  });

  it('shows "No screen selected" when no active screen matches', () => {
    setupStore({ activeScreenId: 'nonexistent' });
    render(<ScreenList />);
    expect(screen.getByText('No screen selected')).toBeDefined();
  });

  it('shows screen dropdown when selector button is clicked', () => {
    setupStore();
    render(<ScreenList />);
    // Click the screen selector button (contains 'HUD')
    fireEvent.click(screen.getByText('HUD'));
    expect(screen.getByText('Main Menu')).toBeDefined();
  });

  it('shows widget count in dropdown', () => {
    setupStore();
    render(<ScreenList />);
    fireEvent.click(screen.getByText('HUD'));
    // Main Menu has 2 widgets
    expect(screen.getByText('2 widgets')).toBeDefined();
  });

  it('shows "No screens" when screen list is empty', () => {
    setupStore({ screens: [], activeScreenId: '' });
    render(<ScreenList />);
    // Click the button showing "No screen selected"
    fireEvent.click(screen.getByText('No screen selected'));
    expect(screen.getByText('No screens')).toBeDefined();
  });

  it('calls setActiveScreen when a screen is selected from dropdown', () => {
    setupStore();
    render(<ScreenList />);
    fireEvent.click(screen.getByText('HUD'));
    fireEvent.click(screen.getByText('Main Menu'));
    expect(mockSetActiveScreen).toHaveBeenCalledWith('screen2');
  });

  it('shows preset picker when plus button is clicked', () => {
    setupStore();
    render(<ScreenList />);
    fireEvent.click(screen.getByTestId('plus-icon').closest('button')!);
    // Preset picker should show all preset options
    expect(screen.getByText('Blank')).toBeDefined();
    expect(screen.getByText('Pause Menu')).toBeDefined();
    expect(screen.getByText('Game Over')).toBeDefined();
    expect(screen.getByText('Inventory')).toBeDefined();
    expect(screen.getByText('Dialog')).toBeDefined();
  });

  it('calls createScreen with selected preset when preset is clicked', () => {
    setupStore();
    // Mock window.prompt to return a name
    vi.spyOn(window, 'prompt').mockReturnValue('My Screen');
    render(<ScreenList />);
    fireEvent.click(screen.getByTestId('plus-icon').closest('button')!);
    // Click "Blank" preset
    const blankButton = screen.getAllByText('Blank')[0];
    fireEvent.click(blankButton);
    expect(mockCreateScreen).toHaveBeenCalledWith('My Screen', 'blank');
    vi.restoreAllMocks();
  });

  it('does not create screen when prompt is cancelled', () => {
    setupStore();
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    render(<ScreenList />);
    fireEvent.click(screen.getByTestId('plus-icon').closest('button')!);
    const blankButton = screen.getAllByText('Blank')[0];
    fireEvent.click(blankButton);
    expect(mockCreateScreen).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
