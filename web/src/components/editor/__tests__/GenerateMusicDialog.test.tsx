/**
 * Render tests for GenerateMusicDialog component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import { GenerateMusicDialog } from '../GenerateMusicDialog';
import { useUserStore } from '@/stores/userStore';
import { useEditorStore } from '@/stores/editorStore';
import { toast } from 'sonner';
import { trackJob } from '@/lib/chat/handlers/generationHandlers';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/chat/handlers/generationHandlers', () => ({
  trackJob: vi.fn(),
  makeJobId: vi.fn(() => 'job-local-1'),
}));

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

// Capability gate (#9117): default to "available" so the submit tests below
// exercise the real path; the unavailable cases flip it explicitly.
vi.mock('@/hooks/useGenerationGate', () => ({
  useGenerationGate: vi.fn(() => ({ blocked: false, reason: undefined, loading: false })),
}));
import { useGenerationGate } from '@/hooks/useGenerationGate';

describe('GenerateMusicDialog capability gate (#9117)', () => {
  beforeEach(() => {
    vi.mocked(useUserStore).mockImplementation(((selector: (s: unknown) => unknown) =>
      selector({ tokenBalance: { total: 1000, monthlyRemaining: 1000, addon: 0 } })) as never);
    vi.mocked(useEditorStore).mockImplementation(((selector: (s: unknown) => unknown) =>
      selector({ primaryName: '' })) as never);
  });
  afterEach(() => {
    cleanup();
    vi.mocked(useGenerationGate).mockReturnValue({ blocked: false, reason: undefined, loading: false });
  });

  it('shows the unavailable notice and disables Generate when the capability is unavailable', () => {
    vi.mocked(useGenerationGate).mockReturnValue({
      blocked: true,
      reason: 'Music generation is unavailable (#9522).',
      loading: false,
    });
    render(<GenerateMusicDialog isOpen={true} onClose={vi.fn()} />);
    expect(useGenerationGate).toHaveBeenCalledWith('music-generation');
    expect(screen.getByRole('status')).toHaveTextContent('Music generation is unavailable (#9522).');
    fireEvent.change(screen.getByPlaceholderText(/chiptune/i), { target: { value: 'a valid prompt' } });
    expect(screen.getByText('Generate').closest('button')).toBeDisabled();
  });

  it('renders no notice when the capability is available', () => {
    render(<GenerateMusicDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('GenerateMusicDialog', () => {
  const mockOnClose = vi.fn();
  const importAudio = vi.fn();
  const setAudio = vi.fn();

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
    // The submit path reaches for the store imperatively, outside React.
    vi.mocked(useEditorStore).getState = vi.fn(() => ({ importAudio, setAudio })) as never;
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

  /**
   * Music answers in two shapes — a finished clip, or a provider job id to poll
   * — and this dialog used to discard both. The sync path threw the only copy
   * of the track away; the async path never registered the job, so nothing ever
   * polled for it and the finished track never arrived.
   */
  describe('submit', () => {
    function respondWith(body: unknown, ok = true) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => body }));
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function generate(entityId?: string) {
      setupStore(1000, 'AudioEntity');
      render(<GenerateMusicDialog isOpen={true} onClose={mockOnClose} entityId={entityId} />);
      fireEvent.change(screen.getByPlaceholderText('Upbeat chiptune adventure music'), {
        target: { value: 'tense dungeon theme' },
      });
      fireEvent.click(screen.getByText('Generate'));
    }

    it('imports a clip returned inline and attaches it as a looping bed', async () => {
      respondWith({ audioBase64: 'AAAA' });
      generate('entity-1');

      await waitFor(() => expect(importAudio).toHaveBeenCalledTimes(1));
      expect(importAudio).toHaveBeenCalledWith('AAAA', 'music-tense dungeon theme');
      expect(setAudio).toHaveBeenCalledWith(
        'entity-1',
        expect.objectContaining({ bus: 'music', loopAudio: true, autoplay: true })
      );
      expect(trackJob).not.toHaveBeenCalled();
    });

    it('registers the async job so something eventually polls for the track', async () => {
      respondWith({ jobId: 'suno-42', provider: 'suno', usageId: 'usage-9' });
      generate('entity-1');

      await waitFor(() => expect(trackJob).toHaveBeenCalledTimes(1));
      expect(trackJob).toHaveBeenCalledWith(
        expect.objectContaining({
          providerJobId: 'suno-42',
          type: 'music',
          provider: 'suno',
          usageId: 'usage-9',
          autoPlace: true,
          targetEntityId: 'entity-1',
        })
      );
      expect(importAudio).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith(
        'Music generation started. It will be imported when it finishes.'
      );
    });

    it('reports a 200 with neither a clip nor a job as a failure', async () => {
      respondWith({});
      generate('entity-1');

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining('Music generation produced no audio')
        )
      );
      expect(trackJob).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    });
  });
});
