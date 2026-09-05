/**
 * Render tests for GenerateSoundDialog component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import { GenerateSoundDialog } from '../GenerateSoundDialog';
import { useUserStore } from '@/stores/userStore';
import { useEditorStore } from '@/stores/editorStore';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

// Capability gate (#9117): report "available" so these tests exercise the
// submit path; the gate itself is covered by useGenerationGate.test.tsx.
vi.mock('@/hooks/useGenerationGate', () => ({
  useGenerationGate: vi.fn(() => ({ blocked: false, reason: undefined, loading: false })),
}));

describe('GenerateSoundDialog', () => {
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
    const { container } = render(<GenerateSoundDialog isOpen={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Generate Sound heading', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Generate Sound')).toBeInTheDocument();
  });

  it('renders Sound Effect radio button', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Sound Effect')).toBeInTheDocument();
  });

  it('renders Voice radio button', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Voice')).toBeInTheDocument();
  });

  it('shows SFX prompt textarea by default', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByPlaceholderText('Sword clashing against metal shield')).toBeInTheDocument();
  });

  it('shows voice text textarea when Voice radio selected', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    const voiceRadios = screen.getAllByRole('radio');
    // Second radio is Voice
    fireEvent.click(voiceRadios[1]);
    expect(screen.getByPlaceholderText('Welcome, brave adventurer!')).toBeInTheDocument();
  });

  it('shows Voice Style select in voice mode', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    const voiceRadios = screen.getAllByRole('radio');
    fireEvent.click(voiceRadios[1]);
    expect(screen.getByText('Neutral')).toBeInTheDocument();
    expect(screen.getByText('Friendly')).toBeInTheDocument();
    expect(screen.getByText('Sinister')).toBeInTheDocument();
  });

  it('renders token cost of 20 for sfx', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('renders token cost of 40 for voice', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    const voiceRadios = screen.getAllByRole('radio');
    fireEvent.click(voiceRadios[1]);
    expect(screen.getByText('40')).toBeInTheDocument();
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
    expect(screen.getByText(/Auto-attach to/)).toBeInTheDocument();
    expect(screen.getByText('Player')).toBeInTheDocument();
  });

  it('hides auto-attach checkbox when no entityId', () => {
    render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.queryByText(/Auto-attach to/)).toBeNull();
  });

  /**
   * The response body is the only copy of the clip. This dialog used to POST,
   * throw the body away and report success, so a sound generated from the UI
   * spent the user's tokens and produced nothing at all.
   */
  describe('submit', () => {
    function respondWith(body: unknown, ok = true) {
      const fetchMock = vi.fn().mockResolvedValue({
        ok,
        json: async () => body,
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    async function generateSfx(entityId?: string) {
      setupStore(1000, 'Player');
      render(<GenerateSoundDialog isOpen={true} onClose={mockOnClose} entityId={entityId} />);
      fireEvent.change(screen.getByPlaceholderText('Sword clashing against metal shield'), {
        target: { value: 'Explosion with reverb' },
      });
      fireEvent.click(screen.getByText('Generate'));
    }

    it('imports the returned clip and attaches it to the entity', async () => {
      respondWith({ audioBase64: 'AAAA' });
      await generateSfx('entity-1');

      await waitFor(() => expect(importAudio).toHaveBeenCalledTimes(1));
      expect(importAudio).toHaveBeenCalledWith('AAAA', 'sfx-Explosion with rever');
      expect(setAudio).toHaveBeenCalledWith(
        'entity-1',
        expect.objectContaining({ assetId: 'sfx-Explosion with rever', bus: 'sfx' })
      );
      expect(toast.success).toHaveBeenCalledWith(
        'Sound generated and attached as "sfx-Explosion with rever".'
      );
    });

    it('imports without attaching when no entity is selected', async () => {
      respondWith({ audioBase64: 'AAAA' });
      await generateSfx();

      await waitFor(() => expect(importAudio).toHaveBeenCalledTimes(1));
      expect(setAudio).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith(
        'Sound generated and imported as "sfx-Explosion with rever".'
      );
    });

    it('reports a 200 that carries no clip as a failure, not a success', async () => {
      // A provider can answer 200 with nothing in it. Reporting that as success
      // is what leaves the user hunting for an asset that was never created.
      respondWith({});
      await generateSfx('entity-1');

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining('Sound effect generation produced no audio')
        )
      );
      expect(importAudio).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    });
  });
});
