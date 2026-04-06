'use client';

import { useState, useCallback, useMemo, memo } from 'react';
import { useEditorStore, getCommandDispatcher } from '@/stores/editorStore';
import {
  diagnoseIssues,
  generateFixes,
  applyFixes,
  severityColor,
  severityLabel,
  categoryLabel,
} from '@/lib/ai/autoIteration';
import type {
  GameMetrics,
  SceneContext,
  GameIssue,
  IssueFix,
  IterationReport,
} from '@/lib/ai/autoIteration';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Play,
  RotateCcw,
  Wrench,
  Zap,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface IssueBadgeProps {
  issue: GameIssue;
}

const IssueBadge = memo(function IssueBadge({ issue }: IssueBadgeProps) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-zinc-700 bg-zinc-800/60 p-2">
      <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${severityColor(issue.severity)}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${severityColor(issue.severity)}`}>
            {severityLabel(issue.severity)}
          </span>
          <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300">
            {categoryLabel(issue.category)}
          </span>
        </div>
        <p className="mt-1 text-xs text-zinc-300">{issue.description}</p>
        <p className="mt-0.5 text-[10px] text-zinc-400">{issue.evidence}</p>
      </div>
    </div>
  );
});

interface FixCardProps {
  fix: IssueFix;
  selected: boolean;
  onToggle: () => void;
}

const FixCard = memo(function FixCard({ fix, selected, onToggle }: FixCardProps) {
  const [expanded, setExpanded] = useState(false);
  const confidencePct = Math.round(fix.confidence * 100);

  const handleToggleExpand = useCallback(() => {
    setExpanded((p) => !p);
  }, []);

  return (
    <div
      className={`rounded-md border p-2 transition-colors duration-150 ${
        selected ? 'border-blue-500 bg-blue-500/10' : 'border-zinc-700 bg-zinc-800/60'
      }`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="mt-1 accent-blue-500"
          aria-label={`Select fix: ${fix.description}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-zinc-300">{fix.description}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[10px] text-zinc-400">
              Confidence: {confidencePct}%
            </span>
            <div className="h-1 w-16 rounded-full bg-zinc-700">
              <div
                className="h-1 rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${confidencePct}%` }}
              />
            </div>
          </div>
          <p className="mt-0.5 text-[10px] text-zinc-400">{fix.estimatedImpact}</p>
        </div>
        <button
          onClick={handleToggleExpand}
          className="shrink-0 rounded p-0.5 text-zinc-400 transition-colors duration-150 hover:bg-zinc-700 hover:text-zinc-300"
          aria-label={expanded ? 'Collapse changes' : 'Expand changes'}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 space-y-1 border-t border-zinc-700 pt-2">
          {fix.changes.map((change, i) => (
            <div key={i} className="text-[10px] text-zinc-400">
              <span className="text-zinc-400">{change.component}.{change.property}:</span>{' '}
              <span className="text-red-400">{String(change.oldValue ?? 'none')}</span>
              {' -> '}
              <span className="text-green-400">{String(change.newValue)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

interface ReportEntryProps {
  report: IterationReport;
}

const ReportEntry = memo(function ReportEntry({ report }: ReportEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const dateStr = useMemo(() => new Date(report.timestamp).toLocaleTimeString(), [report.timestamp]);

  const handleToggle = useCallback(() => {
    setExpanded((p) => !p);
  }, []);

  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-800/40 p-2">
      <button
        onClick={handleToggle}
        className="flex w-full items-center gap-2 text-left"
        aria-label={`Iteration ${report.iterationNumber} details`}
      >
        {expanded ? <ChevronDown className="h-3 w-3 text-zinc-400" /> : <ChevronRight className="h-3 w-3 text-zinc-400" />}
        <span className="text-xs font-medium text-zinc-300">
          Iteration #{report.iterationNumber}
        </span>
        <span className="text-[10px] text-zinc-400">{dateStr}</span>
      </button>
      {expanded && (
        <div className="mt-2 border-t border-zinc-700 pt-2">
          <p className="text-[10px] text-zinc-400">{report.summary}</p>
          {report.fixesApplied.map((fix, i) => (
            <div key={i} className="mt-1 text-[10px] text-zinc-400">
              <CheckCircle2 className="mr-1 inline h-3 w-3 text-green-400" />
              {fix.description}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Default metrics for manual input
// ---------------------------------------------------------------------------

const DEFAULT_METRICS: GameMetrics = {
  avgPlayTime: 180,
  completionRate: 45,
  quitPoints: [
    { scene: 'Level 3', percentage: 35 },
  ],
  difficultySpikes: [
    { scene: 'Level 3', deathRate: 0.6 },
  ],
  engagementScore: 55,
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

function AutoIterationPanel() {
  // Metrics input state
  const [avgPlayTime, setAvgPlayTime] = useState(DEFAULT_METRICS.avgPlayTime);
  const [completionRate, setCompletionRate] = useState(DEFAULT_METRICS.completionRate);
  const [engagementScore, setEngagementScore] = useState(DEFAULT_METRICS.engagementScore);
  const [quitScene, setQuitScene] = useState(DEFAULT_METRICS.quitPoints[0].scene);
  const [quitPercentage, setQuitPercentage] = useState(DEFAULT_METRICS.quitPoints[0].percentage);
  const [spikeScene, setSpikeScene] = useState(DEFAULT_METRICS.difficultySpikes[0].scene);
  const [spikeDeathRate, setSpikeDeathRate] = useState(DEFAULT_METRICS.difficultySpikes[0].deathRate * 100);

  // Diagnosis / fix state
  const [issues, setIssues] = useState<GameIssue[]>([]);
  const [fixes, setFixes] = useState<IssueFix[]>([]);
  const [selectedFixIds, setSelectedFixIds] = useState<Set<number>>(new Set());
  const [reports, setReports] = useState<IterationReport[]>([]);
  const [phase, setPhase] = useState<'input' | 'diagnosed' | 'fixes'>('input');

  // Scene graph for entity context
  const sceneGraph = useEditorStore((s) => s.sceneGraph);

  // Iteration counter
  const iterationCount = reports.length;

  const buildMetrics = useCallback((): GameMetrics => ({
    avgPlayTime,
    completionRate,
    quitPoints: quitScene ? [{ scene: quitScene, percentage: quitPercentage }] : [],
    difficultySpikes: spikeScene ? [{ scene: spikeScene, deathRate: spikeDeathRate / 100 }] : [],
    engagementScore,
  }), [avgPlayTime, completionRate, engagementScore, quitScene, quitPercentage, spikeScene, spikeDeathRate]);

  const buildSceneContext = useCallback((): SceneContext => {
    const nodes = Object.values(sceneGraph.nodes);
    return {
      sceneName: quitScene || 'Main',
      entityCount: nodes.length,
      entities: nodes.map((n) => ({
        id: n.entityId,
        name: n.name,
        type: n.components[0] ?? 'unknown',
        components: n.components,
        properties: {},
      })),
    };
  }, [quitScene, sceneGraph]);

  const handleDiagnose = useCallback(() => {
    const metrics = buildMetrics();
    const ctx = buildSceneContext();
    const diagnosed = diagnoseIssues(metrics, ctx);
    setIssues(diagnosed);
    setPhase('diagnosed');
    setFixes([]);
    setSelectedFixIds(new Set());
  }, [buildMetrics, buildSceneContext]);

  const handleGenerateFixes = useCallback(() => {
    const ctx = buildSceneContext();
    const generated = generateFixes(issues, ctx);
    setFixes(generated);
    setSelectedFixIds(new Set(generated.map((_, i) => i)));
    setPhase('fixes');
  }, [issues, buildSceneContext]);

  const handleToggleFix = useCallback((index: number) => {
    setSelectedFixIds((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const handleApplySelected = useCallback(() => {
    const dispatcher = getCommandDispatcher();
    if (!dispatcher) return;

    const selected = fixes.filter((_, i) => selectedFixIds.has(i));
    if (selected.length === 0) return;

    const report = applyFixes(
      selected,
      dispatcher,
      iterationCount + 1,
      () => useEditorStore.getState().primaryId,
    );
    report.issuesFound = issues;
    setReports((prev) => [report, ...prev]);
    setPhase('input');
    setIssues([]);
    setFixes([]);
    setSelectedFixIds(new Set());
  }, [fixes, selectedFixIds, issues, iterationCount]);

  const handleReset = useCallback(() => {
    setPhase('input');
    setIssues([]);
    setFixes([]);
    setSelectedFixIds(new Set());
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-900">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Zap className="h-4 w-4 text-yellow-400" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-300">
          Auto-Iteration
        </h2>
        {iterationCount > 0 && (
          <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">
            {iterationCount} iteration{iterationCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Metrics Input */}
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-400">
            <Activity className="h-3 w-3" />
            Game Metrics
          </h3>
          <div className="space-y-2">
            <MetricInput label="Avg Play Time (s)" value={avgPlayTime} onChange={setAvgPlayTime} min={0} max={3600} />
            <MetricInput label="Completion Rate (%)" value={completionRate} onChange={setCompletionRate} min={0} max={100} />
            <MetricInput label="Engagement Score" value={engagementScore} onChange={setEngagementScore} min={0} max={100} />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-0.5 block text-[10px] text-zinc-400">Quit Scene</label>
                <input
                  type="text"
                  value={quitScene}
                  onChange={(e) => setQuitScene(e.target.value)}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <MetricInput label="Quit %" value={quitPercentage} onChange={setQuitPercentage} min={0} max={100} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-0.5 block text-[10px] text-zinc-400">Spike Scene</label>
                <input
                  type="text"
                  value={spikeScene}
                  onChange={(e) => setSpikeScene(e.target.value)}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <MetricInput label="Death Rate %" value={spikeDeathRate} onChange={setSpikeDeathRate} min={0} max={100} />
            </div>
          </div>
        </section>

        {/* Action Buttons */}
        <div className="flex gap-2">
          {phase === 'input' && (
            <button
              onClick={handleDiagnose}
              className="flex flex-1 items-center justify-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Diagnose game issues from metrics"
            >
              <Play className="h-3 w-3" />
              Diagnose
            </button>
          )}
          {phase === 'diagnosed' && issues.length > 0 && (
            <button
              onClick={handleGenerateFixes}
              className="flex flex-1 items-center justify-center gap-1.5 rounded bg-yellow-600 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500"
              aria-label="Generate fixes for diagnosed issues"
            >
              <Wrench className="h-3 w-3" />
              Generate Fixes
            </button>
          )}
          {phase === 'fixes' && selectedFixIds.size > 0 && (
            <button
              onClick={handleApplySelected}
              className="flex flex-1 items-center justify-center gap-1.5 rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-green-500 focus:outline-none focus:ring-2 focus:ring-green-500"
              aria-label={`Apply ${selectedFixIds.size} selected fixes`}
            >
              <CheckCircle2 className="h-3 w-3" />
              Apply {selectedFixIds.size} Fix{selectedFixIds.size === 1 ? '' : 'es'}
            </button>
          )}
          {phase !== 'input' && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1.5 text-xs text-zinc-400 transition-colors duration-150 hover:bg-zinc-800 hover:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-500"
              aria-label="Reset and start over"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Diagnosed Issues */}
        {phase !== 'input' && issues.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold text-zinc-400">
              Issues Found ({issues.length})
            </h3>
            <div className="space-y-2">
              {issues.map((issue) => (
                <IssueBadge key={issue.id} issue={issue} />
              ))}
            </div>
          </section>
        )}

        {phase === 'diagnosed' && issues.length === 0 && (
          <div className="rounded-md border border-green-800 bg-green-900/20 p-3 text-center">
            <CheckCircle2 className="mx-auto mb-1 h-5 w-5 text-green-400" />
            <p className="text-xs text-green-300">No issues detected! Your game metrics look healthy.</p>
          </div>
        )}

        {/* Proposed Fixes */}
        {phase === 'fixes' && fixes.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold text-zinc-400">
              Proposed Fixes ({fixes.length})
            </h3>
            <div className="space-y-2">
              {fixes.map((fix, i) => (
                <FixCard
                  key={`${fix.issueId}-${i}`}
                  fix={fix}
                  selected={selectedFixIds.has(i)}
                  onToggle={() => handleToggleFix(i)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Iteration History */}
        {reports.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold text-zinc-400">
              Iteration History
            </h3>
            <div className="space-y-2">
              {reports.map((report) => (
                <ReportEntry key={report.iterationNumber} report={report} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric input helper
// ---------------------------------------------------------------------------

interface MetricInputProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}

const MetricInput = memo(function MetricInput({ label, value, onChange, min, max }: MetricInputProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      if (!Number.isNaN(v)) {
        onChange(Math.max(min, Math.min(max, v)));
      }
    },
    [onChange, min, max],
  );

  return (
    <div>
      <label className="mb-0.5 block text-[10px] text-zinc-400">{label}</label>
      <input
        type="number"
        value={value}
        onChange={handleChange}
        min={min}
        max={max}
        className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
});

export default memo(AutoIterationPanel);
