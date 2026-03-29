/**
 * Render tests for GenerateMusicDialog component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GenerateMusicDialog } from '../GenerateMusicDialog';
import { useUserStore } from '@/stores/userStore';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/userStore', () => ({
  useUserStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Sparkles: (props: Record<string, unknown>) => <span data-testid="sparkles-icon" {...props} />,
}));

describe('GenerateMusicDialog', () => {
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
    const { container } = render(<GenerateMusicDialog isOpen={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Generate Music heading', () => {
    render(<GenerateMusicDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Generate Music')).toBeInTheDocument();
  });

  it('renders preview notice about Suno API', () => {
    render(<GenerateMusicDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText(/Music generation is in preview/)).toBeInTheDocument();
  });

  it('renders prompt textarea', () => {
    render(<GenerateMusicDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByPlaceholderText('Upbeat chiptune adventure music')).toBeInTheDocument();
  });

  it('renders Instrumental checkbox', () => {
    render(<GenerateMusicDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Instrumental (no vocals)')).toBeInTheDocument();
  });

  it('renders token cost of 80', () => {
    render(<GenerateMusicDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('80')).toBeInTheDocument();
  });

  it('disables Generate when prompt is empty', () => {
    render(<GenerateMusicDialog isOpen={true} onClose={mockOnClose} />);
    const generateBtn = screen.getByText('Generate');
    expect((generateBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Generate when valid prompt entered', () => {
    render(<GenerateMusicDialog isOpen={true} onClose={mockOnClose} />);
    const textarea = screen.getByPlaceholderText('Upbeat chiptune adventure music');
    fireEvent.change(textarea, { target: { value: 'Epic orchestral battle theme' } });
    const generateBtn = screen.getByText('Generate');
    expect((generateBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls onClose when Cancel clicked', () => {
    render(<GenerateMusicDialog isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when X clicked', () => {
    render(<GenerateMusicDialog isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByTestId('x-icon'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows auto-attach checkbox when entityId provided', () => {
    setupStore(1000, 'AudioEntity');
    render(<GenerateMusicDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    expect(screen.getByText(/Auto-attach to/)).toBeInTheDocument();
    expect(screen.getByText('AudioEntity')).toBeInTheDocument();
  });

  it('hides auto-attach checkbox when no entityId', () => {
    render(<GenerateMusicDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.queryByText(/Auto-attach to/)).toBeNull();
  });

  it('shows prompt character count', () => {
    render(<GenerateMusicDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('0/500')).toBeInTheDocument();
  });

  it('renders duration range slider', () => {
    render(<GenerateMusicDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText(/Duration:/)).toBeInTheDocument();
  });
});
