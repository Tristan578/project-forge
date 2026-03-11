/**
 * Render tests for GenerateSkyboxDialog component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GenerateSkyboxDialog } from '../GenerateSkyboxDialog';
import { useUserStore } from '@/stores/userStore';

vi.mock('@/stores/userStore', () => ({
  useUserStore: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Sparkles: (props: Record<string, unknown>) => <span data-testid="sparkles-icon" {...props} />,
}));

describe('GenerateSkyboxDialog', () => {
  const mockOnClose = vi.fn();

  function setupStore(balance = 1000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useUserStore).mockImplementation((selector: any) => {
      const state = {
        tokenBalance: { total: balance, monthlyRemaining: balance, addon: 0 },
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

  it('returns null when isOpen is false', () => {
    const { container } = render(<GenerateSkyboxDialog isOpen={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Generate Skybox heading', () => {
    render(<GenerateSkyboxDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Generate Skybox')).toBeDefined();
  });

  it('renders style options (Realistic, Fantasy, Sci-Fi, Cartoon)', () => {
    render(<GenerateSkyboxDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Realistic')).toBeDefined();
    expect(screen.getByText('Fantasy')).toBeDefined();
    expect(screen.getByText('Cartoon')).toBeDefined();
  });

  it('renders token cost of 50', () => {
    render(<GenerateSkyboxDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('50')).toBeDefined();
  });

  it('disables Generate when prompt is empty', () => {
    render(<GenerateSkyboxDialog isOpen={true} onClose={mockOnClose} />);
    const generateBtn = screen.getByText('Generate');
    expect((generateBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Generate when valid prompt entered', () => {
    render(<GenerateSkyboxDialog isOpen={true} onClose={mockOnClose} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Alien planet with two moons' } });
    const generateBtn = screen.getByText('Generate');
    expect((generateBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls onClose when Cancel clicked', () => {
    render(<GenerateSkyboxDialog isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when X clicked', () => {
    render(<GenerateSkyboxDialog isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByTestId('x-icon'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('disables Generate when balance is insufficient', () => {
    setupStore(30); // less than 50 token cost
    render(<GenerateSkyboxDialog isOpen={true} onClose={mockOnClose} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Dramatic stormy sky' } });
    const generateBtn = screen.getByText('Generate');
    expect((generateBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
