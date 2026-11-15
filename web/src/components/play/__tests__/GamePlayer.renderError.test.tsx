/**
 * The published-game player's handling of engine render errors (#8887).
 *
 * The engine emits `RENDER_ERROR` in the runtime build too
 * (`engine/src/bridge/mod.rs` registers the drain as always-active). Before
 * this, `GamePlayer`'s event callback only knew `INPUT_STATE_CHANGED`, so a
 * player who hit a GPU error got a frozen game with no explanation — the exact
 * silent failure the Bevy 0.19 migration exists to remove.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@/test/utils/componentTestUtils';
import { GamePlayer } from '../GamePlayer';
import { playRenderErrorActions } from '../PlayRenderErrorNotice';
import { loadPlayEngine } from '@/lib/engine/loadPlayEngine';
import { captureException } from '@/lib/monitoring/sentry-client';
import { playerRenderErrorCopy, type RenderErrorClass, type RenderErrorOutcome } from '@/lib/engine/renderErrorWire';
import { PLAY_ENGINE_SETTLE_MS } from '@/lib/config/timeouts';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/engine/loadPlayEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/engine/loadPlayEngine')>()),
  loadPlayEngine: vi.fn(),
}));

vi.mock('@/lib/monitoring/sentry-client', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  setTag: vi.fn(),
}));

const mockGame = {
  id: 'game-1',
  title: 'My Awesome Game',
  description: null,
  slug: 'my-awesome-game',
  version: 1,
  creatorName: 'Alice',
  sceneData: {},
};

const DETAIL = 'wgpu error: Validation Error: bind group layout mismatch';

const STOPPED_CASES = [
  ['validation', 'The game stopped drawing'],
  ['internal', 'The game stopped drawing'],
  ['outOfMemory', 'Your device ran out of graphics memory'],
  ['deviceLost', 'The game lost its connection to the graphics card'],
] as const;

async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Boot the player to a running game and return the engine's event callback. */
async function startGame(backendPath = '/engine-pkg-webgpu/') {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ game: mockGame }),
  }) as unknown as typeof global.fetch;
  let emit: ((event: unknown) => void) | null = null;
  const runtime = {
    init_engine: vi.fn(),
    handle_command: vi.fn().mockReturnValue({ success: true }),
    set_event_callback: vi.fn((cb: (event: unknown) => void) => {
      emit = cb;
    }),
  };
  vi.mocked(loadPlayEngine).mockImplementation(async (options) => {
    options?.onOriginUsed?.(backendPath);
    return runtime;
  });

  render(<GamePlayer userId="user-1" slug="my-awesome-game" />);
  await advance();
  fireEvent.click(screen.getByText('Click to play'));
  await advance(PLAY_ENGINE_SETTLE_MS);
  expect(runtime.handle_command).toHaveBeenCalledWith('play', {});
  expect(emit).not.toBeNull();
  // Nothing about a successful start may be reported.
  expect(captureException).not.toHaveBeenCalled();
  return (event: unknown) => act(() => emit!(event));
}

function renderError(errorClass: RenderErrorClass, outcome: RenderErrorOutcome, occurrence = 1) {
  // The shape `bridge/events.rs::emit_event` builds: `{ type, payload }`.
  return { type: 'RENDER_ERROR', payload: { errorClass, outcome, detail: DETAIL, occurrence } };
}

describe('GamePlayer render errors', () => {
  let reload: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    reload = vi.spyOn(playRenderErrorActions, 'reload').mockImplementation(() => {});
    delete (window as unknown as Record<string, unknown>).__forgeInputState;
  });

  afterEach(() => {
    reload.mockRestore();
    cleanup();
    vi.useRealTimers();
  });

  it('shows nothing while the game renders normally', async () => {
    await startGame();
    expect(screen.queryByTestId('play-render-error')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each(STOPPED_CASES)('%s/stopped: an assertive alert over the game with the exact player copy', async (errorClass, title) => {
    const emit = await startGame();
    await emit(renderError(errorClass, 'stopped'));

    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('data-error-class')).toBe(errorClass);
    expect(within(alert).getByRole('heading', { name: title })).toBeDefined();
    const copy = playerRenderErrorCopy(errorClass, 'stopped');
    expect(copy.title).toBe(title);
    expect(document.getElementById('play-render-error-body')?.textContent).toBe(copy.body);
    // The raw wgpu text is never primary text: only in the collapsed disclosure.
    expect(document.getElementById('play-render-error-body')?.textContent).not.toContain('bind group');
    expect(within(alert).getByRole('heading').textContent).not.toContain('bind group');
    const details = alert.querySelector('details');
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.querySelector('pre')?.textContent).toBe(DETAIL);
    // Covers the frozen canvas, inside the element that goes fullscreen.
    const canvasArea = document.getElementById('play-canvas')!.parentElement!;
    expect(canvasArea.contains(alert)).toBe(true);
  });

  it.each(STOPPED_CASES)('%s/stopped: cannot be dismissed; Reload game is focused and reloads', async (errorClass) => {
    const emit = await startGame();
    await emit(renderError(errorClass, 'stopped'));

    const alert = screen.getByRole('alert');
    expect(within(alert).queryByRole('button', { name: 'Dismiss' })).toBeNull();
    const reloadButton = within(alert).getByRole('button', { name: 'Reload game' });
    expect(document.activeElement).toBe(reloadButton);
    expect(reloadButton.className).toContain('min-h-[44px]');
    const leave = within(alert).getByRole('link', { name: 'Back to SpawnForge' });
    expect(leave.getAttribute('href')).toBe('/');
    expect(leave.className).toContain('min-h-[44px]');

    fireEvent.click(reloadButton);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('offers no backend switch, even on WebGPU: the player has no backend preference to set', async () => {
    const emit = await startGame('/engine-pkg-webgpu/');
    await emit(renderError('deviceLost', 'stopped'));

    const alert = screen.getByRole('alert');
    const actions = within(alert).getAllByRole('button').map((b) => b.textContent);
    expect(actions).toEqual(['Reload game']);
    expect(alert.textContent).not.toMatch(/WebGL|WebGPU/);
  });

  it('reports the error to Sentry with the raw detail and the backend that served', async () => {
    const emit = await startGame('https://engine.example.test/abc/engine-pkg-webgpu/');
    await emit(renderError('deviceLost', 'stopped', 3));

    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, context] = vi.mocked(captureException).mock.calls[0];
    expect(error).toEqual(new Error('Engine render error: GPU device lost (stopped)'));
    expect(context).toEqual({
      surface: 'play',
      phase: 'render',
      source: 'render_error_handler',
      errorClass: 'deviceLost',
      outcome: 'stopped',
      occurrence: 3,
      detail: DETAIL,
      engineBackend: 'webgpu',
      userId: 'user-1',
      slug: 'my-awesome-game',
    });
  });

  it('reads the event when the engine hands it over as a JSON string', async () => {
    const emit = await startGame('/engine-pkg-webgl2/');
    await emit(JSON.stringify(renderError('outOfMemory', 'stopped')));

    expect(screen.getByRole('alert').getAttribute('data-error-class')).toBe('outOfMemory');
    expect(vi.mocked(captureException).mock.calls[0][1]).toMatchObject({ engineBackend: 'webgl2' });
  });

  it.each(['validation', 'internal'] as const)(
    '%s/continued: a polite, dismissible note that does not take focus',
    async (errorClass) => {
      const emit = await startGame();
      const before = document.activeElement;
      await emit(renderError(errorClass, 'continued'));

      expect(screen.queryByRole('alert')).toBeNull();
      const status = screen.getByTestId('play-render-error');
      expect(status.getAttribute('role')).toBe('status');
      const copy = playerRenderErrorCopy(errorClass, 'continued');
      expect(within(status).getByRole('heading', { name: copy.title })).toBeDefined();
      expect(document.getElementById('play-render-error-body')?.textContent).toBe(copy.body);
      expect(document.activeElement).toBe(before);
      expect(captureException).toHaveBeenCalledTimes(1);

      fireEvent.click(within(status).getByRole('button', { name: 'Reload game' }));
      expect(reload).toHaveBeenCalledTimes(1);

      const dismiss = within(status).getByRole('button', { name: 'Dismiss' });
      expect(dismiss.className).toContain('min-h-[44px]');
      fireEvent.click(dismiss);
      expect(screen.queryByTestId('play-render-error')).toBeNull();
    },
  );

  it('counts repeated skipped errors in one note', async () => {
    const emit = await startGame();
    await emit(renderError('validation', 'continued', 1));
    expect(screen.queryByText(/This has happened/)).toBeNull();
    await emit(renderError('validation', 'continued', 2));
    expect(screen.getAllByTestId('play-render-error')).toHaveLength(1);
    expect(screen.getByText('This has happened 2 times.')).toBeDefined();
  });

  it('a stop replaces a skipped note, and a later skip cannot replace the stop', async () => {
    const emit = await startGame();
    await emit(renderError('internal', 'continued', 1));
    await emit(renderError('internal', 'stopped', 2));
    expect(screen.getByRole('alert').getAttribute('data-outcome')).toBe('stopped');
    await emit(renderError('internal', 'continued', 3));
    expect(screen.getByRole('alert').getAttribute('data-outcome')).toBe('stopped');
    expect(screen.getAllByTestId('play-render-error')).toHaveLength(1);
  });

  it('an unreadable RENDER_ERROR shows nothing but is reported', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const emit = await startGame();
      await emit({ type: 'RENDER_ERROR', payload: { errorClass: 'device_lost', outcome: 'stopped' } });
      expect(screen.queryByTestId('play-render-error')).toBeNull();
      expect(captureException).toHaveBeenCalledTimes(1);
      expect(vi.mocked(captureException).mock.calls[0][0]).toEqual(new Error('RENDER_ERROR payload was unreadable'));
      expect(vi.mocked(captureException).mock.calls[0][1]).toMatchObject({ surface: 'play', phase: 'render' });
    } finally {
      warn.mockRestore();
    }
  });

  it('INPUT_STATE_CHANGED still publishes the input state and shows no notice', async () => {
    const emit = await startGame();
    const event = { type: 'INPUT_STATE_CHANGED', payload: { pressed: ['Space'] } };
    await emit(event);
    // Unchanged behaviour: `data` when present, otherwise the whole event.
    expect((window as unknown as Record<string, unknown>).__forgeInputState).toEqual(event);
    await emit({ type: 'INPUT_STATE_CHANGED', data: { pressed: ['KeyW'] } });
    expect((window as unknown as Record<string, unknown>).__forgeInputState).toEqual({ pressed: ['KeyW'] });
    expect(screen.queryByTestId('play-render-error')).toBeNull();
    expect(captureException).not.toHaveBeenCalled();
  });
});
