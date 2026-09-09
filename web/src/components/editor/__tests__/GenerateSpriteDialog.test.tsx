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

// Capability gate (#9117): report "available" so these tests exercise the
// submit path; the gate itself is covered by useGenerationGate.test.tsx.
import { useGenerationGate } from '@/hooks/useGenerationGate';
import { spriteTokenCost } from '@/lib/config/providers';
vi.mock('@/hooks/useGenerationGate', () => ({
  useGenerationGate: vi.fn(() => ({ blocked: false, reason: undefined, loading: false, unprovisionable: false, byokConfigurable: false })),
}));

describe('GenerateSpriteDialog capability gate (#9117)', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(useGenerationGate).mockReturnValue({ blocked: false, reason: undefined, loading: false, unprovisionable: false, byokConfigurable: false });
  });

  it('asks the gate for sprite-generation', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={vi.fn()} />);
    expect(useGenerationGate).toHaveBeenCalledWith('sprite-generation');
  });

  it('shows the notice and disables Generate when blocked', () => {
    vi.mocked(useGenerationGate).mockReturnValue({ blocked: true, reason: 'Not available yet.', loading: false, unprovisionable: false, byokConfigurable: false });
    render(<GenerateSpriteDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveAttribute('id', 'generate-sprite-unavailable');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-describedby', 'generate-sprite-unavailable');
    expect(screen.getByText('Generate').closest('button')).toBeDisabled();
    expect(screen.getByRole('textbox')).toBeDisabled();
    for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled();
  });
});

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
    expect(screen.getByText('Generate Sprite')).toBeInTheDocument();
  });

  it('renders Single Sprite/Sprite Sheet/Tileset tabs', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Single Sprite')).toBeInTheDocument();
    expect(screen.getByText('Sprite Sheet')).toBeInTheDocument();
    expect(screen.getByText('Tileset')).toBeInTheDocument();
  });

  it('shows style options (Pixel Art, Hand-Drawn, etc.)', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Pixel Art')).toBeInTheDocument();
    expect(screen.getByText('Hand-Drawn')).toBeInTheDocument();
    expect(screen.getByText('Vector')).toBeInTheDocument();
  });

  // This asserted 15, which is the number that shipped and is neither
  // provider's price (#9741). The dialog defaults to the pixel-art style, which
  // the route resolves to SDXL and charges 10 for; a DALL-E style costs 20. The
  // old assertion could only pass while the quote disagreed with the charge.
  it('quotes the price of the provider the default style resolves to', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText(String(spriteTokenCost('pixel-art')))).toBeInTheDocument();
    expect(screen.queryByText('15')).not.toBeInTheDocument();
  });

  it('re-quotes when the style changes provider', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText(String(spriteTokenCost('pixel-art')))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Style'), { target: { value: 'realistic' } });

    // 20, not 10 — and the point of the test is that the number MOVED.
    expect(screen.getByText(String(spriteTokenCost('realistic')))).toBeInTheDocument();
    expect(spriteTokenCost('realistic')).not.toBe(spriteTokenCost('pixel-art'));
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
    expect(screen.getByText('50')).toBeInTheDocument();
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
    expect(screen.getByText(/Frame Count/)).toBeInTheDocument();
  });

  it('shows tile size option in Tileset tab', () => {
    render(<GenerateSpriteDialog isOpen={true} onClose={mockOnClose} />);
    const tilesetTabs = screen.getAllByText('Tileset');
    fireEvent.click(tilesetTabs[0]);
    expect(screen.getByText(/Tile Size/)).toBeInTheDocument();
  });
});
