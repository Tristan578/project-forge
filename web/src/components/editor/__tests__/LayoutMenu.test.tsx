/**
 * Render tests for LayoutMenu component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { LayoutMenu } from '../LayoutMenu';
import { useWorkspaceStore } from '@/stores/workspaceStore';

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn(() => ({})),
}));

vi.mock('@/lib/workspace/presets', () => ({
  LAYOUT_PRESETS: {
    default: { id: 'default', name: 'Default', description: 'Standard layout' },
    focus: { id: 'focus', name: 'Focus', description: 'Minimal panels' },
  },
}));

vi.mock('lucide-react', () => ({
  LayoutGrid: (props: Record<string, unknown>) => <span data-testid="layout-grid-icon" {...props} />,
  Check: (props: Record<string, unknown>) => <span data-testid="check-icon" {...props} />,
  Save: (props: Record<string, unknown>) => <span data-testid="save-icon" {...props} />,
  RotateCcw: (props: Record<string, unknown>) => <span data-testid="rotate-ccw-icon" {...props} />,
}));

describe('LayoutMenu', () => {
  const mockApplyPreset = vi.fn();
  const mockSaveCustomPreset = vi.fn();
  const mockDeleteCustomPreset = vi.fn();
  const mockLoadCustomPreset = vi.fn();

  function setupStore({
    activePreset = 'default' as string,
    customPresets = [] as { name: string }[],
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useWorkspaceStore).mockImplementation((selector: any) => {
      const state = {
        activePreset,
        applyPreset: mockApplyPreset,
        customPresets,
        saveCustomPreset: mockSaveCustomPreset,
        deleteCustomPreset: mockDeleteCustomPreset,
        loadCustomPreset: mockLoadCustomPreset,
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

  it('renders Layout button', () => {
    render(<LayoutMenu />);
    expect(screen.getByText('Layout')).not.toBeNull();
  });

  it('does not show dropdown initially', () => {
    render(<LayoutMenu />);
    expect(screen.queryByText('Presets')).toBeNull();
  });

  it('shows dropdown when Layout button clicked', () => {
    render(<LayoutMenu />);
    fireEvent.click(screen.getByTitle('Layout presets'));
    expect(screen.getByText('Presets')).not.toBeNull();
  });

  it('shows preset names in dropdown', () => {
    render(<LayoutMenu />);
    fireEvent.click(screen.getByTitle('Layout presets'));
    expect(screen.getByText('Default')).not.toBeNull();
    expect(screen.getByText('Focus')).not.toBeNull();
  });

  it('calls applyPreset when a preset button clicked', () => {
    render(<LayoutMenu />);
    fireEvent.click(screen.getByTitle('Layout presets'));
    fireEvent.click(screen.getByText('Focus'));
    expect(mockApplyPreset).toHaveBeenCalledWith('focus');
  });

  it('shows Save Current Layout button in dropdown', () => {
    render(<LayoutMenu />);
    fireEvent.click(screen.getByTitle('Layout presets'));
    expect(screen.getByText('Save Current Layout')).not.toBeNull();
  });

  it('shows Reset to Default button in dropdown', () => {
    render(<LayoutMenu />);
    fireEvent.click(screen.getByTitle('Layout presets'));
    expect(screen.getByText('Reset to Default')).not.toBeNull();
  });

  it('shows preset name input when Save Current Layout clicked', () => {
    render(<LayoutMenu />);
    fireEvent.click(screen.getByTitle('Layout presets'));
    fireEvent.click(screen.getByText('Save Current Layout'));
    expect(screen.getByPlaceholderText('Preset name...')).not.toBeNull();
  });

  it('shows custom preset names when customPresets exist', () => {
    setupStore({ customPresets: [{ name: 'My Layout' }] });
    render(<LayoutMenu />);
    fireEvent.click(screen.getByTitle('Layout presets'));
    expect(screen.getByText('My Layout')).not.toBeNull();
    expect(screen.getByText('Custom')).not.toBeNull();
  });

  it('calls loadCustomPreset when custom preset clicked', () => {
    setupStore({ customPresets: [{ name: 'My Layout' }] });
    render(<LayoutMenu />);
    fireEvent.click(screen.getByTitle('Layout presets'));
    fireEvent.click(screen.getByText('My Layout'));
    expect(mockLoadCustomPreset).toHaveBeenCalledWith(0);
  });
});
