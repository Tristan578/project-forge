/**
 * Render tests for PanelsMenu component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { PanelsMenu } from '../PanelsMenu';
import { useWorkspaceStore } from '@/stores/workspaceStore';

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn(() => ({})),
}));

vi.mock('@/lib/workspace/panelRegistry', () => ({
  PANEL_DEFINITIONS: {
    scene: { id: 'scene', title: 'Scene Hierarchy' },
    inspector: { id: 'inspector', title: 'Inspector' },
    assets: { id: 'assets', title: 'Asset Browser' },
  },
}));

vi.mock('lucide-react', () => ({
  PanelTopOpen: (props: Record<string, unknown>) => <span data-testid="panel-top-open-icon" {...props} />,
  Check: (props: Record<string, unknown>) => <span data-testid="check-icon" {...props} />,
}));

describe('PanelsMenu', () => {
  const mockOpenPanel = vi.fn();

  function setupStore({
    openPanels = [] as string[],
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useWorkspaceStore).mockImplementation((selector: any) => {
      const state = {
        openPanel: mockOpenPanel,
        api: {
          panels: openPanels.map((id) => ({ id })),
        },
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

  it('renders Panels button', () => {
    render(<PanelsMenu />);
    expect(screen.getByText('Panels')).toBeDefined();
  });

  it('does not show dropdown initially', () => {
    render(<PanelsMenu />);
    expect(screen.queryByText('Toggle Panels')).toBeNull();
  });

  it('shows dropdown when Panels button clicked', () => {
    render(<PanelsMenu />);
    fireEvent.click(screen.getByTitle('Show/hide panels'));
    expect(screen.getByText('Toggle Panels')).toBeDefined();
  });

  it('shows panel names in dropdown', () => {
    render(<PanelsMenu />);
    fireEvent.click(screen.getByTitle('Show/hide panels'));
    expect(screen.getByText('Scene Hierarchy')).toBeDefined();
    expect(screen.getByText('Inspector')).toBeDefined();
    expect(screen.getByText('Asset Browser')).toBeDefined();
  });

  it('calls openPanel when a panel button clicked', () => {
    render(<PanelsMenu />);
    fireEvent.click(screen.getByTitle('Show/hide panels'));
    fireEvent.click(screen.getByText('Scene Hierarchy'));
    expect(mockOpenPanel).toHaveBeenCalledWith('scene');
  });

  it('shows "open" text for panels that are open', () => {
    setupStore({ openPanels: ['scene'] });
    render(<PanelsMenu />);
    fireEvent.click(screen.getByTitle('Show/hide panels'));
    expect(screen.getByText('open')).toBeDefined();
  });

  it('renders button with title "Show/hide panels"', () => {
    render(<PanelsMenu />);
    expect(screen.getByTitle('Show/hide panels')).toBeDefined();
  });
});
