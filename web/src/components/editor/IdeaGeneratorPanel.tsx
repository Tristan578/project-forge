'use client';

import { useState, useCallback, useMemo } from 'react';
import { Lightbulb, RefreshCw, Sparkles, ChevronDown, ChevronUp, TrendingUp, Filter } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import {
  GENRE_CATALOG,
  MECHANIC_CATALOG,
  generateIdeas,
  buildGddPrompt,
  type GameIdea,
  type IdeaFilters,
} from '@/lib/ai/ideaGenerator';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 75
      ? 'bg-green-600/20 text-green-400 border-green-600/30'
      : score >= 50
        ? 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30'
        : 'bg-red-600/20 text-red-400 border-red-600/30';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${color}`}>
      <TrendingUp size={10} />
      {score}
    </span>
  );
}

function ComplexityDot({ complexity }: { complexity: string }) {
  const color =
    complexity === 'low'
      ? 'bg-green-500'
      : complexity === 'medium'
        ? 'bg-yellow-500'
        : 'bg-red-500';
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${color}`}
      title={`${complexity} complexity`}
    />
  );
}

function IdeaCard({
  idea,
  onUse,
}: {
  idea: GameIdea;
  onUse: (idea: GameIdea) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 transition-colors hover:border-zinc-600">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Lightbulb size={14} className="shrink-0 text-amber-400" />
            <h3 className="truncate text-sm font-medium text-zinc-100">
              {idea.title}
            </h3>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <ScoreBadge score={idea.score} />
            <span className="text-[10px] text-zinc-400">
              {idea.genreMix.primary.name} + {idea.genreMix.secondary.name}
            </span>
          </div>
        </div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Description */}
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">
        {idea.description}
      </p>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 space-y-2 border-t border-zinc-700 pt-3">
          {/* Mechanics */}
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              Mechanics
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {idea.mechanicCombo.mechanics.map((m) => (
                <span
                  key={m.id}
                  className="inline-flex items-center gap-1 rounded bg-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300"
                >
                  <ComplexityDot complexity={m.complexity} />
                  {m.name}
                </span>
              ))}
            </div>
          </div>

          {/* Hooks */}
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              Hooks
            </div>
            <ul className="mt-1 list-inside list-disc text-[11px] text-zinc-400">
              {idea.hooks.map((hook) => (
                <li key={hook}>{hook}</li>
              ))}
            </ul>
          </div>

          {/* Target Audience */}
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              Target Audience
            </div>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              {idea.targetAudience}
            </p>
          </div>
        </div>
      )}

      {/* Use button */}
      <button
        onClick={() => onUse(idea)}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
      >
        <Sparkles size={12} />
        Use This Idea
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter Panel
// ---------------------------------------------------------------------------

function FilterSection({
  filters,
  onFiltersChange,
}: {
  filters: IdeaFilters;
  onFiltersChange: (filters: IdeaFilters) => void;
}) {
  const [showFilters, setShowFilters] = useState(false);

  const toggleGenre = useCallback(
    (genreId: string) => {
      const current = filters.genreIds ?? [];
      const next = current.includes(genreId)
        ? current.filter((id) => id !== genreId)
        : [...current, genreId];
      onFiltersChange({ ...filters, genreIds: next.length > 0 ? next : undefined });
    },
    [filters, onFiltersChange],
  );

  const toggleMechanic = useCallback(
    (mechanicId: string) => {
      const current = filters.mechanicIds ?? [];
      const next = current.includes(mechanicId)
        ? current.filter((id) => id !== mechanicId)
        : [...current, mechanicId];
      onFiltersChange({ ...filters, mechanicIds: next.length > 0 ? next : undefined });
    },
    [filters, onFiltersChange],
  );

  const activeCount =
    (filters.genreIds?.length ?? 0) +
    (filters.mechanicIds?.length ?? 0) +
    (filters.trendingOnly ? 1 : 0) +
    (filters.maxComplexity ? 1 : 0);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setShowFilters((s) => !s)}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
      >
        <Filter size={12} />
        <span>Filters</span>
        {activeCount > 0 && (
          <span className="rounded-full bg-indigo-600/30 px-1.5 text-[10px] text-indigo-300">
            {activeCount}
          </span>
        )}
        {showFilters ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
      </button>

      {showFilters && (
        <div className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-800/50 p-2">
          {/* Trending toggle */}
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={filters.trendingOnly ?? false}
              onChange={(e) => onFiltersChange({ ...filters, trendingOnly: e.target.checked || undefined })}
              className="rounded border-zinc-600"
            />
            Trending genres only
          </label>

          {/* Max complexity */}
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              Max Complexity
            </div>
            <div className="mt-1 flex gap-1">
              {(['low', 'medium', 'high'] as const).map((level) => (
                <button
                  key={level}
                  onClick={() =>
                    onFiltersChange({
                      ...filters,
                      maxComplexity: filters.maxComplexity === level ? undefined : level,
                    })
                  }
                  className={`rounded px-2 py-0.5 text-[10px] capitalize transition-colors ${
                    filters.maxComplexity === level
                      ? 'bg-indigo-600/30 text-indigo-300'
                      : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Genre filter */}
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              Genres
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {GENRE_CATALOG.map((genre) => (
                <button
                  key={genre.id}
                  onClick={() => toggleGenre(genre.id)}
                  className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                    filters.genreIds?.includes(genre.id)
                      ? 'bg-indigo-600/30 text-indigo-300'
                      : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
                  }`}
                >
                  {genre.name}
                  {genre.trending && <TrendingUp size={8} className="ml-0.5 inline" />}
                </button>
              ))}
            </div>
          </div>

          {/* Mechanic filter */}
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              Mechanics
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {MECHANIC_CATALOG.map((mechanic) => (
                <button
                  key={mechanic.id}
                  onClick={() => toggleMechanic(mechanic.id)}
                  className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                    filters.mechanicIds?.includes(mechanic.id)
                      ? 'bg-indigo-600/30 text-indigo-300'
                      : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
                  }`}
                >
                  <ComplexityDot complexity={mechanic.complexity} /> {mechanic.name}
                </button>
              ))}
            </div>
          </div>

          {/* Clear all */}
          {activeCount > 0 && (
            <button
              onClick={() => onFiltersChange({})}
              className="text-[10px] text-zinc-400 underline hover:text-zinc-300"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function IdeaGeneratorPanel() {
  const [ideas, setIdeas] = useState<GameIdea[]>([]);
  const [filters, setFilters] = useState<IdeaFilters>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setRightPanelTab = useChatStore((s) => s.setRightPanelTab);

  const handleGenerate = useCallback(() => {
    setIsGenerating(true);
    // Tiny delay to show loading state
    requestAnimationFrame(() => {
      const newIdeas = generateIdeas(5, filters);
      setIdeas(newIdeas);
      setIsGenerating(false);
    });
  }, [filters]);

  const handleUseIdea = useCallback(
    (idea: GameIdea) => {
      if (isStreaming) return;
      const prompt = buildGddPrompt(idea);
      void sendMessage(prompt);
      setRightPanelTab('chat');
    },
    [sendMessage, setRightPanelTab, isStreaming],
  );

  const hasIdeas = ideas.length > 0;

  const ideaList = useMemo(
    () =>
      ideas.map((idea) => (
        <IdeaCard key={idea.id} idea={idea} onUse={handleUseIdea} />
      )),
    [ideas, handleUseIdea],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <Lightbulb size={14} className="text-amber-400" />
          <span className="text-xs font-medium text-zinc-200">Idea Generator</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {/* Filters */}
        <FilterSection filters={filters} onFiltersChange={setFilters} />

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-all hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50"
        >
          {isGenerating ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <Sparkles size={14} />
          )}
          {isGenerating ? 'Generating...' : hasIdeas ? 'Generate More Ideas' : 'Generate Ideas'}
        </button>

        {/* Ideas list */}
        {hasIdeas && (
          <div className="mt-4 space-y-3">
            {ideaList}
          </div>
        )}

        {/* Empty state */}
        {!hasIdeas && !isGenerating && (
          <div className="mt-8 text-center">
            <Lightbulb size={32} className="mx-auto text-zinc-700" />
            <p className="mt-2 text-xs text-zinc-400">
              Click the button to generate game ideas by remixing genres and mechanics
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
