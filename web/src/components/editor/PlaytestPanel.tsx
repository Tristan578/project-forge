'use client';

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  Play,
  PlayCircle,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Info,
  Loader2,
  Circle,
  Repeat,
  Pause,
  Square,
} from 'lucide-react';
import {
  BOT_STRATEGIES,
  simulatePlaytest,
  generatePlaytestReport,
  type BotStrategy,
  type PlaytestSession,
  type PlaytestReport,
  type BotDiscovery,
  type SceneContext,
} from '@/lib/ai/gameplayBot';
import { useEditorStore } from '@/stores/editorStore';
import { InputTraceRecorder, InputTraceValidationError, type InputTrace } from '@/lib/playtest/inputTrace';
import {
  collectibleEntityIdsFrom,
  runReplay,
  startReplaySession,
} from '@/lib/playtest/replayEntryPoints';
import { botSessionToInputTrace } from '@/lib/playtest/botTrace';
import type { ReplayHandle, ReplayOutcome, ReplayProgress } from '@/lib/playtest/replayRunner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<BotDiscovery['severity'], string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  major: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  minor: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};

const SEVERITY_ICONS: Record<BotDiscovery['severity'], typeof AlertTriangle> = {
  critical: XCircle,
  major: AlertTriangle,
  minor: Info,
};

const OUTCOME_LABELS: Record<string, { label: string; color: string }> = {
  completed: { label: 'Completed', color: 'text-green-400' },
  stuck: { label: 'Got Stuck', color: 'text-orange-400' },
  died: { label: 'Died', color: 'text-red-400' },
  timeout: { label: 'Timed Out', color: 'text-yellow-400' },
};

const RATING_LABELS: Record<string, { label: string; color: string }> = {
  excellent: { label: 'Excellent', color: 'text-green-400' },
  good: { label: 'Good', color: 'text-blue-400' },
  needs_work: { label: 'Needs Work', color: 'text-orange-400' },
  critical_issues: { label: 'Critical Issues', color: 'text-red-400' },
};

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StrategySelector({
  selected,
  onSelect,
}: {
  selected: BotStrategy;
  onSelect: (s: BotStrategy) => void;
}) {
  const strategies = Object.entries(BOT_STRATEGIES) as [BotStrategy, (typeof BOT_STRATEGIES)[BotStrategy]][];
  return (
    <div className="space-y-1">
      {strategies.map(([key, config]) => (
        <button
          key={key}
          onClick={() => onSelect(key)}
          className={`w-full text-left px-3 py-2 rounded text-xs transition-colors duration-150 ${
            selected === key
              ? 'bg-blue-500/20 border border-blue-500/40 text-blue-300'
              : 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700'
          }`}
          aria-pressed={selected === key}
        >
          <div className="font-medium">{config.name}</div>
          <div className="text-zinc-400 mt-0.5 leading-snug">{config.description}</div>
        </button>
      ))}
    </div>
  );
}

function DiscoveryList({ discoveries }: { discoveries: BotDiscovery[] }) {
  if (discoveries.length === 0) {
    return (
      <div className="text-xs text-zinc-400 italic py-2">No issues found.</div>
    );
  }

  return (
    <div className="space-y-1.5">
      {discoveries.map((d, i) => {
        const Icon = SEVERITY_ICONS[d.severity];
        return (
          <div
            key={`${d.type}-${d.location}-${i}`}
            className={`px-2.5 py-2 rounded border text-xs ${SEVERITY_COLORS[d.severity]}`}
          >
            <div className="flex items-start gap-1.5">
              <Icon size={14} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-medium capitalize">
                  {d.type.replace(/_/g, ' ')}
                  {d.location !== 'scene' && (
                    <span className="font-normal text-zinc-400"> at {d.location}</span>
                  )}
                </div>
                <div className="text-zinc-300 mt-0.5 leading-snug">{d.description}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MetricsTable({ report }: { report: PlaytestReport }) {
  const strategies = Object.keys(report.strategyComparison) as BotStrategy[];
  if (strategies.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-zinc-400 border-b border-zinc-700">
            <th className="text-left py-1.5 pr-2">Strategy</th>
            <th className="text-right py-1.5 px-1">Time</th>
            <th className="text-right py-1.5 px-1">Deaths</th>
            <th className="text-right py-1.5 px-1">Items</th>
            <th className="text-right py-1.5 px-1">Areas</th>
          </tr>
        </thead>
        <tbody>
          {strategies.map((s) => {
            const m = report.strategyComparison[s];
            return (
              <tr key={s} className="text-zinc-300 border-b border-zinc-800">
                <td className="py-1.5 pr-2 font-medium capitalize">{s}</td>
                <td className="text-right py-1.5 px-1">{formatDuration(m.timeToComplete)}</td>
                <td className="text-right py-1.5 px-1">{m.deathCount}</td>
                <td className="text-right py-1.5 px-1">{m.itemsCollected}</td>
                <td className="text-right py-1.5 px-1">{m.areasExplored}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Runtime replay (real engine) — distinct from the heuristic AI Playtest above
// ---------------------------------------------------------------------------

/**
 * Manual Record + Replay controls for the REAL runtime (#9902).
 *
 * Record captures the engine's per-tick named-action input into a bounded
 * `InputTrace`; Replay drives that same trace back through the real input path
 * via `invokeReplay('manual', ...)` and reports an observed-state verdict
 * (entity moved, one collectible
 * collected). This is deliberately kept separate from, and never conflated
 * with, the heuristic "AI Playtest" rating above.
 */
function RuntimeReplaySection() {
  const engineMode = useEditorStore((s) => s.engineMode);
  const primaryId = useEditorStore((s) => s.primaryId);
  const inputBindings = useEditorStore((s) => s.inputBindings);
  const allGameComponents = useEditorStore((s) => s.allGameComponents);
  const sceneName = useEditorStore((s) => s.sceneName);
  const selectedEntityName = useEditorStore((s) => primaryId ? s.sceneGraph.nodes[primaryId]?.name : undefined);

  const recorderRef = useRef<InputTraceRecorder | null>(null);
  const traceRef = useRef<InputTrace | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [hasTrace, setHasTrace] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [outcome, setOutcome] = useState<ReplayOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isPlaying = engineMode === 'play';
  const bindings = useMemo(() => inputBindings ?? [], [inputBindings]);
  const actionNames = useMemo(() => bindings.map((b) => b.actionName), [bindings]);

  // The same default observation set the AI tool derives (`replayEntryPoints`).
  const collectibleEntityIds = useMemo(
    () => collectibleEntityIdsFrom(allGameComponents),
    [allGameComponents],
  );

  const failRecording = useCallback((cause: unknown) => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    traceRef.current = null;
    setHasTrace(false);
    setIsRecording(false);
    console.error('Input recording failed:', cause);
    setError('Recording could not be saved. Check your input bindings, then select Record to try again.');
  }, []);

  const toggleRecord = useCallback(() => {
    setError(null);
    try {
      if (recorderRef.current?.isRecording()) {
        try {
          recorderRef.current.stop();
        } catch (cause) {
          // Validation failures already reach failRecording through onError.
          if (!(cause instanceof InputTraceValidationError)) throw cause;
        }
        return;
      }
      const recorder = new InputTraceRecorder(
        sceneName || 'current-scene',
        actionNames,
        (trace) => {
          traceRef.current = trace;
          recorderRef.current = null;
          setHasTrace(true);
          setIsRecording(false);
        },
        failRecording,
      );
      recorder.start();
      recorderRef.current = recorder;
      traceRef.current = null;
      setHasTrace(false);
      setIsRecording(true);
      setOutcome(null);
    } catch (e) {
      failRecording(e);
    }
  }, [actionNames, sceneName, failRecording]);

  // A controlled replay session (#10007): the handle is what Pause / Resume /
  // Cancel act on, and `progress` is what the pending/progress line renders.
  const handleRef = useRef<ReplayHandle | null>(null);
  const [progress, setProgress] = useState<ReplayProgress | null>(null);
  const [cancelledAfter, setCancelledAfter] = useState<number | null>(null);

  useEffect(() => {
    if (!isPlaying) return;
    return () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, [isPlaying]);

  // Stop ends a replay in flight: the engine never ticks again, so the runner
  // must release its synthetic keys and unpin NOW rather than wait for a frame.
  // Keyed on 'edit' deliberately, not on leaving 'play': the runner's own Pause
  // puts the engine in 'paused' (ENGINE_MODE_CHANGED), and a replay has to
  // survive its own pause.
  useEffect(() => {
    if (engineMode === 'edit') handleRef.current?.cancel();
  }, [engineMode]);

  // Unmounting the panel mid-replay must not leave a synthetic key held either.
  useEffect(
    () => () => {
      handleRef.current?.cancel();
    },
    [],
  );

  const [previousMode, setPreviousMode] = useState(engineMode);
  if (previousMode !== engineMode) {
    setPreviousMode(engineMode);
    setIsRecording(false);
  }

  const startReplay = useCallback(async () => {
    const trace = traceRef.current;
    if (!trace || !primaryId) return;
    setError(null);
    setOutcome(null);
    setCancelledAfter(null);
    setIsReplaying(true);
    let unsubscribe: (() => void) | null = null;
    try {
      const session = startReplaySession('manual', {
        trace,
        playerEntityId: primaryId,
        collectibleEntityIds,
      });
      handleRef.current = session.handle;
      setProgress(session.handle.getProgress());
      unsubscribe = session.handle.subscribe(setProgress);
      const result = await session.handle.result;
      if (result.status === 'completed') setOutcome(result.outcome);
      else if (result.status === 'cancelled') setCancelledAfter(result.ticksReplayed);
      else setError(result.error.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      unsubscribe?.();
      handleRef.current = null;
      setProgress(null);
      setIsReplaying(false);
    }
  }, [primaryId, collectibleEntityIds]);

  const pauseReplay = useCallback(() => {
    handleRef.current?.pause();
  }, []);
  const resumeReplay = useCallback(() => {
    handleRef.current?.resume();
  }, []);
  const cancelReplay = useCallback(() => {
    handleRef.current?.cancel();
  }, []);

  const canPause = progress?.state === 'running' || progress?.state === 'pinning';
  const showResume = progress?.state === 'paused' || progress?.state === 'pausing';

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-zinc-400 mb-2">
        Runtime Replay
      </h3>
      <p className="text-xs text-zinc-400 mb-2">
        Record your inputs while playing, then replay them through the real engine
        to verify the game responds. This is a runtime check, not the heuristic
        rating above.
      </p>
      {!isPlaying && (
        <div className="text-xs text-zinc-400 italic mb-2">
          Enter Play mode to record and replay input.
        </div>
      )}
      <p className="text-xs text-zinc-400 mb-2">
        {primaryId
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- a blank selected-entity name is unset; falls back to showing the raw id
          ? `Replay will observe ${selectedEntityName || primaryId}.`
          : 'Select the player entity before replaying recorded input.'}
      </p>
      <div className="flex gap-2">
        <button
          onClick={toggleRecord}
          disabled={!isPlaying || isReplaying}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium transition-colors duration-150"
          aria-label={isRecording ? 'Stop recording input' : 'Record input'}
          aria-pressed={isRecording}
        >
          <Circle size={14} className={isRecording ? 'text-red-400 animate-pulse' : ''} />
          {isRecording ? 'Stop Recording' : 'Record'}
        </button>
        <button
          onClick={startReplay}
          disabled={!isPlaying || !primaryId || !hasTrace || isRecording || isReplaying}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium transition-colors duration-150"
          aria-label="Replay recorded input"
        >
          {isReplaying ? <Loader2 size={14} className="animate-spin" /> : <Repeat size={14} />}
          Replay
        </button>
      </div>

      {isReplaying && progress && (
        <div
          role="status"
          aria-live="polite"
          data-testid="replay-progress"
          className="mt-2 flex items-center gap-2 px-2.5 py-1.5 bg-zinc-800 rounded text-xs"
        >
          <Loader2 size={14} className="animate-spin text-blue-400 shrink-0" />
          <span className="flex-1 text-zinc-300">{replayStatusText(progress)}</span>
          {showResume ? (
            <button
              onClick={resumeReplay}
              disabled={progress.state === 'pausing'}
              className="p-1 rounded hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Resume replay"
            >
              <Play size={14} />
            </button>
          ) : (
            <button
              onClick={pauseReplay}
              disabled={!canPause}
              className="p-1 rounded hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Pause replay"
            >
              <Pause size={14} />
            </button>
          )}
          <button
            onClick={cancelReplay}
            disabled={progress.state === 'cancelling'}
            className="p-1 rounded hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Cancel replay"
          >
            <Square size={14} />
          </button>
        </div>
      )}

      {cancelledAfter !== null && (
        <div role="status" className="mt-2 px-2.5 py-1.5 bg-zinc-800 rounded text-xs text-zinc-400">
          Replay cancelled after {cancelledAfter} ticks. Input was released; no verdict was recorded.
        </div>
      )}

      {error && (
        <div role="alert" className="mt-2 px-2.5 py-2 rounded border text-xs bg-red-500/20 text-red-400 border-red-500/30">
          {error}
        </div>
      )}

      <ReplayOutcomeView outcome={outcome} label="Replay" />
    </div>
  );
}

/** The progress line a replay shows while it runs: state, tick position, clock. */
function replayStatusText(progress: ReplayProgress): string {
  const clock = progress.pinned === true ? ' on the pinned clock' : '';
  switch (progress.state) {
    case 'pinning':
      return 'Pinning the engine clock…';
    case 'running':
      return `Replaying tick ${progress.tick} of ${progress.totalTicks}${clock}`;
    case 'pausing':
      return `Pausing at tick ${progress.tick}…`;
    case 'paused':
      return `Paused at tick ${progress.tick} of ${progress.totalTicks}; input released`;
    case 'cancelling':
      return 'Cancelling and releasing input…';
    default:
      return progress.state;
  }
}

/**
 * Observed-state verdict of a runtime replay, used for both the manual Replay
 * button and the AI bot's runtime run so the two read identically.
 */
function ReplayOutcomeView({ outcome, label }: { outcome: ReplayOutcome | null; label: string }) {
  if (!outcome) return null;
  const passed = outcome.verdict === 'passed';
  return (
    <div role="status" aria-live="polite" className="mt-2 space-y-1.5">
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded border ${
          passed ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'
        }`}
      >
        {passed ? (
          <CheckCircle size={16} className="text-green-400" />
        ) : (
          <XCircle size={16} className="text-red-400" />
        )}
        <span className={`text-sm font-semibold ${passed ? 'text-green-400' : 'text-red-400'}`}>
          {label} {outcome.verdict}
        </span>
        <span className="text-xs text-zinc-400 ml-auto">
          {outcome.ticksReplayed} ticks
          {outcome.pinned ? ` · pinned ${outcome.pinHz} Hz` : ' · unpinned clock'}
        </span>
      </div>
      {outcome.assertions.map((a) => (
        <div
          key={a.operationId}
          className="flex items-start gap-1.5 px-2.5 py-1.5 bg-zinc-800 rounded text-xs"
        >
          {a.passed ? (
            <CheckCircle size={14} className="text-green-400 mt-0.5 shrink-0" />
          ) : (
            <XCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
          )}
          <div>
            <div className="text-zinc-300">{a.description}</div>
            <div className="text-zinc-500 mt-0.5">{a.operationId}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function PlaytestPanel() {
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const allGameComponents = useEditorStore((s) => s.allGameComponents);
  const engineMode = useEditorStore((s) => s.engineMode);
  const primaryId = useEditorStore((s) => s.primaryId);
  const inputBindings = useEditorStore((s) => s.inputBindings);
  const sceneName = useEditorStore((s) => s.sceneName);

  const [selectedStrategy, setSelectedStrategy] = useState<BotStrategy>('explorer');
  const [isRunning, setIsRunning] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [sessions, setSessions] = useState<PlaytestSession[]>([]);
  const [report, setReport] = useState<PlaytestReport | null>(null);
  // The bot's plan driven through the REAL engine (#10007): the same
  // `replay_input_trace` command the manual Replay button runs, labelled 'ai'.
  const [botOutcome, setBotOutcome] = useState<ReplayOutcome | null>(null);
  const [botRuntimeError, setBotRuntimeError] = useState<string | null>(null);
  const canRunInEngine = engineMode === 'play' && !!primaryId;

  const runBotInEngine = useCallback(
    async (session: PlaytestSession) => {
      if (!primaryId) return;
      const actionNames = (inputBindings ?? []).map((b) => b.actionName);
      const trace = botSessionToInputTrace(session, {
        fixtureId: sceneName || 'current-scene',
        actionNames,
      });
      const result = await runReplay('ai', { trace, playerEntityId: primaryId });
      setBotOutcome(result.outcome);
    },
    [primaryId, inputBindings, sceneName],
  );

  const buildContext = useCallback((): SceneContext => {
    // Build a lightweight game-component map from store data
    const gameComps: Record<string, { type: string }[]> = {};
    if (allGameComponents) {
      for (const [id, components] of Object.entries(allGameComponents)) {
        if (components) {
          gameComps[id] = components.map((c) => ({ type: c.type }));
        }
      }
    }

    return {
      sceneGraph,
      gameComponents: gameComps,
      projectType: '3d',
    };
  }, [sceneGraph, allGameComponents]);

  const runSingle = useCallback(async () => {
    setIsRunning(true);
    setBotOutcome(null);
    setBotRuntimeError(null);
    try {
      const ctx = buildContext();
      const session = await simulatePlaytest(ctx, selectedStrategy);
      const newSessions = [session];
      setSessions(newSessions);
      setReport(generatePlaytestReport(newSessions));
      if (canRunInEngine) {
        try {
          await runBotInEngine(session);
        } catch (e) {
          setBotRuntimeError(e instanceof Error ? e.message : String(e));
        }
      }
    } finally {
      setIsRunning(false);
    }
  }, [buildContext, selectedStrategy, canRunInEngine, runBotInEngine]);

  const runAll = useCallback(async () => {
    setIsRunningAll(true);
    try {
      const ctx = buildContext();
      const strategies: BotStrategy[] = ['explorer', 'speedrunner', 'completionist', 'random', 'cautious'];
      const results: PlaytestSession[] = [];
      for (const s of strategies) {
        results.push(await simulatePlaytest(ctx, s));
      }
      setSessions(results);
      setReport(generatePlaytestReport(results));
    } finally {
      setIsRunningAll(false);
    }
  }, [buildContext]);

  const isLoading = isRunning || isRunningAll;

  return (
    <div className="h-full overflow-y-auto bg-zinc-900 text-zinc-200">
      <div className="p-3 space-y-4">
        {/* Header */}
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <PlayCircle size={16} className="text-blue-400" />
            AI Playtest
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Run AI bots to test your game for balance issues, soft-locks, and unreachable areas.
            {canRunInEngine
              ? ' Run Playtest also drives the bot’s plan through the running engine and reports what it observed.'
              : ' Enter Play mode and select the player to also run the bot through the engine.'}
          </p>
        </div>

        {/* Strategy selector */}
        <div>
          <h3 className="text-xs font-semibold uppercase text-zinc-400 mb-2">Strategy</h3>
          <StrategySelector selected={selectedStrategy} onSelect={setSelectedStrategy} />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={runSingle}
            disabled={isLoading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium transition-colors duration-150"
            aria-label={`Run playtest with ${selectedStrategy} strategy`}
          >
            {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Run Playtest
          </button>
          <button
            onClick={runAll}
            disabled={isLoading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium transition-colors duration-150"
            aria-label="Run playtest with all strategies"
          >
            {isRunningAll ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
            Run All
          </button>
        </div>

        {/* Runtime replay (real engine) — separate from the heuristic bot above */}
        <RuntimeReplaySection />

        {/* The bot's plan run through the real engine — a runtime verdict, never a rating */}
        {botRuntimeError && (
          <div role="alert" className="px-2.5 py-2 rounded border text-xs bg-red-500/20 text-red-400 border-red-500/30">
            AI bot runtime replay: {botRuntimeError}
          </div>
        )}
        <ReplayOutcomeView outcome={botOutcome} label="AI bot runtime replay" />

        {/* Results */}
        {report && (
          <>
            {/* Overall rating */}
            <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800 rounded border border-zinc-700">
              {report.overallRating === 'excellent' || report.overallRating === 'good' ? (
                <CheckCircle size={16} className={RATING_LABELS[report.overallRating].color} />
              ) : (
                <AlertTriangle size={16} className={RATING_LABELS[report.overallRating].color} />
              )}
              <div>
                <span className={`text-sm font-semibold ${RATING_LABELS[report.overallRating].color}`}>
                  {RATING_LABELS[report.overallRating].label}
                </span>
                <span className="text-xs text-zinc-400 ml-2">
                  {report.totalDiscoveries} issue{report.totalDiscoveries !== 1 ? 's' : ''} found
                </span>
              </div>
            </div>

            {/* Session outcomes */}
            {sessions.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-zinc-400 mb-2">Sessions</h3>
                <div className="space-y-1">
                  {sessions.map((s, i) => {
                    const outcome = OUTCOME_LABELS[s.outcome];
                    return (
                      <div
                        key={`${s.strategy}-${i}`}
                        className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-800 rounded text-xs"
                      >
                        <span className="capitalize font-medium">{s.strategy}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-zinc-400">{formatDuration(s.duration)}</span>
                          <span className={outcome.color}>{outcome.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Discoveries */}
            <div>
              <h3 className="text-xs font-semibold uppercase text-zinc-400 mb-2">
                Findings ({report.uniqueDiscoveries.length})
              </h3>
              <DiscoveryList discoveries={report.uniqueDiscoveries} />
            </div>

            {/* Metrics comparison */}
            {Object.keys(report.strategyComparison).length > 1 && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-zinc-400 mb-2">
                  Metrics Comparison
                </h3>
                <MetricsTable report={report} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
