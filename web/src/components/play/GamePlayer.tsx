'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Maximize, Minimize, Loader2 } from 'lucide-react';
import { ShareButtons } from './ShareButtons';

const CANVAS_ID = 'play-canvas';

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
}

type WasmRuntime = {
  init_engine: (canvasId: string) => void;
  handle_command: (command: string, payload: unknown) => unknown;
  set_event_callback: (callback: (event: unknown) => void) => void;
};

export function GamePlayer({ userId, slug }: GamePlayerProps) {
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [engineState, setEngineState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [clickToStart, setClickToStart] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const initStartedRef = useRef(false);

  // Fetch game data from the API
  useEffect(() => {
    async function fetchGame() {
      try {
        const res = await fetch(`/api/play/${encodeURIComponent(userId)}/${encodeURIComponent(slug)}`);
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
      } catch {
        setError('Network error -- could not load game');
        setLoading(false);
      }
    }

    fetchGame();
  }, [userId, slug]);

  // Initialize the WASM engine and start the game
  const initEngine = useCallback(async () => {
    if (!gameData || initStartedRef.current) return;
    initStartedRef.current = true;
    setClickToStart(false);
    setEngineState('loading');

    try {
      const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
      const variant = hasWebGPU ? 'webgpu' : 'webgl2';
      const basePath = `/engine-pkg-${variant}/`;

      // Load the WASM module
      const wasm = await import(
        /* webpackIgnore: true */ `${basePath}forge_engine.js`
      );
      await wasm.default(`${basePath}forge_engine_bg.wasm`);

      const runtime = wasm as unknown as WasmRuntime;

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

      // Initialize the engine with the canvas
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
      setTimeout(() => {
        runtime.handle_command('play', '{}');
        setEngineState('ready');
      }, 500);
    } catch (err) {
      console.error('[SpawnForge Play] Engine init failed:', err);
      setEngineState('error');
      setError(
        err instanceof Error ? err.message : 'Failed to initialize game engine'
      );
    }
  }, [gameData]);

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
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4">
        <div className="max-w-md text-center">
          <div className="mb-4 text-6xl">:(</div>
          <h1 className="mb-2 text-xl font-semibold text-zinc-200">
            {error === 'Game not found' || error === 'This game is not currently published'
              ? 'Game Not Found'
              : 'Something Went Wrong'}
          </h1>
          <p className="mb-6 text-sm text-zinc-400">{error}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
          >
            <ArrowLeft size={14} />
            Back to SpawnForge
          </Link>
        </div>
      </div>
    );
  }

  // --- Loading State ---
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin text-zinc-400" />
          <p className="text-sm text-zinc-400">Loading game...</p>
        </div>
      </div>
    );
  }

  // --- Game Player ---
  return (
    <div
      ref={containerRef}
      className="flex min-h-screen flex-col bg-zinc-950"
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
        <div className="flex items-center gap-1">
          {gameData && (
            <ShareButtons
              gameTitle={gameData.title}
              gameUrl={typeof window !== 'undefined' ? window.location.href : ''}
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
            <Loader2 size={32} className="mb-3 animate-spin text-zinc-400" />
            <p className="text-sm text-zinc-400">Starting engine...</p>
          </div>
        )}
      </div>
    </div>
  );
}
