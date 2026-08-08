/**
 * Tests for GeneratePixelArtDialog — rendering, form controls,
 * submit behavior, token display, close behavior.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import { GeneratePixelArtDialog } from '../GeneratePixelArtDialog';
import { useGenerationStore } from '@/stores/generationStore';
import { useUserStore } from '@/stores/userStore';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/stores/generationStore', () => ({
  useGenerationStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/userStore', () => ({
  useUserStore: vi.fn(() => ({})),
}));

const mockAddJob = vi.fn();

function setupStores(overrides: { tokenBalance?: number } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useGenerationStore).mockImplementation((selector: any) => {
    const state = { addJob: mockAddJob };
    return selector(state);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useUserStore).mockImplementation((selector: any) => {
    const state = {
      tokenBalance: { total: overrides.tokenBalance ?? 100 },
    };
    return selector(state);
  });
}

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
};

describe('GeneratePixelArtDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStores();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Visibility ────────────────────────────────────────────────────────

  it('should not render when closed', () => {
    const { container } = render(
      <GeneratePixelArtDialog isOpen={false} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('should render when open', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText('Generate Pixel Art')).toBeInTheDocument();
  });

  // ── Form controls ─────────────────────────────────────────────────────

  it('should show prompt input', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(
      screen.getByPlaceholderText(/describe your pixel art/i),
    ).toBeInTheDocument();
  });

  it('should show style selector', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText('Style')).toBeInTheDocument();
    expect(screen.getByText('Character')).toBeInTheDocument();
  });

  it('should show size options', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText('16px')).toBeInTheDocument();
    expect(screen.getByText('32px')).toBeInTheDocument();
    expect(screen.getByText('64px')).toBeInTheDocument();
    expect(screen.getByText('128px')).toBeInTheDocument();
  });

  it('should show palette selector with preview swatches', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText('Palette')).toBeInTheDocument();
  });

  it('should show dithering selector', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText('Dithering')).toBeInTheDocument();
  });

  it('should show token cost and balance', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText(/Cost: 10 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/Balance: 100/)).toBeInTheDocument();
  });

  // ── Submit button state ───────────────────────────────────────────────

  it('should disable submit with empty prompt', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    const button = screen.getByRole('button', { name: /generate/i });
    expect(button).toHaveProperty('disabled', true);
  });

  it('should disable submit with short prompt', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    const input = screen.getByPlaceholderText(/describe your pixel art/i);
    fireEvent.change(input, { target: { value: 'ab' } });
    const button = screen.getByRole('button', { name: /generate/i });
    expect(button).toHaveProperty('disabled', true);
  });

  it('should enable submit with valid prompt', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    const input = screen.getByPlaceholderText(/describe your pixel art/i);
    fireEvent.change(input, { target: { value: 'a warrior knight with sword' } });
    const button = screen.getByRole('button', { name: /generate/i });
    expect(button).toHaveProperty('disabled', false);
  });

  it('should disable submit when token balance is too low', () => {
    setupStores({ tokenBalance: 5 });
    render(<GeneratePixelArtDialog {...defaultProps} />);
    const input = screen.getByPlaceholderText(/describe your pixel art/i);
    fireEvent.change(input, { target: { value: 'a warrior knight' } });
    const button = screen.getByRole('button', { name: /generate/i });
    expect(button).toHaveProperty('disabled', true);
  });

  // ── Close behavior ────────────────────────────────────────────────────

  it('should call onClose when X button is clicked', () => {
    const onClose = vi.fn();
    render(<GeneratePixelArtDialog isOpen={true} onClose={onClose} />);
    const headerButtons = document.querySelectorAll(
      '.flex.items-center.justify-between button',
    );
    fireEvent.click(headerButtons[0]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ── Size selection ────────────────────────────────────────────────────

  it('should highlight selected size', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    const btn32 = screen.getByText('32px');
    expect(btn32.className).toContain('bg-blue-600');
  });

  it('should change selected size on click', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    const btn64 = screen.getByText('64px');
    fireEvent.click(btn64);
    expect(btn64.className).toContain('bg-blue-600');
  });

  // ── Dithering intensity ───────────────────────────────────────────────

  it('should not show intensity slider when dithering is none', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.queryByText(/Intensity:/)).toBeNull();
  });

  // ── Failure surfacing ─────────────────────────────────────────────────
  //
  // The 503 a provider-succeeded-with-no-artifact produces carries the refund
  // disclosure in its body, so how this dialog surfaces a server error is a
  // correctness question, not a polish one — a message the user never sees is
  // a user who believes they were charged for nothing.

  /** Drives a real failed submit through useAIGeneration (not mocked here). */
  async function submitAgainst(body: unknown, status: number) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: async () => body,
      }),
    );
    render(<GeneratePixelArtDialog {...defaultProps} />);
    fireEvent.change(screen.getByPlaceholderText(/describe your pixel art/i), {
      target: { value: 'a warrior knight with sword' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
  }

  const EMPTY_ARTIFACT_503 =
    'Pixel art generation produced no image. Your tokens have been refunded — please try again.';

  it('announces a failed generation as an alert, verbatim', async () => {
    await submitAgainst({ error: EMPTY_ARTIFACT_503 }, 503);

    // getByRole('alert') rather than getByText: the dialog stays open and never
    // moves focus, so without the role the message is inserted silently and a
    // screen-reader user is left waiting on a request that already failed.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(EMPTY_ARTIFACT_503);
  });

  it('also toasts the failure, since the dialog body scrolls', async () => {
    await submitAgainst({ error: EMPTY_ARTIFACT_503 }, 503);

    // Every sibling Generate*Dialog does this. Inline-only meant a user who had
    // scrolled to the footer to click Generate could get no feedback at all.
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(EMPTY_ARTIFACT_503);
    });
  });

  it('keeps the dialog open on failure so the message can be read', async () => {
    const onClose = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: EMPTY_ARTIFACT_503 }),
      }),
    );
    render(<GeneratePixelArtDialog isOpen={true} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText(/describe your pixel art/i), {
      target: { value: 'a warrior knight with sword' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    await screen.findByRole('alert');
    expect(onClose).not.toHaveBeenCalled();
  });
});
