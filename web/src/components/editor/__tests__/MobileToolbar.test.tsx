/**
 * Render tests for MobileToolbar component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { MobileToolbar } from '../MobileToolbar';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/components/editor/AddEntityMenu', () => ({
  AddEntityMenu: ({ onSpawn }: { onSpawn: (type: string) => void }) => (
    <button data-testid="add-entity-menu" onClick={() => onSpawn('cube')}>
      Add Entity
    </button>
  ),
}));

vi.mock('lucide-react', () => ({
  Move: (props: Record<string, unknown>) => <span data-testid="move-icon" {...props} />,
  RotateCw: (props: Record<string, unknown>) => <span data-testid="rotate-icon" {...props} />,
  Maximize2: (props: Record<string, unknown>) => <span data-testid="scale-icon" {...props} />,
  PanelLeft: (props: Record<string, unknown>) => <span data-testid="panel-left-icon" {...props} />,
  PanelRight: (props: Record<string, unknown>) => <span data-testid="panel-right-icon" {...props} />,
  Sparkles: (props: Record<string, unknown>) => <span data-testid="sparkles-icon" {...props} />,
}));

describe('MobileToolbar', () => {
  const mockSetGizmoMode = vi.fn();
  const mockSpawnEntity = vi.fn();
  const mockOnToggleLeft = vi.fn();
  const mockOnToggleRight = vi.fn();
  const mockOnQuickStart = vi.fn();

  function setupStore({ gizmoMode = 'translate' as string } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        gizmoMode,
        setGizmoMode: mockSetGizmoMode,
        spawnEntity: mockSpawnEntity,
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

  it('renders Scene Hierarchy toggle button', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} onQuickStart={mockOnQuickStart} />);
    expect(screen.getByTitle('Scene Hierarchy')).toBeInTheDocument();
  });

  it('renders Inspector toggle button', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} onQuickStart={mockOnQuickStart} />);
    expect(screen.getByTitle('Inspector')).toBeInTheDocument();
  });

  it('calls onToggleLeft when left panel button clicked', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} onQuickStart={mockOnQuickStart} />);
    fireEvent.click(screen.getByTitle('Scene Hierarchy'));
    expect(mockOnToggleLeft).toHaveBeenCalled();
  });

  it('calls onToggleRight when right panel button clicked', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} onQuickStart={mockOnQuickStart} />);
    fireEvent.click(screen.getByTitle('Inspector'));
    expect(mockOnToggleRight).toHaveBeenCalled();
  });

  it('renders Move gizmo button', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} onQuickStart={mockOnQuickStart} />);
    expect(screen.getByTitle('Move')).toBeInTheDocument();
  });

  it('renders Rotate gizmo button', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} onQuickStart={mockOnQuickStart} />);
    expect(screen.getByTitle('Rotate')).toBeInTheDocument();
  });

  it('renders Scale gizmo button', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} onQuickStart={mockOnQuickStart} />);
    expect(screen.getByTitle('Scale')).toBeInTheDocument();
  });

  it('calls setGizmoMode when Rotate clicked', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} onQuickStart={mockOnQuickStart} />);
    fireEvent.click(screen.getByTitle('Rotate'));
    expect(mockSetGizmoMode).toHaveBeenCalledWith('rotate');
  });

  it('calls setGizmoMode when Scale clicked', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} onQuickStart={mockOnQuickStart} />);
    fireEvent.click(screen.getByTitle('Scale'));
    expect(mockSetGizmoMode).toHaveBeenCalledWith('scale');
  });

  it('renders AddEntityMenu', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} onQuickStart={mockOnQuickStart} />);
    expect(screen.getByTestId('add-entity-menu')).toBeInTheDocument();
  });

  it('calls spawnEntity when AddEntityMenu triggers spawn', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} onQuickStart={mockOnQuickStart} />);
    fireEvent.click(screen.getByTestId('add-entity-menu'));
    expect(mockSpawnEntity).toHaveBeenCalledWith('cube');
  });

  // PF-1215: on a compact viewport this is the ONLY visible entry into the
  // game-creation pipeline, so it is an icon button with a real accessible name
  // rather than a tooltip-only affordance.
  it('renders the quick-start trigger with an accessible name', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} onQuickStart={mockOnQuickStart} />);
    expect(screen.getByRole('button', { name: 'Make me a game' })).toBeInTheDocument();
    expect(screen.getByTestId('quick-start-trigger')).toBeInTheDocument();
  });

  it('calls onQuickStart when the quick-start trigger is clicked', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} onQuickStart={mockOnQuickStart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Make me a game' }));
    expect(mockOnQuickStart).toHaveBeenCalledTimes(1);
  });

  // PF-1215 round 2 (5/5 UX BLOCKER): the six touch targets rendered directly
  // by this component (AddEntityMenu is mocked above and separately pinned by
  // AddEntityMenu.test.tsx) must each stay at the WCAG 2.5.5 44px minimum and
  // must never be allowed to shrink below it. jsdom has no real layout engine,
  // so these assertions are structural (className content), not measured
  // pixels — that is the only thing that can be mutation-tested here.
  describe('320px touch-target budget', () => {
    // AddEntityMenu's own trigger is mocked to a bare <button> with no size
    // classes in this file, so its real footprint can't be read here. Its
    // 44px WCAG target is pinned independently by AddEntityMenu.test.tsx;
    // this constant documents that contract for the arithmetic below.
    const ADD_ENTITY_MENU_TRIGGER_PX = 44;
    const MOBILE_VIEWPORT_MIN_PX = 320;

    function widthPx(className: string): number {
      if (/\bw-11\b/.test(className)) return 44;
      if (/\bw-px\b/.test(className)) return 1;
      throw new Error(`unrecognized width utility in "${className}" - update this test's lookup table`);
    }

    function renderToolbar() {
      render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} onQuickStart={mockOnQuickStart} />);
    }

    it('keeps every directly-rendered touch target at 44px with shrink-0', () => {
      renderToolbar();

      const targets = [
        screen.getByTitle('Scene Hierarchy'),
        screen.getByTitle('Move'),
        screen.getByTitle('Rotate'),
        screen.getByTitle('Scale'),
        screen.getByTestId('quick-start-trigger'),
        screen.getByTitle('Inspector'),
      ];

      for (const target of targets) {
        expect(target.className).toMatch(/\bh-11\b/);
        expect(target.className).toMatch(/\bw-11\b/);
        expect(target.className).toMatch(/\bshrink-0\b/);
      }
    });

    it('never lets the outer row add horizontal padding or the center group add horizontal gap', () => {
      renderToolbar();

      const outerRow = screen.getByTitle('Scene Hierarchy').parentElement;
      expect(outerRow).not.toBeNull();
      expect(outerRow!.className).not.toMatch(/\bpx-\d/);

      const centerGroup = screen.getByTitle('Move').parentElement;
      expect(centerGroup).not.toBeNull();
      expect(centerGroup!.className).toMatch(/\bshrink-0\b/);
      expect(centerGroup!.className).toMatch(/\bgap-0\b/);
      expect(centerGroup!.className).not.toMatch(/\bgap-0\.5\b/);
    });

    it('keeps both dividers at 1px, shrink-0, with no horizontal margin', () => {
      renderToolbar();

      const centerGroup = screen.getByTitle('Move').parentElement!;
      const dividers = Array.from(centerGroup.children).filter(
        (el) => el.tagName === 'DIV' && el.className.includes('w-px')
      );

      expect(dividers).toHaveLength(2);
      for (const divider of dividers) {
        expect(divider.className).toMatch(/\bw-px\b/);
        expect(divider.className).toMatch(/\bshrink-0\b/);
        expect(divider.className).not.toMatch(/\bmx-/);
      }
    });

    it('fits the six directly-rendered targets, both dividers, and AddEntityMenu inside the 320px minimum viewport', () => {
      renderToolbar();

      const leftToggle = screen.getByTitle('Scene Hierarchy');
      const gizmoButtons = [screen.getByTitle('Move'), screen.getByTitle('Rotate'), screen.getByTitle('Scale')];
      const quickStart = screen.getByTestId('quick-start-trigger');
      const rightToggle = screen.getByTitle('Inspector');

      const centerGroup = screen.getByTitle('Move').parentElement!;
      const dividers = Array.from(centerGroup.children).filter(
        (el) => el.tagName === 'DIV' && el.className.includes('w-px')
      );

      const measuredTotal =
        widthPx(leftToggle.className) +
        gizmoButtons.reduce((sum, b) => sum + widthPx(b.className), 0) +
        dividers.reduce((sum, d) => sum + widthPx(d.className), 0) +
        ADD_ENTITY_MENU_TRIGGER_PX +
        widthPx(quickStart.className) +
        widthPx(rightToggle.className);

      // 6 x 44px targets (left, 3 gizmo, quick-start, right) + AddEntityMenu's
      // own 44px trigger + 2 x 1px dividers = 310px, with no container padding
      // or gap contributing anything on top.
      expect(measuredTotal).toBe(310);
      expect(measuredTotal).toBeLessThanOrEqual(MOBILE_VIEWPORT_MIN_PX);
    });
  });
});
