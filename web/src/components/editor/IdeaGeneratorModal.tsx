'use client';

import { useState, useCallback } from 'react';
import { Lightbulb, RefreshCw, Play, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import {
  generateIdeas,
  GENRE_CATALOG,
  MECHANIC_CATALOG,
  type GameIdea,
  type IdeaFilters,
} from '@/lib/ai/ideaGenerator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IdeaGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called when the user clicks "Start" on an idea. */
  onStart?: (idea: GameIdea) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IdeaGeneratorModal({ isOpen, onClose, onStart }: IdeaGeneratorModalProps) {
  const [ideas, setIdeas] = useState<GameIdea[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedGenre, setSelectedGenre] = useState('');
  const [selectedComplexity, setSelectedComplexity] = useState<'' | 'low' | 'medium' | 'high'>('');
  const [trendingOnly, setTrendingOnly] = useState(false);

  const dialogRef = useDialogA11y(onClose);

  // Generate on open — use prev-value pattern to avoid setState in an effect body.
  // Build filters from the current UI control state rather than the `filters`
  // snapshot, which may be stale if the user changed controls without clicking
  // Generate before closing the modal.
  const [prevIsOpen, setPrevIsOpen] = useState(false);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      const currentFilters: IdeaFilters = {
        genreIds: selectedGenre ? [selectedGenre] : undefined,
        maxComplexity: selectedComplexity || undefined,
        trendingOnly: trendingOnly || undefined,
      };
      setIdeas(generateIdeas(3, currentFilters));
    }
  }

  const handleRegenerate = useCallback(() => {
    const activeFilters: IdeaFilters = {
      genreIds: selectedGenre ? [selectedGenre] : undefined,
      maxComplexity: selectedComplexity || undefined,
      trendingOnly: trendingOnly || undefined,
    };
    setIdeas(generateIdeas(3, activeFilters));
    setExpandedId(null);
  }, [selectedGenre, selectedComplexity, trendingOnly]);

  const handleStart = useCallback(
    (idea: GameIdea) => {
      onStart?.(idea);
      onClose();
    },
    [onStart, onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="idea-gen-title"
        tabIndex={-1}
        className="mx-4 flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 p-4">
          <div className="flex items-center gap-2">
            <Lightbulb size={18} className="text-yellow-400" />
            <h2 id="idea-gen-title" className="text-sm font-semibold text-zinc-100">
              Game Idea Generator
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close idea generator"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Filters (collapsible) */}
        <div className="border-b border-zinc-700/50 px-4 py-2">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {showFilters ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Filters
          </button>
          {showFilters && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="genre-filter" className="mb-1 block text-xs text-zinc-400">
                  Genre
                </label>
                <select
                  id="genre-filter"
                  value={selectedGenre}
                  onChange={(e) => setSelectedGenre(e.target.value)}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Any genre</option>
                  {GENRE_CATALOG.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {g.trending ? ' *' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="complexity-filter" className="mb-1 block text-xs text-zinc-400">
                  Max complexity
                </label>
                <select
                  id="complexity-filter"
                  value={selectedComplexity}
                  onChange={(e) => setSelectedComplexity(e.target.value as typeof selectedComplexity)}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Any complexity</option>
                  <option value="low">Low — simple mechanics</option>
                  <option value="medium">Medium</option>
                  <option value="high">High — deep systems</option>
                </select>
              </div>
              <label className="col-span-2 flex items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={trendingOnly}
                  onChange={(e) => setTrendingOnly(e.target.checked)}
                  className="rounded border-zinc-600 bg-zinc-800"
                />
                Trending genres only
              </label>
            </div>
          )}
        </div>

        {/* Idea cards */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {ideas.length === 0 ? (
            <p className="text-center text-sm text-zinc-500 py-8">
              Click Generate to create ideas.
            </p>
          ) : (
            ideas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                expanded={expandedId === idea.id}
                onToggleExpand={() =>
                  setExpandedId((prev) => (prev === idea.id ? null : idea.id))
                }
                onStart={handleStart}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-700 p-3 flex items-center justify-between gap-2">
          <p className="text-xs text-zinc-500">* = trending genre</p>
          <button
            onClick={handleRegenerate}
            className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-600 transition-colors"
          >
            <RefreshCw size={12} />
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IdeaCard sub-component
// ---------------------------------------------------------------------------

interface IdeaCardProps {
  idea: GameIdea;
  expanded: boolean;
  onToggleExpand: () => void;
  onStart: (idea: GameIdea) => void;
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 75
      ? 'text-green-400 bg-green-900/30 border-green-800/50'
      : score >= 50
        ? 'text-yellow-400 bg-yellow-900/30 border-yellow-800/50'
        : 'text-zinc-400 bg-zinc-800 border-zinc-700';
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      {score}
    </span>
  );
}

function MechanicPill({ name, complexity }: { name: string; complexity: string }) {
  const color =
    complexity === 'high'
      ? 'bg-purple-900/30 text-purple-300 border-purple-800/40'
      : complexity === 'medium'
        ? 'bg-blue-900/30 text-blue-300 border-blue-800/40'
        : 'bg-zinc-800 text-zinc-300 border-zinc-700';
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${color}`}>{name}</span>
  );
}

function IdeaCard({ idea, expanded, onToggleExpand, onStart }: IdeaCardProps) {
  const mechanicsMap: Record<string, string> = Object.fromEntries(
    MECHANIC_CATALOG.map((m) => [m.name, m.complexity])
  );

  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/60">
      {/* Summary row */}
      <button
        onClick={onToggleExpand}
        className="flex w-full items-start gap-2 p-3 text-left"
        aria-expanded={expanded}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-zinc-100 truncate">{idea.title}</span>
            <ScoreBadge score={idea.score} />
          </div>
          <span className="text-[11px] text-zinc-400">
            {idea.genreMix.primary.name} + {idea.genreMix.secondary.name}
          </span>
        </div>
        {expanded ? (
          <ChevronUp size={14} className="shrink-0 mt-1 text-zinc-400" />
        ) : (
          <ChevronDown size={14} className="shrink-0 mt-1 text-zinc-400" />
        )}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-zinc-700/50 px-3 pb-3 pt-2 space-y-2">
          <p className="text-xs text-zinc-300 leading-relaxed">{idea.description}</p>

          {/* Mechanics */}
          <div className="flex flex-wrap gap-1">
            {idea.mechanicCombo.mechanics.map((m) => (
              <MechanicPill
                key={m.id}
                name={m.name}
                complexity={mechanicsMap[m.name] ?? m.complexity}
              />
            ))}
          </div>

          {/* Hooks */}
          <ul className="space-y-0.5">
            {idea.hooks.map((hook) => (
              <li key={hook} className="flex items-start gap-1.5 text-[11px] text-zinc-400">
                <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-blue-400" />
                {hook}
              </li>
            ))}
          </ul>

          {/* Audience */}
          <p className="text-[11px] text-zinc-500">
            <span className="text-zinc-400">Audience: </span>
            {idea.targetAudience}
          </p>

          {/* Start button */}
          <button
            onClick={() => onStart(idea)}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors mt-1"
          >
            <Play size={12} />
            Start this idea
          </button>
        </div>
      )}
    </div>
  );
}
