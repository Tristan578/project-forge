'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  Lightbulb,
  Search,
  BookOpen,
  BarChart3,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Star,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import {
  DESIGN_PRINCIPLES,
  suggestLessons,
  explainDecision,
  generateDesignCritique,
  searchPrinciples,
  getPrinciplesByCategory,
  type DesignLesson,
  type DesignDecision,
  type DesignCritique,
  type DesignCategory,
  type DesignPrinciple,
  type TeacherSceneContext,
} from '@/lib/ai/designTeacher';

// ---------------------------------------------------------------------------
// Category labels and colors
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<DesignCategory, string> = {
  mechanics: 'Mechanics',
  level_design: 'Level Design',
  narrative: 'Narrative',
  balance: 'Balance',
  ux: 'UX',
  aesthetics: 'Aesthetics',
};

const CATEGORY_COLORS: Record<DesignCategory, string> = {
  mechanics: 'bg-blue-500/20 text-blue-400',
  level_design: 'bg-green-500/20 text-green-400',
  narrative: 'bg-purple-500/20 text-purple-400',
  balance: 'bg-yellow-500/20 text-yellow-400',
  ux: 'bg-orange-500/20 text-orange-400',
  aesthetics: 'bg-pink-500/20 text-pink-400',
};

const ALL_CATEGORIES: DesignCategory[] = [
  'mechanics',
  'level_design',
  'narrative',
  'balance',
  'ux',
  'aesthetics',
];

// ---------------------------------------------------------------------------
// Build scene context from editor store
// ---------------------------------------------------------------------------

function useTeacherSceneContext(): TeacherSceneContext {
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const allGameComponents = useEditorStore((s) => s.allGameComponents);
  const primaryLight = useEditorStore((s) => s.primaryLight);

  return useMemo(() => {
    const nodes = sceneGraph?.nodes ?? {};
    const entities = Object.entries(nodes).map(([id, node]) => {
      const gc = allGameComponents?.[id] ?? [];
      const gcTypes = gc.map(
        (c: { type: string }) => c.type,
      );
      return {
        name: node.name,
        entityType: node.components.includes('Mesh3d')
          ? 'mesh'
          : node.components.includes('PointLight') ||
              node.components.includes('DirectionalLight') ||
              node.components.includes('SpotLight')
            ? 'light'
            : 'entity',
        components: node.components,
        hasPhysics: node.components.includes('PhysicsEnabled'),
        hasScript: node.components.includes('ScriptData'),
        hasAudio: node.components.includes('AudioEnabled'),
        hasAnimation: node.components.includes('AnimationPlayer'),
        hasGameComponent: gc.length > 0,
        gameComponentTypes: gcTypes,
        position: [0, 0, 0] as [number, number, number],
      };
    });

    const lightCount = entities.filter((e) => e.entityType === 'light').length;
    // Check if any light entity exists — shadow detection is approximate
    // since per-entity shadow state isn't available scene-wide in the store.
    // Having lights at all is a reasonable proxy for shadow capability.
    const hasShadows = lightCount > 0 && (primaryLight?.shadowsEnabled ?? lightCount > 1);

    const hasPlayerCharacter = entities.some((e) =>
      e.gameComponentTypes.includes('characterController'),
    );
    const hasCollectibles = entities.some((e) =>
      e.gameComponentTypes.includes('collectible'),
    );
    const hasEnemies = entities.some(
      (e) =>
        e.gameComponentTypes.includes('damageZone') ||
        e.gameComponentTypes.includes('follower'),
    );
    const hasWinCondition = entities.some((e) =>
      e.gameComponentTypes.includes('winCondition'),
    );

    // Filter to physics-enabled entities first, then check body type.
    // hasPhysics = dynamic rigidbody; !hasPhysics with PhysicsEnabled = static/kinematic.
    const physicsEntities = entities.filter((e) => e.components.includes('PhysicsEnabled'));
    const hasDynamic = physicsEntities.some((e) => e.hasPhysics);
    const hasFixed = physicsEntities.some((e) => !e.hasPhysics);

    return {
      entityCount: entities.length,
      entities,
      lightCount,
      hasShadows,
      hasPhysicsGround: hasFixed,
      hasDynamicBodies: hasDynamic,
      hasPlayerCharacter,
      hasCollectibles,
      hasEnemies,
      hasWinCondition,
      hasUI: false,
      hasDialogue: false,
      projectType: '3d' as const,
    };
  }, [sceneGraph, allGameComponents, primaryLight]);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CategoryBadge({ category }: { category: DesignCategory }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${CATEGORY_COLORS[category]}`}
    >
      {CATEGORY_LABELS[category]}
    </span>
  );
}

function ScoreBar({ score, max = 10 }: { score: number; max?: number }) {
  const pct = Math.round((score / max) * 100);
  const color =
    score >= 7
      ? 'bg-green-500'
      : score >= 5
        ? 'bg-yellow-500'
        : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-zinc-700">
        <div
          className={`h-1.5 rounded-full ${color} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-zinc-400">
        {score}/{max}
      </span>
    </div>
  );
}

function LessonCard({ lesson }: { lesson: DesignLesson }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 text-left transition-colors hover:border-zinc-600"
    >
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-200">
              {lesson.principle}
            </span>
            <CategoryBadge category={lesson.category} />
          </div>
          <p className="mt-1 text-xs text-zinc-400">{lesson.relevance}</p>
          {expanded && (
            <div className="mt-2 space-y-2 border-t border-zinc-700 pt-2">
              <p className="text-xs text-zinc-300">{lesson.explanation}</p>
              <div className="rounded bg-zinc-900/50 p-2">
                <p className="text-[11px] text-zinc-400">Example:</p>
                <p className="text-xs text-zinc-400">{lesson.example}</p>
              </div>
            </div>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
        ) : (
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
        )}
      </div>
    </button>
  );
}

function DecisionView({ data }: { data: DesignDecision }) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-zinc-200">{data.decision}</h4>
      <div>
        <p className="text-[11px] font-medium uppercase text-zinc-400">
          Reasoning
        </p>
        <ul className="mt-1 space-y-1">
          {data.reasoning.map((r, i) => (
            <li key={i} className="text-xs text-zinc-400">
              {r}
            </li>
          ))}
        </ul>
      </div>
      {data.principles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.principles.map((p) => (
            <span
              key={p}
              className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-400"
            >
              {p}
            </span>
          ))}
        </div>
      )}
      {data.alternatives.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase text-zinc-400">
            Alternatives Considered
          </p>
          {data.alternatives.map((alt, i) => (
            <div
              key={i}
              className="mt-1 rounded border border-zinc-700 bg-zinc-900/50 p-2"
            >
              <p className="text-xs font-medium text-zinc-300">
                {alt.description}
              </p>
              <p className="mt-1 text-[11px] text-zinc-400">
                {alt.whyNotChosen}
              </p>
            </div>
          ))}
        </div>
      )}
      {data.tradeoffs.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase text-zinc-400">
            Tradeoffs
          </p>
          <ul className="mt-1 space-y-1">
            {data.tradeoffs.map((t, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-zinc-400">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-yellow-500" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CritiqueView({ critique }: { critique: DesignCritique }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="text-2xl font-bold text-zinc-200">
          {critique.overallScore}
          <span className="text-sm font-normal text-zinc-400">/10</span>
        </div>
        <p className="flex-1 text-xs text-zinc-400">{critique.summary}</p>
      </div>
      {critique.strengths.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase text-zinc-400">
            Strengths
          </p>
          <ul className="mt-1 space-y-1">
            {critique.strengths.map((s, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 text-xs text-green-400"
              >
                <CheckCircle className="mt-0.5 h-3 w-3 shrink-0" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {critique.improvements.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase text-zinc-400">
            Improvements
          </p>
          <ul className="mt-1 space-y-1">
            {critique.improvements.map((s, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 text-xs text-yellow-400"
              >
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase text-zinc-400">
          Scores
        </p>
        {critique.scores.map((s) => (
          <div key={s.principle}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-300">{s.principle}</span>
            </div>
            <ScoreBar score={s.score} />
            <p className="mt-0.5 text-[11px] text-zinc-400">{s.feedback}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PrincipleCard({ principle }: { principle: DesignPrinciple }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 text-left transition-colors hover:border-zinc-600"
    >
      <div className="flex items-start gap-2">
        <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-200">
              {principle.name}
            </span>
            <CategoryBadge category={principle.category} />
          </div>
          {expanded && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-zinc-300">{principle.description}</p>
              <div className="rounded bg-zinc-900/50 p-2">
                <p className="text-[11px] text-zinc-400">Example:</p>
                <p className="text-xs text-zinc-400">{principle.example}</p>
              </div>
            </div>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
        ) : (
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type Tab = 'lessons' | 'explain' | 'critique' | 'reference';

const TAB_ITEMS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'lessons', label: 'Learn', icon: <Lightbulb className="h-3.5 w-3.5" /> },
  { id: 'explain', label: 'Why?', icon: <HelpCircle className="h-3.5 w-3.5" /> },
  { id: 'critique', label: 'Critique', icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: 'reference', label: 'Library', icon: <BookOpen className="h-3.5 w-3.5" /> },
];

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function DesignTeacherPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('lessons');
  const [decisionInput, setDecisionInput] = useState('');
  const [decisionResult, setDecisionResult] = useState<DesignDecision | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<DesignCategory | null>(null);

  const ctx = useTeacherSceneContext();

  // Lessons tab
  const lessons = useMemo(() => suggestLessons(ctx), [ctx]);

  // Critique tab
  const critique = useMemo(() => generateDesignCritique(ctx), [ctx]);

  // Reference tab — filtered principles
  // Use a Set of ids for O(1) intersection instead of Array.includes (O(n) per node).
  const filteredPrinciples = useMemo(() => {
    if (selectedCategory) {
      const byCategory = getPrinciplesByCategory(selectedCategory);
      if (searchQuery.trim()) {
        const searchedIds = new Set(searchPrinciples(searchQuery).map((p) => p.id));
        return byCategory.filter((p) => searchedIds.has(p.id));
      }
      return byCategory;
    }
    return searchPrinciples(searchQuery);
  }, [searchQuery, selectedCategory]);

  const handleExplain = useCallback(() => {
    if (!decisionInput.trim()) return;
    const result = explainDecision(decisionInput, ctx);
    setDecisionResult(result);
  }, [decisionInput, ctx]);

  const handleExplainKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleExplain();
      }
    },
    [handleExplain],
  );

  return (
    <div className="flex h-full flex-col bg-zinc-900 text-zinc-300">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-700 px-3 py-2">
        <Star className="h-4 w-4 text-yellow-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Design Teacher</h2>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-zinc-700">
        {TAB_ITEMS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            aria-label={tab.label}
            className={`flex flex-1 items-center justify-center gap-1 px-2 py-1.5 text-xs transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-blue-500 text-blue-400'
                : 'text-zinc-400 hover:text-zinc-300'
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'lessons' && (
          <div className="space-y-2">
            {lessons.length === 0 ? (
              <p className="text-center text-xs text-zinc-400">
                No lessons detected for the current scene state. Keep building!
              </p>
            ) : (
              <>
                <p className="text-xs text-zinc-400">
                  Based on your current scene, here are design principles to consider:
                </p>
                {lessons.map((lesson, i) => (
                  <LessonCard key={i} lesson={lesson} />
                ))}
              </>
            )}
          </div>
        )}

        {activeTab === 'explain' && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-400">
              Describe a design decision and get an explanation of the principles behind it.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={decisionInput}
                onChange={(e) => setDecisionInput(e.target.value)}
                onKeyDown={handleExplainKeyDown}
                placeholder="e.g., Add enemy patrols..."
                className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                aria-label="Design decision to explain"
              />
              <button
                onClick={handleExplain}
                disabled={!decisionInput.trim()}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
                aria-label="Explain decision"
              >
                Explain
              </button>
            </div>
            {decisionResult && <DecisionView data={decisionResult} />}
          </div>
        )}

        {activeTab === 'critique' && <CritiqueView critique={critique} />}

        {activeTab === 'reference' && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search principles..."
                className="w-full rounded border border-zinc-700 bg-zinc-800 py-1.5 pl-7 pr-2 text-xs text-zinc-200 placeholder-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                aria-label="Search design principles"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                  selectedCategory === null
                    ? 'bg-zinc-600 text-zinc-100'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-300'
                }`}
                aria-label="Show all categories"
              >
                All
              </button>
              {ALL_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() =>
                    setSelectedCategory(selectedCategory === cat ? null : cat)
                  }
                  className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                    selectedCategory === cat
                      ? 'bg-zinc-600 text-zinc-100'
                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-300'
                  }`}
                  aria-label={`Filter by ${CATEGORY_LABELS[cat]}`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {filteredPrinciples.length === 0 ? (
                <p className="text-center text-xs text-zinc-400">
                  No principles match your search.
                </p>
              ) : (
                filteredPrinciples.map((p) => (
                  <PrincipleCard key={p.id} principle={p} />
                ))
              )}
            </div>
            <p className="text-center text-[10px] text-zinc-400">
              {DESIGN_PRINCIPLES.length} principles across{' '}
              {ALL_CATEGORIES.length} categories
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
