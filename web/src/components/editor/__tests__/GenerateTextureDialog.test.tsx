/**
 * Render tests for GenerateTextureDialog component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GenerateTextureDialog } from '../GenerateTextureDialog';
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

describe('GenerateTextureDialog', () => {
  const mockOnClose = vi.fn();

  function setupStore(balance = 1000, primaryName = 'Cube') {
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
    const { container } = render(<GenerateTextureDialog isOpen={false} onClose={mockOnClose} entityId="entity-1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Generate Texture heading', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    expect(screen.getByText('Generate Texture')).not.toBeNull();
  });

  it('renders prompt textarea', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    expect(screen.getByPlaceholderText('Weathered red brick wall with moss')).not.toBeNull();
  });

  it('renders Resolution select with 1024x1024 and 2048x2048 options', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    expect(screen.getByText('1024x1024')).not.toBeNull();
    expect(screen.getByText('2048x2048')).not.toBeNull();
  });

  it('renders Style options (Realistic, Stylized, Cartoon)', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    expect(screen.getByText('Realistic')).not.toBeNull();
    expect(screen.getByText('Stylized')).not.toBeNull();
    expect(screen.getByText('Cartoon')).not.toBeNull();
  });

  it('renders Tiling checkbox', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);
  });

  it('renders token cost of 30', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    expect(screen.getByText('30')).not.toBeNull();
  });

  it('disables Generate when prompt empty', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    const generateBtn = screen.getByText('Generate');
    expect((generateBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Generate when valid prompt entered', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    const textarea = screen.getByPlaceholderText('Weathered red brick wall with moss');
    fireEvent.change(textarea, { target: { value: 'Rough stone brickwork with moss' } });
    const generateBtn = screen.getByText('Generate');
    expect((generateBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls onClose when Cancel clicked', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when X clicked', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    fireEvent.click(screen.getByTestId('x-icon'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows Apply to entity name', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    expect(screen.getByText(/Apply to:/)).not.toBeNull();
    expect(screen.getByText('Cube')).not.toBeNull();
  });
});
