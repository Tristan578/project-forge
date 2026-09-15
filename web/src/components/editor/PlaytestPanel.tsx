'use client';

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Play, PlayCircle, AlertTriangle, CheckCircle, XCircle, Info, Loader2, Circle, Repeat } from 'lucide-react';
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
import { InputTraceRecorder, type InputTrace } from '@/lib/playtest/inputTrace';
import {
  invokeReplay,
  createDomKeyboardEnvironment,
} from '@/lib/playtest/replayInvocation';
import type { ReplayOutcome } from '@/lib/playtest/replayRunner';

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

  const collectibleEntityIds = useMemo(
    () =>
      Object.entries(allGameComponents ?? {})
        .filter(([, components]) => (components ?? []).some((c) => c.type === 'collectible'))
        .map(([id]) => id),
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
        recorderRef.current.stop();
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

  useEffect(() => {
    if (!isPlaying) return;
    return () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, [isPlaying]);

  const [previousMode, setPreviousMode] = useState(engineMode);
  if (previousMode !== engineMode) {
    setPreviousMode(engineMode);
    setIsRecording(false);
  }

  const runReplay = useCallback(async () => {
    const trace = traceRef.current;
    if (!trace || !primaryId) return;
    setError(null);
    setIsReplaying(true);
    try {
      const env = createDomKeyboardEnvironment({
        bindings,
        playerEntityId: primaryId,
        collectibleEntityIds,
      });
      const result = await invokeReplay('manual', trace, env);
      setOutcome(result.outcome);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsReplaying(false);
    }
  }, [bindings, primaryId, collectibleEntityIds]);

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
          onClick={runReplay}
          disabled={!isPlaying || !primaryId || !hasTrace || isRecording || isReplaying}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium transition-colors duration-150"
          aria-label="Replay recorded input"
        >
          {isReplaying ? <Loader2 size={14} className="animate-spin" /> : <Repeat size={14} />}
          Replay
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-2 px-2.5 py-2 rounded border text-xs bg-red-500/20 text-red-400 border-red-500/30">
          {error}
        </div>
      )}

      {outcome && (
        <div role="status" aria-live="polite" className="mt-2 space-y-1.5">
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded border ${
              outcome.verdict === 'passed'
                ? 'bg-green-500/10 border-green-500/30'
                : 'bg-red-500/10 border-red-500/30'
            }`}
          >
            {outcome.verdict === 'passed' ? (
              <CheckCircle size={16} className="text-green-400" />
            ) : (
              <XCircle size={16} className="text-red-400" />
            )}
            <span
              className={`text-sm font-semibold ${
                outcome.verdict === 'passed' ? 'text-green-400' : 'text-red-400'
              }`}
            >
              Replay {outcome.verdict}
            </span>
            <span className="text-xs text-zinc-400 ml-auto">
              {outcome.ticksReplayed} ticks
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
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function PlaytestPanel() {
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const allGameComponents = useEditorStore((s) => s.allGameComponents);

  const [selectedStrategy, setSelectedStrategy] = useState<BotStrategy>('explorer');
  const [isRunning, setIsRunning] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [sessions, setSessions] = useState<PlaytestSession[]>([]);
  const [report, setReport] = useState<PlaytestReport | null>(null);

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
    try {
      const ctx = buildContext();
      const session = await simulatePlaytest(ctx, selectedStrategy);
      const newSessions = [session];
      setSessions(newSessions);
      setReport(generatePlaytestReport(newSessions));
    } finally {
      setIsRunning(false);
    }
  }, [buildContext, selectedStrategy]);

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
