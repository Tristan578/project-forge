/**
 * Render tests for GameCameraInspector component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GameCameraInspector } from '../GameCameraInspector';
import { useEditorStore } from '@/stores/editorStore';
import type { GameCameraData } from '@/stores/slices/types';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

vi.mock('lucide-react', () => ({
  Camera: (props: Record<string, unknown>) => <span data-testid="camera-icon" {...props} />,
  Zap: (props: Record<string, unknown>) => <span data-testid="zap-icon" {...props} />,
}));

const baseGameCamera: GameCameraData = {
  mode: 'thirdPersonFollow',
  targetEntity: null,
  followDistance: 5,
  followHeight: 2,
  followSmoothing: 5,
};

describe('GameCameraInspector', () => {
  const mockSetGameCamera = vi.fn();
  const mockSetActiveGameCamera = vi.fn();
  const mockRemoveGameCamera = vi.fn();
  const mockCameraShake = vi.fn();

  function setupStore({
    primaryId = 'entity-1' as string | null,
    primaryGameCamera = baseGameCamera as GameCameraData | null,
    activeGameCameraId = null as string | null,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      // The component derives its camera from `allGameCameras[primaryId]` — there
      // is no `primaryGameCamera` field on the store (PF-1126).
      const state = {
        primaryId,
        allGameCameras: primaryId && primaryGameCamera ? { [primaryId]: primaryGameCamera } : {},
        activeGameCameraId,
        setGameCamera: mockSetGameCamera,
        setActiveGameCamera: mockSetActiveGameCamera,
        removeGameCamera: mockRemoveGameCamera,
        cameraShake: mockCameraShake,
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

  it('returns null when no primary entity', () => {
    setupStore({ primaryId: null });
    const { container } = render(<GameCameraInspector />);
    expect(container.firstChild).toBeNull();
  });

  it('shows "Add Game Camera" button when no camera configured', () => {
    setupStore({ primaryGameCamera: null });
    render(<GameCameraInspector />);
    expect(screen.getByText('Add Game Camera')).toBeInTheDocument();
  });

  it('renders Game Camera heading when camera configured', () => {
    setupStore();
    render(<GameCameraInspector />);
    expect(screen.getByText('Game Camera')).toBeInTheDocument();
  });

  it('renders Active checkbox', () => {
    setupStore();
    render(<GameCameraInspector />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('renders Mode select dropdown', () => {
    setupStore();
    render(<GameCameraInspector />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('shows 3rd Person Follow as default mode', () => {
    setupStore();
    render(<GameCameraInspector />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('thirdPersonFollow');
  });

  it('shows thirdPersonFollow params by default', () => {
    setupStore();
    render(<GameCameraInspector />);
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Height')).toBeInTheDocument();
    expect(screen.getByText('Smoothing')).toBeInTheDocument();
    // "Look Ahead" is gone: `ThirdPersonFollow` has no such engine parameter, so
    // the control edited a value that could never leave the browser.
    expect(screen.queryByText('Look Ahead')).not.toBeInTheDocument();
  });

  it('renders Test Shake button', () => {
    setupStore();
    render(<GameCameraInspector />);
    expect(screen.getByText('Test Shake')).toBeInTheDocument();
  });

  it('calls cameraShake when Test Shake is clicked', () => {
    setupStore();
    render(<GameCameraInspector />);
    fireEvent.click(screen.getByText('Test Shake'));
    expect(mockCameraShake).toHaveBeenCalledWith('entity-1', 0.3, 0.5);
  });

  it('renders Remove button', () => {
    setupStore();
    render(<GameCameraInspector />);
    expect(screen.getByText('Remove')).toBeInTheDocument();
  });

  it('calls removeGameCamera when Remove is clicked', () => {
    setupStore();
    render(<GameCameraInspector />);
    fireEvent.click(screen.getByText('Remove'));
    expect(mockRemoveGameCamera).toHaveBeenCalledWith('entity-1');
  });

  it('calls setGameCamera with new mode when mode changed', () => {
    setupStore();
    render(<GameCameraInspector />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'firstPerson' } });
    expect(mockSetGameCamera).toHaveBeenCalledWith('entity-1', expect.objectContaining({ mode: 'firstPerson' }));
  });

  describe('numeric parameter floors', () => {
    /**
     * The Smoothing row carries `min={0}` because the engine HARD-REJECTS a
     * negative follow rate, and `set_game_camera` is full-replace — so one typed
     * `-3` would drop mode, targetEntity and offset along with the rate
     * (PF-1166). The `min` attribute alone is advisory: a typed value still fires
     * `change`, so the floor has to be enforced in the parse.
     */
    function smoothingInput(container: HTMLElement): HTMLInputElement {
      const label = Array.from(container.querySelectorAll('label')).find(
        (l) => l.textContent?.trim() === 'Smoothing',
      );
      const id = label?.getAttribute('for');
      expect(id, 'no <label for> pointing at the Smoothing control').toBeTruthy();
      return container.querySelector(`#${CSS.escape(id!)}`) as HTMLInputElement;
    }

    it('advertises the floor to the browser and to assistive tech', () => {
      setupStore();
      const { container } = render(<GameCameraInspector />);
      expect(smoothingInput(container).min).toBe('0');
    });

    it('refuses a negative Smoothing rather than dispatching it', () => {
      setupStore();
      const { container } = render(<GameCameraInspector />);
      fireEvent.change(smoothingInput(container), { target: { value: '-3' } });
      // Held at the previous value, exactly as a typo is — never sent as -3.
      expect(mockSetGameCamera).toHaveBeenCalledWith(
        'entity-1',
        expect.objectContaining({ followSmoothing: 5 }),
      );
    });

    it('accepts zero, which freezes the camera on purpose', () => {
      setupStore();
      const { container } = render(<GameCameraInspector />);
      fireEvent.change(smoothingInput(container), { target: { value: '0' } });
      expect(mockSetGameCamera).toHaveBeenCalledWith(
        'entity-1',
        expect.objectContaining({ followSmoothing: 0 }),
      );
    });
  });

  it('shows fixed camera message for fixed mode', () => {
    setupStore({
      primaryGameCamera: { ...baseGameCamera, mode: 'fixed' as const },
    });
    render(<GameCameraInspector />);
    expect(screen.getByText(/Camera position is set via entity transform/)).toBeInTheDocument();
  });

  it('active checkbox is checked when this entity is the active camera', () => {
    setupStore({ activeGameCameraId: 'entity-1' });
    render(<GameCameraInspector />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  describe('accessible names', () => {
    /**
     * Every control's name as a screen reader would resolve it — `aria-label`,
     * else the text of the `<label for>` pointing at it. An empty string means
     * the control is announced as an unlabelled edit box.
     *
     * This is a structural sweep rather than a list of `getByLabelText` calls
     * because the panel grew eleven controls, none of which was associated with
     * the label sitting next to it: the labels were visually adjacent and read
     * fine sighted. A per-name test would have to be remembered for each new
     * parameter; this one fails automatically.
     */
    function controlNames(container: HTMLElement): string[] {
      return Array.from(container.querySelectorAll('input, select, textarea')).map((control) => {
        const aria = control.getAttribute('aria-label');
        if (aria) return aria.trim();
        const id = control.getAttribute('id');
        if (!id) return '';
        return container.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim() ?? '';
      });
    }

    // The three shared controls, then whatever the mode adds. Counting as well as
    // naming catches a row that renders with no control at all.
    const MODE_CONTROLS: Array<[GameCameraData['mode'], string[]]> = [
      ['thirdPersonFollow', ['Distance', 'Height', 'Smoothing']],
      ['firstPerson', ['Height', 'Mouse Sens.']],
      ['sideScroller', ['Distance']],
      ['topDown', ['Height']],
      ['fixed', []],
      ['orbital', ['Distance', 'Auto Rotate']],
    ];

    it.each(MODE_CONTROLS)('labels every control in %s mode', (mode, params) => {
      setupStore({ primaryGameCamera: { ...baseGameCamera, mode } });
      const { container } = render(<GameCameraInspector />);

      expect(controlNames(container)).toEqual(['Active', 'Mode', 'Target ID', ...params]);
    });

    it('gives each control its own id', () => {
      setupStore({ primaryGameCamera: { ...baseGameCamera, mode: 'thirdPersonFollow' } });
      const { container } = render(<GameCameraInspector />);

      // Two labels can carry the same text ("Distance" and "Height" each appear
      // in three modes), so the ids must be per-control rather than slugged from
      // the label — a duplicate would point two labels at one input.
      const ids = Array.from(container.querySelectorAll('input, select')).map((c) => c.getAttribute('id'));
      expect(ids.every((id) => id)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
