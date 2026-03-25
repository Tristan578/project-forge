'use client';

import { useState, useMemo, useCallback } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import {
  analyzePacing,
  PACING_TEMPLATES,
  type PacingAnalysis,
  type PacingTemplateId,
  type PacingCurve,
  type PacingIssue,
  type PacingSuggestion,
  type SceneEntityDescriptor,
  type EmotionType,
} from '@/lib/ai/emotionalPacing';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Info,
  Lightbulb,
  BarChart3,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Emotion colors
// ---------------------------------------------------------------------------

const EMOTION_COLORS: Record<EmotionType, string> = {
  tension: '#ef4444',
  excitement: '#f59e0b',
  calm: '#22c55e',
  fear: '#8b5cf6',
  wonder: '#3b82f6',
};

const EMOTION_LABELS: Record<EmotionType, string> = {
  tension: 'Tension',
  excitement: 'Excitement',
  calm: 'Calm',
  fear: 'Fear',
  wonder: 'Wonder',
};

// ---------------------------------------------------------------------------
// SVG Pacing Chart
// ---------------------------------------------------------------------------

interface PacingChartProps {
  curve: PacingCurve;
  templateCurve?: PacingCurve;
  width: number;
  height: number;
}

function PacingChart({ curve, templateCurve, width, height }: PacingChartProps) {
  const padding = { top: 10, right: 10, bottom: 20, left: 30 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const toX = useCallback(
    (pos: number) => padding.left + pos * chartW,
    [padding.left, chartW],
  );
  const toY = useCallback(
    (intensity: number) => padding.top + (1 - intensity) * chartH,
    [padding.top, chartH],
  );

  const mainPath = useMemo(() => {
    if (curve.points.length < 2) return '';
    return curve.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.position).toFixed(1)},${toY(p.intensity).toFixed(1)}`)
      .join(' ');
  }, [curve.points, toX, toY]);

  const templatePath = useMemo(() => {
    if (!templateCurve || templateCurve.points.length < 2) return '';
    return templateCurve.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.position).toFixed(1)},${toY(p.intensity).toFixed(1)}`)
      .join(' ');
  }, [templateCurve, toX, toY]);

  return (
    <svg
      width={width}
      height={height}
      className="bg-zinc-900 rounded"
      role="img"
      aria-label="Emotional pacing chart"
    >
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <line
          key={`h-${v}`}
          x1={padding.left}
          y1={toY(v)}
          x2={width - padding.right}
          y2={toY(v)}
          stroke="#3f3f46"
          strokeWidth={0.5}
        />
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <line
          key={`v-${v}`}
          x1={toX(v)}
          y1={padding.top}
          x2={toX(v)}
          y2={height - padding.bottom}
          stroke="#3f3f46"
          strokeWidth={0.5}
        />
      ))}

      {/* Y-axis labels */}
      <text x={padding.left - 4} y={toY(1) + 4} fill="#71717a" fontSize={9} textAnchor="end">1.0</text>
      <text x={padding.left - 4} y={toY(0.5) + 4} fill="#71717a" fontSize={9} textAnchor="end">0.5</text>
      <text x={padding.left - 4} y={toY(0) + 4} fill="#71717a" fontSize={9} textAnchor="end">0.0</text>

      {/* X-axis labels */}
      <text x={toX(0)} y={height - 4} fill="#71717a" fontSize={9} textAnchor="middle">Start</text>
      <text x={toX(0.5)} y={height - 4} fill="#71717a" fontSize={9} textAnchor="middle">Mid</text>
      <text x={toX(1)} y={height - 4} fill="#71717a" fontSize={9} textAnchor="middle">End</text>

      {/* Template overlay */}
      {templatePath && (
        <path
          d={templatePath}
          fill="none"
          stroke="#71717a"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          opacity={0.6}
        />
      )}

      {/* Main curve */}
      {mainPath && (
        <path d={mainPath} fill="none" stroke="#a78bfa" strokeWidth={2} />
      )}

      {/* Data points */}
      {curve.points.map((p, i) => (
        <circle
          key={i}
          cx={toX(p.position)}
          cy={toY(p.intensity)}
          r={4}
          fill={EMOTION_COLORS[p.emotion]}
          stroke="#18181b"
          strokeWidth={1}
        >
          <title>{`${p.label}: ${EMOTION_LABELS[p.emotion]} (${(p.intensity * 100).toFixed(0)}%)`}</title>
        </circle>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Issue Card
// ---------------------------------------------------------------------------

function IssueCard({ issue }: { issue: PacingIssue }) {
  const icon =
    issue.severity === 'error' ? (
      <AlertTriangle size={14} className="text-red-400 shrink-0" />
    ) : issue.severity === 'warning' ? (
      <AlertTriangle size={14} className="text-amber-400 shrink-0" />
    ) : (
      <Info size={14} className="text-blue-400 shrink-0" />
    );

  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/50 p-2 text-xs">
      <div className="flex items-start gap-1.5">
        {icon}
        <div>
          <p className="text-zinc-200">{issue.message}</p>
          <p className="mt-1 text-zinc-400">{issue.suggestion}</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suggestion Card
// ---------------------------------------------------------------------------

function SuggestionCard({ suggestion }: { suggestion: PacingSuggestion }) {
  const priorityColor =
    suggestion.priority === 'high'
      ? 'text-red-400'
      : suggestion.priority === 'medium'
        ? 'text-amber-400'
        : 'text-blue-400';

  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/50 p-2 text-xs">
      <div className="flex items-start gap-1.5">
        <Lightbulb size={14} className={`${priorityColor} shrink-0`} />
        <div>
          <p className="font-medium text-zinc-200">{suggestion.title}</p>
          <p className="mt-0.5 text-zinc-400">{suggestion.description}</p>
          <p className="mt-1 text-zinc-400">
            Range: {(suggestion.range[0] * 100).toFixed(0)}% – {(suggestion.range[1] * 100).toFixed(0)}%
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Score Badge
// ---------------------------------------------------------------------------

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80
      ? 'text-green-400 border-green-400/30'
      : score >= 50
        ? 'text-amber-400 border-amber-400/30'
        : 'text-red-400 border-red-400/30';

  return (
    <div className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-bold ${color}`}>
      <CheckCircle size={14} />
      {score}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

// Stable selector type for pacing-relevant node data.
interface PacingNodeInfo {
  id: string;
  name: string;
  firstComponent: string | undefined;
}

// Selector that extracts only the fields relevant to pacing analysis
// (id, name, first component type) — ignoring transform, material, etc.
// Zustand's subscribe selector equality check uses shallow comparison by
// default, so we serialise to a string to detect real structural changes.
function selectPacingNodeKey(s: { sceneGraph: { nodes: Record<string, { name: string; components: string[] }> } }): string {
  return Object.keys(s.sceneGraph.nodes)
    .map((id) => {
      const n = s.sceneGraph.nodes[id];
      return `${id}:${n.name}:${n.components[0] ?? ''}`;
    })
    .join('|');
}

export function PacingAnalyzerPanel() {
  // Use a stable string key that only changes when entity ids/names/types
  // change. Transform-only updates (position, rotation, scale) do not affect
  // any of these fields, so they produce the same key and avoid a recompute.
  const nodeKey = useEditorStore(selectPacingNodeKey);
  // rootIds changes only when entities are added or removed — not on transforms.
  const rootIds = useEditorStore((s) => s.sceneGraph.rootIds);
  const [selectedTemplate, setSelectedTemplate] = useState<PacingTemplateId | ''>('');

  // Derive stable PacingNodeInfo list from the current nodes, memoised on
  // the key string so transform events (which don't change name/type/id)
  // do not trigger a recompute.
  const nodeInfos: PacingNodeInfo[] = useMemo(() => {
    const nodes = useEditorStore.getState().sceneGraph.nodes;
    return Object.keys(nodes).map((id) => ({
      id,
      name: nodes[id].name,
      firstComponent: nodes[id].components[0],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey]); // nodeKey encodes all pacing-relevant changes

  // Convert scene graph entities to descriptors.
  const entities: SceneEntityDescriptor[] = useMemo(() => {
    if (nodeInfos.length === 0) return [];

    // Distribute entities evenly across 0–1 based on their order.
    // Use rootIds to define ordering for root-level entities; remaining
    // children follow in insertion order.
    const allIds = nodeInfos.map((n) => n.id);
    const rootIdSet = new Set(rootIds);
    const ordered = [
      ...rootIds,
      ...allIds.filter((id) => !rootIdSet.has(id)),
    ];
    return ordered
      .map((id, idx) => {
        const info = nodeInfos.find((n) => n.id === id);
        if (!info) return null;
        return {
          id,
          name: info.name,
          type: info.firstComponent ?? 'generic',
          position: ordered.length > 1 ? idx / (ordered.length - 1) : 0.5,
          tags: extractTags(info.name, info.firstComponent),
        };
      })
      .filter((e): e is SceneEntityDescriptor => e !== null);
  }, [nodeInfos, rootIds]);

  const analysis: PacingAnalysis | null = useMemo(() => {
    if (entities.length === 0) return null;
    return analyzePacing(
      entities,
      selectedTemplate ? selectedTemplate : undefined,
    );
  }, [entities, selectedTemplate]);

  const templateCurve = useMemo(() => {
    if (!selectedTemplate) return undefined;
    return PACING_TEMPLATES[selectedTemplate]?.curve;
  }, [selectedTemplate]);

  const handleTemplateChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSelectedTemplate(e.target.value as PacingTemplateId | '');
    },
    [],
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-900 text-zinc-300">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Activity size={16} className="text-purple-400" />
        <h2 className="text-sm font-semibold">Pacing Analyzer</h2>
        {analysis && <ScoreBadge score={analysis.score} />}
      </div>

      <div className="flex-1 space-y-3 p-3">
        {/* Template selector */}
        <div>
          <label htmlFor="pacing-template" className="mb-1 block text-xs text-zinc-400">
            Compare with template
          </label>
          <select
            id="pacing-template"
            value={selectedTemplate}
            onChange={handleTemplateChange}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-purple-500 focus:outline-none"
          >
            <option value="">None</option>
            {Object.values(PACING_TEMPLATES).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {/* Chart */}
        {analysis ? (
          <>
            <PacingChart
              curve={analysis.curve}
              templateCurve={templateCurve}
              width={280}
              height={160}
            />

            {/* Legend */}
            <div className="flex flex-wrap gap-2">
              {Object.entries(EMOTION_COLORS).map(([emotion, color]) => (
                <div key={emotion} className="flex items-center gap-1 text-[10px]">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  {EMOTION_LABELS[emotion as EmotionType]}
                </div>
              ))}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-1 text-[10px]">
              <div className="rounded bg-zinc-800 p-1.5 text-center">
                <div className="text-zinc-400">Dominant</div>
                <div className="font-medium" style={{ color: EMOTION_COLORS[analysis.curve.dominantEmotion] }}>
                  {EMOTION_LABELS[analysis.curve.dominantEmotion]}
                </div>
              </div>
              <div className="rounded bg-zinc-800 p-1.5 text-center">
                <div className="text-zinc-400">Avg Intensity</div>
                <div className="font-medium">{(analysis.curve.averageIntensity * 100).toFixed(0)}%</div>
              </div>
              <div className="rounded bg-zinc-800 p-1.5 text-center">
                <div className="text-zinc-400">Variance</div>
                <div className="font-medium">{analysis.curve.variance.toFixed(3)}</div>
              </div>
            </div>

            {/* Issues */}
            {analysis.issues.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-medium text-zinc-400">Issues ({analysis.issues.length})</h3>
                <div className="space-y-1.5">
                  {analysis.issues.map((issue, i) => (
                    <IssueCard key={i} issue={issue} />
                  ))}
                </div>
              </div>
            )}

            {/* Suggestions */}
            {analysis.suggestions.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-medium text-zinc-400">Suggestions ({analysis.suggestions.length})</h3>
                <div className="space-y-1.5">
                  {analysis.suggestions.map((suggestion, i) => (
                    <SuggestionCard key={i} suggestion={suggestion} />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-zinc-400">
            <BarChart3 size={32} />
            <p className="text-xs">Add entities to the scene to analyze pacing</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tag Extraction
// ---------------------------------------------------------------------------

/** Extract emotion-relevant tags from entity name and type. */
function extractTags(name: string, entityType?: string): string[] {
  const tags: string[] = [];
  const lower = name.toLowerCase();

  // Name-based heuristics
  const keywords = [
    'enemy', 'boss', 'trap', 'hazard', 'timer',
    'combat', 'explosion', 'speed', 'chase', 'reward',
    'safe', 'checkpoint', 'rest', 'dialogue', 'shop',
    'dark', 'jumpscare', 'horror', 'monster',
    'vista', 'reveal', 'discovery', 'secret', 'cutscene',
  ];
  for (const kw of keywords) {
    if (lower.includes(kw)) {
      tags.push(kw);
    }
  }

  // Type-based heuristics
  if (entityType) {
    const typeLower = entityType.toLowerCase();
    if (typeLower.includes('light') && lower.includes('dark')) {
      tags.push('dark');
    }
    if (typeLower.includes('camera')) {
      tags.push('cutscene');
    }
  }

  return tags;
}
