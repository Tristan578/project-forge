/**
 * Render tests for GenerateSpriteDialog component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GenerateSpriteDialog } from '../GenerateSpriteDialog';
import { useUserStore } from '@/stores/userStore';
import { useGenerationStore } from '@/stores/generationStore';

vi.mock('@/stores/userStore', () => ({
  useUserStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/generationStore', () => ({
  useGenerationStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Sparkles: (props: Record<string, unknown>) => <span data-testid="sparkles-icon" {...props} />,
}));

describe('GenerateSpriteDialog', () => {
  const mockOnClose = vi.fn();
  const mockAddJob = vi.fn();

  function setupStore(balance = 1000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useUserStore).mockImplementation((selector: any) => {
      const state = {
        tokenBalance: { total: balance, monthlyRemaining: balance, addon: 0 },
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useGenerationStore).mockImplementation((selector: any) => {
      const state = { addJob: mockAddJob };
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
    const { container } = render(<GenerateSpriteDialog isOpen={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Generate Sprite heading', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Generate Sprite')).toBeDefined();
  });

  it('renders Single Sprite/Sprite Sheet/Tileset tabs', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Single Sprite')).toBeDefined();
    expect(screen.getByText('Sprite Sheet')).toBeDefined();
    expect(screen.getByText('Tileset')).toBeDefined();
  });

  it('shows style options (Pixel Art, Hand-Drawn, etc.)', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Pixel Art')).toBeDefined();
    expect(screen.getByText('Hand-Drawn')).toBeDefined();
    expect(screen.getByText('Vector')).toBeDefined();
  });

  it('renders token cost of 15 for single sprite', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('15')).toBeDefined();
  });

  it('disables Generate when prompt is empty', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={mockOnClose} />);
    const generateBtn = screen.getByText('Generate');
    expect((generateBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Generate when valid prompt entered', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={mockOnClose} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Knight character walking' } });
    const generateBtn = screen.getByText('Generate');
    expect((generateBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows higher token cost for tileset tab', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={mockOnClose} />);
    // Tileset tab shows 50 token cost
    const tilesetTabs = screen.getAllByText('Tileset');
    fireEvent.click(tilesetTabs[0]);
    expect(screen.getByText('50')).toBeDefined();
  });

  it('calls onClose when Cancel clicked', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when X clicked', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByTestId('x-icon'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows frame count option in Sheet tab', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Sprite Sheet'));
    expect(screen.getByText(/Frame Count/)).toBeDefined();
  });

  it('shows tile size option in Tileset tab', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={mockOnClose} />);
    const tilesetTabs = screen.getAllByText('Tileset');
    fireEvent.click(tilesetTabs[0]);
    expect(screen.getByText(/Tile Size/)).toBeDefined();
  });
});
