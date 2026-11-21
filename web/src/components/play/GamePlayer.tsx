'use client';

import { useEffect, useState, useRef, useCallback, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowLeft, Maximize, Minimize, Loader2, RotateCw } from 'lucide-react';
import { ShareButtons } from './ShareButtons';
import { RemixButton } from './RemixButton';
import { ReportGameDialog } from './ReportGameDialog';
import { withTimeout } from '@/lib/async/withTimeout';
import { loadPlayEngine, type PlayEngineRuntime } from '@/lib/engine/loadPlayEngine';
import { captureException } from '@/lib/monitoring/sentry-client';
import {
  ENGINE_GLOBAL_TIMEOUT_MS,
  PLAY_GAME_FETCH_TIMEOUT_MS,
  PLAY_ENGINE_SETTLE_MS,
} from '@/lib/config/timeouts';

const CANVAS_ID = 'play-canvas';

// The document URL never changes for the lifetime of this component (a play
// page is a full navigation), so there is nothing to subscribe to.
function subscribeToNothing(): () => void {
  return () => {};
}
function getShareUrlSnapshot(): string {
  return window.location.href;
}
function getServerShareUrlSnapshot(): string {
  return '';
}

interface GameData {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  version: number;
  creatorName: string;
  sceneData: unknown;
}

interface GamePlayerProps {
  userId: string;
  slug: string;
  isAuthenticated?: boolean;
}

export function GamePlayer({ userId, slug, isAuthenticated = false }: GamePlayerProps) {
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [engineState, setEngineState] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [clickToStart, setClickToStart] = useState(false);
  // Only offered when the failure happened BEFORE init_engine ran. Re-entering
  // init_engine on an already-initialized Bevy app is not a supported restart.
  const [canRetry, setCanRetry] = useState(false);
  // shareUrl must come from the browser — window.location.href is undefined
  // during SSR, so reading it at render time causes a hydration mismatch
  // (server: '', client: actual URL). An empty string also throws in addUtm's
  // new URL() call, so ShareButtons is only rendered once the URL is known.
  // useSyncExternalStore gives React both snapshots explicitly: the server one
  // is used for SSR and hydration, the client one for every render after, with
  // no state write and so no extra render pass.
  const shareUrl = useSyncExternalStore(
    subscribeToNothing,
    getShareUrlSnapshot,
    getServerShareUrlSnapshot
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const initStartedRef = useRef(false);
  // Set once init_engine has been handed the canvas — from that point the Bevy
  // app owns it and a retry would double-initialize.
  const engineOwnsCanvasRef = useRef(false);
  const cancelledRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset on mount, not just on unmount: StrictMode double-mounts in dev, and a
  // latch that only ever sets `true` would leave the second mount permanently
  // cancelled — the engine would never report ready locally.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    };
  }, []);

  // Fetch game data from the API
  useEffect(() => {
    // Bounded so a stalled request can't leave "Loading game..." spinning
    // forever. Aborting on unmount also stops the setState-after-unmount path.
    const controller = new AbortController();
    const deadline = setTimeout(
      () => controller.abort(new Error('timeout')),
      PLAY_GAME_FETCH_TIMEOUT_MS,
    );

    async function fetchGame() {
      try {
        const res = await fetch(
          `/api/play/${encodeURIComponent(userId)}/${encodeURIComponent(slug)}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Failed to load game' }));
          setError(data.error || 'Game not found');
          setLoading(false);
          return;
        }
        const data = await res.json();
        setGameData(data.game);
        setLoading(false);
        setClickToStart(true);
      } catch (err) {
        // An abort raised by unmount must not paint an error over a gone view;
        // an abort raised by the deadline must.
        if (controller.signal.aborted && cancelledRef.current) return;
        if (controller.signal.aborted) {
          const timeoutErr = new Error(
            `Loading this game took longer than ${PLAY_GAME_FETCH_TIMEOUT_MS / 1000}s`,
          );
          captureException(timeoutErr, { surface: 'play', phase: 'fetch', userId, slug });
          setError(timeoutErr.message);
          setLoading(false);
          return;
        }
        void err;
        setError('Network error -- could not load game');
        setLoading(false);
      } finally {
        clearTimeout(deadline);
      }
    }

    void fetchGame();

    return () => {
      clearTimeout(deadline);
      controller.abort();
    };
  }, [userId, slug]);

  // Initialize the WASM engine and start the game
  const initEngine = useCallback(async () => {
    if (!gameData || initStartedRef.current) return;
    initStartedRef.current = true;
    setClickToStart(false);
    setEngineState('loading');

    try {
      // ONE deadline across the whole sequence. Bounding each await separately
      // would let a slow-but-not-hung load spend the full budget twice over and
      // leave "Starting engine..." on screen for double the intended time.
      const runtime: PlayEngineRuntime = await withTimeout(
        loadPlayEngine(),
        ENGINE_GLOBAL_TIMEOUT_MS,
        'Game engine load',
      );

      if (cancelledRef.current) return;

      // Set up event callback for input state tracking
      runtime.set_event_callback(function (eventPayload: unknown) {
        try {
          const payload =
            typeof eventPayload === 'string'
              ? JSON.parse(eventPayload)
              : eventPayload;

          if (payload?.type === 'INPUT_STATE_CHANGED') {
            (window as unknown as Record<string, unknown>).__forgeInputState =
              payload.data ?? payload;
          }
        } catch {
          // ignore parse errors
        }
      });

      // Initialize the engine with the canvas. Past this point Bevy owns the
      // canvas, so a retry is no longer safe.
      engineOwnsCanvasRef.current = true;
      runtime.init_engine(CANVAS_ID);

      // Load scene data
      const sceneJson = JSON.stringify(gameData.sceneData);
      runtime.handle_command('load_scene', sceneJson);

      // Auto-reduce quality on mobile
      const isMobile =
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0;
      if (isMobile) {
        runtime.handle_command(
          'set_quality',
          JSON.stringify({ preset: 'low' })
        );
      }

      // Start play mode after a short delay for the engine to settle
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        if (cancelledRef.current) return;
        runtime.handle_command('play', '{}');
        setEngineState('ready');
      }, PLAY_ENGINE_SETTLE_MS);
    } catch (err) {
      if (cancelledRef.current) return;

      const failure = err instanceof Error ? err : new Error(String(err));
      // Kept alongside captureException: the Sentry client no-ops silently when
      // NEXT_PUBLIC_SENTRY_DSN is unset, which is every local dev run.
      console.error('[SpawnForge Play] Engine init failed:', failure);
      captureException(failure, {
        surface: 'play',
        phase: 'engine-init',
        userId,
        slug,
        engineOwnsCanvas: engineOwnsCanvasRef.current,
      });

      // Back to 'idle': the only overlays keyed off engineState are the
      // "Starting engine..." spinner and the click-to-start button, and the
      // error branch early-returns before either renders.
      setEngineState('idle');
      // A retry re-runs init_engine, which is not safe once Bevy has taken the
      // canvas — so only offer it for failures that happened before that point.
      setCanRetry(!engineOwnsCanvasRef.current);
      setError(
        failure.message || 'Failed to initialize game engine'
      );
    }
  }, [gameData, userId, slug]);

  const retryEngine = useCallback(() => {
    initStartedRef.current = false;
    setCanRetry(false);
    setError(null);
    void initEngine();
  }, [initEngine]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  // --- Error State ---
  if (error && !loading) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="flex min-h-dvh flex-col items-center justify-center bg-zinc-950 px-4"
      >
        <div className="max-w-md text-center">
          <div aria-hidden="true" className="mb-4 text-6xl">:(</div>
          <h1 className="mb-2 text-xl font-semibold text-zinc-200">
            {error === 'Game not found' || error === 'This game is not currently published'
              ? 'Game Not Found'
              : 'Something Went Wrong'}
          </h1>
          <p className="mb-6 text-sm text-zinc-400">{error}</p>
          <div className="flex items-center justify-center gap-2">
            {canRetry && (
              <button
                onClick={retryEngine}
                className="inline-flex items-center gap-2 rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-600"
              >
                <RotateCw size={14} />
                Try again
              </button>
            )}
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
            >
              <ArrowLeft size={14} />
              Back to SpawnForge
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // --- Loading State ---
  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-dvh items-center justify-center bg-zinc-950"
      >
        <div className="flex flex-col items-center gap-3">
          <Loader2 aria-hidden="true" size={32} className="animate-spin text-zinc-400" />
          <h1 className="sr-only">Loading published game</h1>
          <p className="text-sm text-zinc-400">Loading game...</p>
        </div>
      </div>
    );
  }

  // --- Game Player ---
  return (
    <div
      ref={containerRef}
      className="flex min-h-dvh flex-col bg-zinc-950"
    >
      {/* Header bar -- minimal chrome */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded p-1 text-zinc-400 transition-colors hover:text-zinc-300"
            title="Back to SpawnForge"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-sm font-medium text-zinc-200">
              {gameData?.title}
            </h1>
            <p className="text-xs text-zinc-400">
              by {gameData?.creatorName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RemixButton
            userId={userId}
            slug={slug}
            isAuthenticated={isAuthenticated}
          />
          {gameData && shareUrl && (
            <ShareButtons
              gameTitle={gameData.title}
              gameUrl={shareUrl}
            />
          )}
          {/* gameData.id is the published_games row id, which is what the
              report route keys off. userId/slug are only for the sign-in
              return URL when the viewer is signed out. */}
          {gameData && (
            <ReportGameDialog
              gameId={gameData.id}
              userId={userId}
              slug={slug}
              isAuthenticated={isAuthenticated}
            />
          )}
          <button
            onClick={toggleFullscreen}
            className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div className="relative flex-1">
        <canvas id={CANVAS_ID} className="block h-full w-full" />

        {/* Click to start overlay (autoplay policy) */}
        {clickToStart && (
          <button
            onClick={initEngine}
            className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/80 transition-opacity"
          >
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full border-2 border-zinc-500">
              <div className="ml-1 h-0 w-0 border-y-8 border-l-12 border-y-transparent border-l-white" />
            </div>
            <p className="text-sm text-zinc-400">Click to play</p>
          </button>
        )}

        {/* Engine loading overlay */}
        {engineState === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950">
            <Loader2 aria-hidden="true" size={32} className="mb-3 animate-spin text-zinc-400" />
            <p className="text-sm text-zinc-400">Starting engine...</p>
          </div>
        )}
      </div>
    </div>
  );
}
