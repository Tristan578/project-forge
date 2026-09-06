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
  Loader2: (props: Record<string, unknown>) => <span data-testid="loader-icon" {...props} />,
}));

// Capability gate (#9117): report "available" so these tests exercise the
// submit path; the gate itself is covered by useGenerationGate.test.tsx.
import { useGenerationGate } from '@/hooks/useGenerationGate';
vi.mock('@/hooks/useGenerationGate', () => ({
  useGenerationGate: vi.fn(() => ({ blocked: false, reason: undefined, loading: false, unprovisionable: false })),
}));

describe('GenerateTextureDialog capability gate (#9117)', () => {
  beforeEach(() => {
    vi.mocked(useUserStore).mockImplementation(((selector: (s: unknown) => unknown) =>
      selector({ tokenBalance: { total: 1000, monthlyRemaining: 1000, addon: 0 } })) as never);
    vi.mocked(useEditorStore).mockImplementation(((selector: (s: unknown) => unknown) =>
      selector({ primaryName: '' })) as never);
  });
  afterEach(() => {
    cleanup();
    vi.mocked(useGenerationGate).mockReturnValue({ blocked: false, reason: undefined, loading: false, unprovisionable: false });
  });

  it('asks the gate for texture-generation', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={vi.fn()} entityId="e1" />);
    expect(useGenerationGate).toHaveBeenCalledWith('texture-generation');
  });

  it('shows the notice, disables inputs and Generate when blocked', () => {
    vi.mocked(useGenerationGate).mockReturnValue({ blocked: true, reason: 'Not available yet.', loading: false, unprovisionable: false });
    render(<GenerateTextureDialog isOpen={true} onClose={vi.fn()} entityId="e1" />);
    expect(screen.getByRole('status')).toHaveAttribute('id', 'generate-texture-unavailable');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-describedby', 'generate-texture-unavailable');
    expect(screen.getByText('Generate').closest('button')).toBeDisabled();
    expect(screen.getByPlaceholderText(/brick wall/i)).toBeDisabled();
  });
});

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
    expect(screen.getByText('Generate Texture')).toBeInTheDocument();
  });

  it('renders prompt textarea', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    expect(screen.getByPlaceholderText('Weathered red brick wall with moss')).toBeInTheDocument();
  });

  it('renders Resolution select with 1024x1024 and 2048x2048 options', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    expect(screen.getByText('1024x1024')).toBeInTheDocument();
    expect(screen.getByText('2048x2048')).toBeInTheDocument();
  });

  it('renders Style options (Realistic, Stylized, Cartoon)', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    expect(screen.getByText('Realistic')).toBeInTheDocument();
    expect(screen.getByText('Stylized')).toBeInTheDocument();
    expect(screen.getByText('Cartoon')).toBeInTheDocument();
  });

  it('renders Tiling checkbox', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);
  });

  it('renders token cost of 30', () => {
    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    expect(screen.getByText('30')).toBeInTheDocument();
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
    expect(screen.getByText(/Apply to:/)).toBeInTheDocument();
    expect(screen.getByText('Cube')).toBeInTheDocument();
  });

  it('shows Submitting spinner and aria-busy on submit button while fetch is pending (PF-176 loading states)', async () => {
    // Freeze fetch so the submitting state is held open
    let resolveFetch!: () => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = () => resolve(new Response(JSON.stringify({ jobId: 'j1' }), { status: 200 }));
    });
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pendingFetch);

    render(<GenerateTextureDialog isOpen={true} onClose={mockOnClose} entityId="entity-1" />);
    const textarea = screen.getByPlaceholderText('Weathered red brick wall with moss');
    fireEvent.change(textarea, { target: { value: 'Rocky cliff face texture' } });
    const generateBtn = screen.getByRole('button', { name: /generate/i });
    fireEvent.click(generateBtn);

    // While in-flight the spinner icon must be visible and the button aria-busy
    expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    const submitBtn = screen.getByRole('button', { name: /submitting/i });
    expect(submitBtn.getAttribute('aria-busy')).toBe('true');

    // Resolve to avoid open handles
    resolveFetch();
    vi.restoreAllMocks();
  });
});
