/**
 * Render tests for GenerateModelDialog component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GenerateModelDialog } from '../GenerateModelDialog';
import { useUserStore } from '@/stores/userStore';

vi.mock('@/stores/userStore', () => ({
  useUserStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Sparkles: (props: Record<string, unknown>) => <span data-testid="sparkles-icon" {...props} />,
}));

describe('GenerateModelDialog', () => {
  const mockOnClose = vi.fn();

  function setupStore(balance = 1000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useUserStore).mockImplementation((selector: any) => {
      const state = {
        tokenBalance: balance !== null ? { total: balance, monthlyRemaining: balance, addon: 0 } : null,
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
    const { container } = render(<GenerateModelDialog isOpen={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Generate 3D Model heading', () => {
    render(<GenerateModelDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Generate 3D Model')).not.toBeNull();
  });

  it('renders Prompt textarea', () => {
    render(<GenerateModelDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByPlaceholderText(/medieval wooden treasure chest/)).not.toBeNull();
  });

  it('renders Art Style select', () => {
    render(<GenerateModelDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Realistic')).not.toBeNull();
    expect(screen.getByText('Cartoon')).not.toBeNull();
    expect(screen.getByText('Low Poly')).not.toBeNull();
  });

  it('renders Quality options', () => {
    render(<GenerateModelDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Standard (100 tokens)')).not.toBeNull();
    expect(screen.getByText('High (200 tokens)')).not.toBeNull();
  });

  it('renders Poly Budget options', () => {
    render(<GenerateModelDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('10K (Mobile-friendly)')).not.toBeNull();
    expect(screen.getByText('30K (Standard)')).not.toBeNull();
  });

  it('renders token cost display', () => {
    render(<GenerateModelDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Token cost:')).not.toBeNull();
    expect(screen.getByText('100')).not.toBeNull();
  });

  it('renders token balance display', () => {
    setupStore(5000);
    render(<GenerateModelDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('5000')).not.toBeNull();
  });

  it('renders Generate button disabled when prompt is empty', () => {
    render(<GenerateModelDialog isOpen={true} onClose={mockOnClose} />);
    const generateBtn = screen.getByText('Generate');
    expect(generateBtn).toBeDefined();
    // Button should be disabled when no prompt
    expect((generateBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Generate button when valid prompt entered', () => {
    render(<GenerateModelDialog isOpen={true} onClose={mockOnClose} />);
    const textarea = screen.getByPlaceholderText(/medieval wooden treasure chest/);
    fireEvent.change(textarea, { target: { value: 'A magical sword with glowing runes' } });
    const generateBtn = screen.getByText('Generate');
    expect((generateBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders Cancel button', () => {
    render(<GenerateModelDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Cancel')).not.toBeNull();
  });

  it('calls onClose when Cancel clicked', () => {
    render(<GenerateModelDialog isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when X clicked', () => {
    render(<GenerateModelDialog isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByTestId('x-icon'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('disables Generate when balance is insufficient', () => {
    setupStore(50); // less than 100 token cost
    render(<GenerateModelDialog isOpen={true} onClose={mockOnClose} />);
    const textarea = screen.getByPlaceholderText(/medieval wooden treasure chest/);
    fireEvent.change(textarea, { target: { value: 'A magical sword' } });
    const generateBtn = screen.getByText('Generate');
    expect((generateBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows prompt character count', () => {
    render(<GenerateModelDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('0/500')).not.toBeNull();
  });
});
