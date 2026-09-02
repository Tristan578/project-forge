/**
 * Render tests for GamePlayer component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { waitFor, fireEvent, act } from '@testing-library/react';
import { GamePlayer } from '../GamePlayer';
import { loadPlayEngine } from '@/lib/engine/loadPlayEngine';
import { captureException } from '@/lib/monitoring/sentry-client';
import {
  ENGINE_GLOBAL_TIMEOUT_MS,
  PLAY_GAME_FETCH_TIMEOUT_MS,
  PLAY_ENGINE_SETTLE_MS,
} from '@/lib/config/timeouts';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: (props: Record<string, unknown>) => <span data-testid="arrow-left" {...props} />,
  Maximize: (props: Record<string, unknown>) => <span data-testid="maximize-icon" {...props} />,
  Minimize: (props: Record<string, unknown>) => <span data-testid="minimize-icon" {...props} />,
  Loader2: (props: Record<string, unknown>) => <span data-testid="loader-icon" {...props} />,
  Share2: (props: Record<string, unknown>) => <span data-testid="share-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  GitFork: (props: Record<string, unknown>) => <span data-testid="fork-icon" {...props} />,
  RotateCw: (props: Record<string, unknown>) => <span data-testid="retry-icon" {...props} />,
  Flag: (props: Record<string, unknown>) => <span data-testid="flag-icon" {...props} />,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/engine/loadPlayEngine', () => ({
  loadPlayEngine: vi.fn(),
}));

vi.mock('@/lib/monitoring/sentry-client', () => ({
  captureException: vi.fn(),
}));

const mockGame = {
  id: 'game-1',
  title: 'My Awesome Game',
  description: 'A cool game',
  slug: 'my-awesome-game',
  version: 1,
  creatorName: 'Alice',
  sceneData: {},
};

describe('GamePlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows loading spinner initially', () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {})); // never resolves
    render(<GamePlayer userId="user-1" slug="my-awesome-game" />);
    expect(screen.getByText('Loading game...')).toBeDefined();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe('');
  });

  it('shows loader icon while loading', () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    render(<GamePlayer userId="user-1" slug="my-awesome-game" />);
    expect(screen.getByTestId('loader-icon')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders game title after successful fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ game: mockGame }),
    });
    render(<GamePlayer userId="user-1" slug="my-awesome-game" />);
    await waitFor(() => {
      expect(screen.getByText('My Awesome Game')).toBeDefined();
    });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('renders creator name after successful fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ game: mockGame }),
    });
    render(<GamePlayer userId="user-1" slug="my-awesome-game" />);
    await waitFor(() => {
      expect(screen.getByText('by Alice')).toBeDefined();
    });
  });

  it('shows Click to play after successful fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ game: mockGame }),
    });
    render(<GamePlayer userId="user-1" slug="my-awesome-game" />);
    await waitFor(() => {
      expect(screen.getByText('Click to play')).toBeDefined();
    });
  });

  it('shows Game Not Found when fetch returns 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Game not found' }),
    });
    render(<GamePlayer userId="user-1" slug="nonexistent" />);
    await waitFor(() => {
      expect(screen.getByText('Game Not Found')).toBeDefined();
    });
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByText(':(')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('shows error message on failed fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Game not found' }),
    });
    render(<GamePlayer userId="user-1" slug="nonexistent" />);
    await waitFor(() => {
      expect(screen.getByText('Game not found')).toBeDefined();
    });
  });

  it('shows Back to SpawnForge link on error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Game not found' }),
    });
    render(<GamePlayer userId="user-1" slug="nonexistent" />);
    await waitFor(() => {
      expect(screen.getByText('Back to SpawnForge')).toBeDefined();
    });
  });

  it('shows Something Went Wrong for non-404 errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    });
    render(<GamePlayer userId="user-1" slug="some-game" />);
    await waitFor(() => {
      expect(screen.getByText('Something Went Wrong')).toBeDefined();
    });
  });

  it('shows network error message on fetch exception', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));
    render(<GamePlayer userId="user-1" slug="some-game" />);
    await waitFor(() => {
      expect(screen.getByText('Network error -- could not load game')).toBeDefined();
    });
  });

  it('renders fullscreen button after game loads', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ game: mockGame }),
    });
    render(<GamePlayer userId="user-1" slug="my-awesome-game" />);
    await waitFor(() => {
      expect(screen.getByTestId('maximize-icon')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Bounded loading (PF-1017 family / #9055)
  //
  // Both the metadata fetch and engine init used to be unbounded: a request or
  // a WASM load that never settled left the user on a spinner forever with no
  // error, no retry, and no telemetry.
  // -------------------------------------------------------------------------
  describe('bounded loading', () => {
    /** A fetch that only ever settles by being aborted. */
    function stallingFetch() {
      return vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
      );
    }

    function okFetch() {
      return vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ game: mockGame }),
      });
    }

    function stubRuntime() {
      return {
        init_engine: vi.fn(),
        handle_command: vi.fn(),
        set_event_callback: vi.fn(),
      };
    }

    /**
     * Advance fake timers and flush the microtask queue inside `act`.
     *
     * RTL's `waitFor` cannot be used under vitest fake timers: its fake-timer
     * branch is gated on a global `jest` object, so with vitest it falls back
     * to a real `setInterval` that the frozen clock never fires — the poll
     * spins until the test times out. Driving the clock explicitly is both
     * deterministic and faster.
     */
    async function advance(ms = 0) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }

    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.useFakeTimers();
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
      vi.useRealTimers();
    });

    it('surfaces an error when the game fetch never settles', async () => {
      global.fetch = stallingFetch() as unknown as typeof global.fetch;
      render(<GamePlayer userId="user-1" slug="my-awesome-game" />);

      expect(screen.getByText('Loading game...')).toBeDefined();

      await advance(PLAY_GAME_FETCH_TIMEOUT_MS);

      expect(screen.getByText('Something Went Wrong')).toBeDefined();
      expect(captureException).toHaveBeenCalledTimes(1);
    });

    it('does not report an abort caused by unmount', async () => {
      global.fetch = stallingFetch() as unknown as typeof global.fetch;
      const { unmount } = render(<GamePlayer userId="user-1" slug="my-awesome-game" />);

      unmount();
      await advance(PLAY_GAME_FETCH_TIMEOUT_MS * 2);

      expect(captureException).not.toHaveBeenCalled();
    });

    it('bounds engine init and offers a retry when the load never settles', async () => {
      global.fetch = okFetch();
      vi.mocked(loadPlayEngine).mockReturnValue(new Promise(() => {}));

      render(<GamePlayer userId="user-1" slug="my-awesome-game" />);
      await advance();
      expect(screen.getByText('Click to play')).toBeDefined();

      fireEvent.click(screen.getByText('Click to play'));
      expect(screen.getByText('Starting engine...')).toBeDefined();
      expect(screen.getByTestId('loader-icon')).toHaveAttribute('aria-hidden', 'true');

      await advance(ENGINE_GLOBAL_TIMEOUT_MS);

      expect(
        screen.getByText(`Game engine load timed out after ${ENGINE_GLOBAL_TIMEOUT_MS}ms`),
      ).toBeDefined();
      // Exactly one report — not one per await in the init sequence.
      expect(captureException).toHaveBeenCalledTimes(1);
      // init_engine never ran, so restarting is safe and must be offered.
      expect(screen.getByText('Try again')).toBeDefined();
    });

    it('reports nothing to Sentry on the happy path', async () => {
      global.fetch = okFetch();
      const runtime = stubRuntime();
      vi.mocked(loadPlayEngine).mockResolvedValue(runtime);

      render(<GamePlayer userId="user-1" slug="my-awesome-game" />);
      await advance();
      fireEvent.click(screen.getByText('Click to play'));
      await advance(PLAY_ENGINE_SETTLE_MS);

      expect(runtime.handle_command).toHaveBeenCalledWith('play', '{}');
      expect(captureException).not.toHaveBeenCalled();
      expect(screen.queryByText('Starting engine...')).toBeNull();
    });

    it('does not offer a retry once the engine has taken the canvas', async () => {
      global.fetch = okFetch();
      const runtime = stubRuntime();
      runtime.handle_command.mockImplementation((command: string) => {
        if (command === 'load_scene') throw new Error('scene rejected');
      });
      vi.mocked(loadPlayEngine).mockResolvedValue(runtime);

      render(<GamePlayer userId="user-1" slug="my-awesome-game" />);
      await advance();
      fireEvent.click(screen.getByText('Click to play'));
      await advance();

      expect(screen.getByText('scene rejected')).toBeDefined();
      expect(runtime.init_engine).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Try again')).toBeNull();
    });
  });
});
