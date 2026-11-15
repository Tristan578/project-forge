/**
 * Render tests for InputBindingsPanel component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { InputBindingsPanel } from '../InputBindingsPanel';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  Plus: (props: Record<string, unknown>) => <span data-testid="plus-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Keyboard: (props: Record<string, unknown>) => <span data-testid="keyboard-icon" {...props} />,
}));

describe('InputBindingsPanel', () => {
  const mockSetInputPreset = vi.fn();
  const mockSetInputBinding = vi.fn();
  const mockRemoveInputBinding = vi.fn();

  const defaultBindings = [
    { actionName: 'Jump', actionType: 'digital' as const, sources: ['Space'] },
    { actionName: 'MoveX', actionType: 'axis' as const, sources: [], positiveKeys: ['KeyD'], negativeKeys: ['KeyA'] },
  ];

  function setupMock(overrides: Record<string, unknown> = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        inputBindings: defaultBindings,
        inputPreset: 'fps',
        inputPresetByPlayer: { 0: 'fps' },
        engineMode: 'edit',
        setInputPreset: mockSetInputPreset,
        setInputBinding: mockSetInputBinding,
        removeInputBinding: mockRemoveInputBinding,
        ...overrides,
      };
      return selector(state);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupMock();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders collapsed by default with expand button', () => {
    render(<InputBindingsPanel />);
    const toggle = screen.getByRole('button', { name: /expand input bindings/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders "Input Bindings" label', () => {
    render(<InputBindingsPanel />);
    expect(screen.getByText('Input Bindings')).toBeInTheDocument();
  });

  it('expands when toggle is clicked', () => {
    render(<InputBindingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));

    const toggle = screen.getByRole('button', { name: /collapse input bindings/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows preset selector when expanded', () => {
    render(<InputBindingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));

    expect(screen.getByRole('combobox', { name: /input preset/i })).toBeInTheDocument();
    expect(screen.getByText('FPS')).toBeInTheDocument();
    expect(screen.getByText('Platformer')).toBeInTheDocument();
    expect(screen.getByText('Top-Down')).toBeInTheDocument();
  });

  it('shows binding action names when expanded', () => {
    render(<InputBindingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));

    expect(screen.getByText('Jump')).toBeInTheDocument();
    expect(screen.getByText('MoveX')).toBeInTheDocument();
  });

  it('shows key codes for digital bindings', () => {
    render(<InputBindingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));

    // formatKeyCode strips "Space" prefix — it stays as "Space" since it doesn't start with Key/Digit/Arrow
    expect(screen.getByText('Space')).toBeInTheDocument();
  });

  it('shows action type labels', () => {
    render(<InputBindingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));

    expect(screen.getByText('digital')).toBeInTheDocument();
    expect(screen.getByText('axis')).toBeInTheDocument();
  });

  it('shows remove button with aria-label in edit mode', () => {
    render(<InputBindingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));

    expect(screen.getByRole('button', { name: /remove jump binding/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove movex binding/i })).toBeInTheDocument();
  });

  it('calls removeInputBinding with the selected player slot', () => {
    render(<InputBindingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));
    fireEvent.click(screen.getByRole('button', { name: /remove jump binding/i }));

    // Player 1 (slot 0) is selected by default.
    expect(mockRemoveInputBinding).toHaveBeenCalledWith('Jump', 0);
  });

  it('hides remove buttons in play mode', () => {
    setupMock({ engineMode: 'play' });
    render(<InputBindingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));

    expect(screen.queryByRole('button', { name: /remove jump binding/i })).toBeNull();
  });

  it('disables preset selector in play mode', () => {
    setupMock({ engineMode: 'play' });
    render(<InputBindingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));

    const select = screen.getByRole('combobox', { name: /input preset/i });
    expect(select.hasAttribute('disabled')).toBe(true);
  });

  it('shows empty state when no bindings configured', () => {
    setupMock({ inputBindings: [] });
    render(<InputBindingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));

    expect(screen.getByText('No bindings configured')).toBeInTheDocument();
  });

  it('shows formatted key codes (strips Key prefix)', () => {
    setupMock({
      inputBindings: [
        { actionName: 'Forward', actionType: 'digital', sources: ['KeyW'] },
      ],
    });
    render(<InputBindingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));

    // formatKeyCode('KeyW') -> 'W'
    expect(screen.getByText('W')).toBeInTheDocument();
  });

  // OP-04: two local players each get an independently editable action map.
  describe('player-slot selector (physics.FR-1.OP-04)', () => {
    const twoPlayerBindings = [
      { actionName: 'Jump', actionType: 'digital' as const, sources: ['Space'] },        // player 0 (absent)
      { actionName: 'P2Attack', actionType: 'digital' as const, sources: ['Numpad0'], player: 1 },
    ];

    it('renders a Player 1 / Player 2 selector when expanded', () => {
      render(<InputBindingsPanel />);
      fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));

      expect(screen.getByRole('button', { name: 'Player 1' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Player 2' })).toBeInTheDocument();
    });

    it('shows only the selected player\'s bindings', () => {
      setupMock({ inputBindings: twoPlayerBindings });
      render(<InputBindingsPanel />);
      fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));

      // Player 1 is selected by default: its binding shows, player 2's does not.
      expect(screen.getByText('Jump')).toBeInTheDocument();
      expect(screen.queryByText('P2Attack')).toBeNull();

      // Switch to Player 2: now its binding shows and player 1's is hidden.
      fireEvent.click(screen.getByRole('button', { name: 'Player 2' }));
      expect(screen.getByText('P2Attack')).toBeInTheDocument();
      expect(screen.queryByText('Jump')).toBeNull();
    });

    it('removes a binding on the selected player 2 slot', () => {
      setupMock({ inputBindings: twoPlayerBindings });
      render(<InputBindingsPanel />);
      fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Player 2' }));
      fireEvent.click(screen.getByRole('button', { name: /remove p2attack binding/i }));

      expect(mockRemoveInputBinding).toHaveBeenCalledWith('P2Attack', 1);
    });

    it('adds a new binding tagged with the selected player slot', () => {
      setupMock({ inputBindings: twoPlayerBindings });
      render(<InputBindingsPanel />);
      fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Player 2' }));
      fireEvent.click(screen.getByRole('button', { name: /add binding/i }));
      fireEvent.change(screen.getByRole('textbox', { name: /new action name/i }), {
        target: { value: 'special' },
      });
      // The "Add" submit button inside the new-binding form.
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));

      expect(mockSetInputBinding).toHaveBeenCalledWith(
        expect.objectContaining({ actionName: 'special', player: 1 }),
      );
    });

    it('shows player 2\'s applied preset in the dropdown, not a permanent blank', () => {
      // Each slot's preset provenance lives in `inputPresetByPlayer`; the panel
      // reads the selected slot's value so player 2 is inspectable, not blanked.
      setupMock({
        inputBindings: twoPlayerBindings,
        inputPresetByPlayer: { 0: 'fps', 1: 'platformer' },
      });
      render(<InputBindingsPanel />);
      fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));

      const select = screen.getByRole('combobox', { name: /input preset/i }) as HTMLSelectElement;
      expect(select.value).toBe('fps');

      fireEvent.click(screen.getByRole('button', { name: 'Player 2' }));
      expect(select.value).toBe('platformer');
    });

    it('locks the player selector while a rebind capture is in flight', () => {
      render(<InputBindingsPanel />);
      fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));

      const player2 = screen.getByRole('button', { name: 'Player 2' }) as HTMLButtonElement;
      expect(player2.disabled).toBe(false);

      // Arm a rebind on Player 1's Jump action.
      fireEvent.click(screen.getByRole('button', { name: /rebind jump/i }));

      // Switching slots mid-capture would silently retarget the keypress, so the
      // selector is disabled until the capture completes or is cancelled.
      expect(player2.disabled).toBe(true);
      expect((screen.getByRole('button', { name: 'Player 1' }) as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
