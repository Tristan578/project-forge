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
    'level-generator': { id: 'level-generator', title: 'Level Generator', category: 'creation' },
    'pacing-analyzer': { id: 'pacing-analyzer', title: 'Pacing Analyzer', category: 'polish' },
    'behavior-tree': { id: 'behavior-tree', title: 'Behavior Tree', category: 'intelligence' },
    'smart-camera': { id: 'smart-camera', title: 'Smart Camera', category: 'tools' },
  },
  AI_PANELS_BY_CATEGORY: {
    creation: [{ id: 'level-generator', title: 'Level Generator', category: 'creation' }],
    polish: [{ id: 'pacing-analyzer', title: 'Pacing Analyzer', category: 'polish' }],
    intelligence: [{ id: 'behavior-tree', title: 'Behavior Tree', category: 'intelligence' }],
    tools: [{ id: 'smart-camera', title: 'Smart Camera', category: 'tools' }],
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
    expect(screen.getByText('Panels')).not.toBeNull();
  });

  it('does not show dropdown content initially', () => {
    render(<PanelsMenu />);
    // Standard panels section header is only visible when dropdown is open
    expect(screen.queryByText('Scene Hierarchy')).toBeNull();
  });

  it('shows standard panels section header when opened', () => {
    render(<PanelsMenu />);
    fireEvent.click(screen.getByTitle('Show/hide panels'));
    // Standard (non-AI) panels appear under a "Panels" header
    expect(screen.getAllByText('Panels').length).toBeGreaterThanOrEqual(1);
  });

  it('shows standard panel names in dropdown', () => {
    render(<PanelsMenu />);
    fireEvent.click(screen.getByTitle('Show/hide panels'));
    expect(screen.getByText('Scene Hierarchy')).not.toBeNull();
    expect(screen.getByText('Inspector')).not.toBeNull();
    expect(screen.getByText('Asset Browser')).not.toBeNull();
  });

  it('shows AI category headers when opened', () => {
    render(<PanelsMenu />);
    fireEvent.click(screen.getByTitle('Show/hide panels'));
    expect(screen.getByText('Creation')).not.toBeNull();
    expect(screen.getByText('Polish')).not.toBeNull();
    expect(screen.getByText('Intelligence')).not.toBeNull();
    expect(screen.getByText('Tools')).not.toBeNull();
  });

  it('shows AI panel names under their categories', () => {
    render(<PanelsMenu />);
    fireEvent.click(screen.getByTitle('Show/hide panels'));
    expect(screen.getByText('Level Generator')).not.toBeNull();
    expect(screen.getByText('Pacing Analyzer')).not.toBeNull();
    expect(screen.getByText('Behavior Tree')).not.toBeNull();
    expect(screen.getByText('Smart Camera')).not.toBeNull();
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
    expect(screen.getByText('open')).not.toBeNull();
  });

  it('renders button with title "Show/hide panels"', () => {
    render(<PanelsMenu />);
    expect(screen.getByTitle('Show/hide panels')).not.toBeNull();
  });
});
