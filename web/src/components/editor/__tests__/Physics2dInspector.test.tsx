/**
 * Render tests for Physics2dInspector component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { Physics2dInspector } from '../Physics2dInspector';
import { useEditorStore } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { Physics2dData } from '@/stores/slices/types';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn(),
}));

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

vi.mock('lucide-react', () => ({
  HelpCircle: (props: Record<string, unknown>) => <span data-testid="help-circle" {...props} />,
}));

const basePhysics2d: Physics2dData = {
  bodyType: 'dynamic',
  colliderShape: 'auto',
  size: [1.0, 1.0],
  radius: 0.5,
  vertices: [],
  mass: 1.0,
  friction: 0.5,
  restitution: 0.0,
  gravityScale: 1.0,
  isSensor: false,
  lockRotation: false,
  continuousDetection: false,
  oneWayPlatform: false,
  surfaceVelocity: [0.0, 0.0],
};

describe('Physics2dInspector', () => {
  const mockUpdatePhysics2d = vi.fn();
  const mockTogglePhysics2d = vi.fn();
  const mockRemovePhysics2d = vi.fn();
  const mockNavigateDocs = vi.fn();

  function setupStore({
    primaryId = 'entity-1' as string | null,
    physics2d = null as Physics2dData | null,
    physics2dEnabled = false,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const physics2dMap: Record<string, Physics2dData> = {};
      const enabledMap: Record<string, boolean> = {};
      if (primaryId) {
        if (physics2d) physics2dMap[primaryId] = physics2d;
        enabledMap[primaryId] = physics2dEnabled;
      }
      const state = {
        primaryId,
        physics2d: physics2dMap,
        physics2dEnabled: enabledMap,
        updatePhysics2d: mockUpdatePhysics2d,
        togglePhysics2d: mockTogglePhysics2d,
        removePhysics2d: mockRemovePhysics2d,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useWorkspaceStore).mockImplementation((selector: any) => {
      const state = { navigateDocs: mockNavigateDocs };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders 2D Physics heading', () => {
    setupStore();
    render(<Physics2dInspector />);
    expect(screen.getByText('2D Physics')).toBeDefined();
  });

  it('renders Enabled checkbox', () => {
    setupStore();
    render(<Physics2dInspector />);
    expect(screen.getByText('Enabled')).toBeDefined();
  });

  it('Enabled checkbox is unchecked when physics2dEnabled is false', () => {
    setupStore({ physics2dEnabled: false });
    render(<Physics2dInspector />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('calls togglePhysics2d when enabled checkbox clicked', () => {
    setupStore();
    render(<Physics2dInspector />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(mockTogglePhysics2d).toHaveBeenCalledWith('entity-1', true);
  });

  it('initializes default physics data when enabling with no existing data', () => {
    setupStore({ physics2d: null, physics2dEnabled: false });
    render(<Physics2dInspector />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(mockUpdatePhysics2d).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({ bodyType: 'dynamic', mass: 1.0 })
    );
  });

  it('does not show physics settings when disabled', () => {
    setupStore({ physics2dEnabled: false });
    render(<Physics2dInspector />);
    expect(screen.queryByText('Body Type')).toBeNull();
  });

  it('shows Body Type select when enabled with data', () => {
    setupStore({ physics2d: basePhysics2d, physics2dEnabled: true });
    render(<Physics2dInspector />);
    expect(screen.getByText('Body Type')).toBeDefined();
  });

  it('renders Dynamic/Static/Kinematic options', () => {
    setupStore({ physics2d: basePhysics2d, physics2dEnabled: true });
    render(<Physics2dInspector />);
    expect(screen.getByRole('option', { name: 'Dynamic' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Static' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Kinematic' })).toBeDefined();
  });

  it('renders collider shape select', () => {
    setupStore({ physics2d: basePhysics2d, physics2dEnabled: true });
    render(<Physics2dInspector />);
    expect(screen.getByRole('option', { name: 'Auto' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Box' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Circle' })).toBeDefined();
  });

  it('shows Size inputs for box collider', () => {
    setupStore({
      physics2d: { ...basePhysics2d, colliderShape: 'box' },
      physics2dEnabled: true,
    });
    render(<Physics2dInspector />);
    expect(screen.getByText('Size')).toBeDefined();
  });

  it('shows Radius input for circle collider', () => {
    setupStore({
      physics2d: { ...basePhysics2d, colliderShape: 'circle' },
      physics2dEnabled: true,
    });
    render(<Physics2dInspector />);
    expect(screen.getByText('Radius')).toBeDefined();
  });

  it('shows Mass slider for dynamic body', () => {
    setupStore({ physics2d: basePhysics2d, physics2dEnabled: true });
    render(<Physics2dInspector />);
    expect(screen.getByText('Mass')).toBeDefined();
  });

  it('does not show Mass slider for static body', () => {
    setupStore({
      physics2d: { ...basePhysics2d, bodyType: 'static' },
      physics2dEnabled: true,
    });
    render(<Physics2dInspector />);
    expect(screen.queryByText('Mass')).toBeNull();
  });

  it('shows Friction label', () => {
    setupStore({ physics2d: basePhysics2d, physics2dEnabled: true });
    render(<Physics2dInspector />);
    expect(screen.getByText('Friction')).toBeDefined();
  });

  it('calls updatePhysics2d when body type changed', () => {
    setupStore({ physics2d: basePhysics2d, physics2dEnabled: true });
    render(<Physics2dInspector />);
    const selects = screen.getAllByRole('combobox');
    const bodyTypeSelect = selects.find(
      (s) => (s as HTMLSelectElement).value === 'dynamic'
    )!;
    fireEvent.change(bodyTypeSelect, { target: { value: 'static' } });
    expect(mockUpdatePhysics2d).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({ bodyType: 'static' })
    );
  });

  it('shows Remove button when physics2d enabled', () => {
    setupStore({ physics2d: basePhysics2d, physics2dEnabled: true });
    render(<Physics2dInspector />);
    expect(screen.getByText('Remove Physics')).toBeDefined();
  });

  it('calls removePhysics2d when Remove clicked and confirmed', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setupStore({ physics2d: basePhysics2d, physics2dEnabled: true });
    render(<Physics2dInspector />);
    fireEvent.click(screen.getByText('Remove Physics'));
    expect(mockRemovePhysics2d).toHaveBeenCalledWith('entity-1');
  });
});
