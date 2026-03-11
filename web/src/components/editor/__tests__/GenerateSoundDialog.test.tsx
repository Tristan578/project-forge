/**
 * Render tests for GenerateSoundDialog component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GenerateSoundDialog } from '../GenerateSoundDialog';
import { useUserStore } from '@/stores/userStore';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/userStore', () => ({
  useUserStore: vi.fn(),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Sparkles: (props: Record<string, unknown>) => <span data-testid="sparkles-icon" {...props} />,
}));

describe('GenerateSoundDialog', () => {
  const mockOnClose = vi.fn();

  function setupStore(balance = 1000, primaryName = '') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useUserStore).mockImplementation((selector: any) => {
      const state = {
        tokenBalance: { total: balance, monthlyRemaining: balance, addon: 0 },
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = { primaryName };
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

  it('returns null when isOpen is false', () => {
    const { container } = render(<GenerateSoundDialog isOpen={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Generate Sound heading', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Generate Sound')).toBeDefined();
  });

  it('renders Sound Effect radio button', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Sound Effect')).toBeDefined();
  });

  it('renders Voice radio button', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Voice')).toBeDefined();
  });

  it('shows SFX prompt textarea by default', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByPlaceholderText('Sword clashing against metal shield')).toBeDefined();
  });

  it('shows voice text textarea when Voice radio selected', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    const voiceRadios = screen.getAllByRole('radio');
    // Second radio is Voice
    fireEvent.click(voiceRadios[1]);
    expect(screen.getByPlaceholderText('Welcome, brave adventurer!')).toBeDefined();
  });

  it('shows Voice Style select in voice mode', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    const voiceRadios = screen.getAllByRole('radio');
    fireEvent.click(voiceRadios[1]);
    expect(screen.getByText('Neutral')).toBeDefined();
    expect(screen.getByText('Friendly')).toBeDefined();
    expect(screen.getByText('Sinister')).toBeDefined();
  });

  it('renders token cost of 20 for sfx', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('20')).toBeDefined();
  });

  it('renders token cost of 40 for voice', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    const voiceRadios = screen.getAllByRole('radio');
    fireEvent.click(voiceRadios[1]);
    expect(screen.getByText('40')).toBeDefined();
  });

  it('disables Generate when prompt is empty', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    const generateBtn = screen.getByText('Generate');
    expect((generateBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Generate when prompt is valid', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    const textarea = screen.getByPlaceholderText('Sword clashing against metal shield');
    fireEvent.change(textarea, { target: { value: 'Explosion with reverb' } });
    const generateBtn = screen.getByText('Generate');
    expect((generateBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls onClose when Cancel clicked', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when X clicked', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByTestId('x-icon'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows auto-attach checkbox when entityId provided', () => {
    setupStore(1000, 'Player');
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    expect(screen.getByText(/Auto-attach to/)).toBeDefined();
    expect(screen.getByText('Player')).toBeDefined();
  });

  it('hides auto-attach checkbox when no entityId', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.queryByText(/Auto-attach to/)).toBeNull();
  });
});
