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

  it('calls removeInputBinding when remove button is clicked', () => {
    render(<InputBindingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /expand input bindings/i }));
    fireEvent.click(screen.getByRole('button', { name: /remove jump binding/i }));

    expect(mockRemoveInputBinding).toHaveBeenCalledWith('Jump');
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
});
