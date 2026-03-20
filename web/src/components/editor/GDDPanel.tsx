'use client';

import { useState, useCallback } from 'react';
import { FileText, ChevronDown, ChevronRight, Download, Loader2, Wand2 } from 'lucide-react';
import {
  generateGDD,
  gddToMarkdown,
  detectGenre,
  estimateScope,
  type GameDesignDocument,
  type GDDSection,
  type GDDGenerateOptions,
} from '@/lib/ai/gddGenerator';

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function GDDSectionView({ section, level }: { section: GDDSection; level: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasSubsections = section.subsections && section.subsections.length > 0;

  const headingSize = level === 0 ? 'text-xs font-semibold' : 'text-[11px] font-medium';
  const paddingLeft = level > 0 ? `pl-${Math.min(level * 3, 9)}` : '';

  return (
    <div className={`${paddingLeft}`}>
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className={`flex w-full items-center gap-1.5 py-1 text-left text-zinc-300 hover:text-white transition-colors ${headingSize}`}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {section.title}
      </button>
      {expanded && (
        <div className="pl-4 pb-2">
          <p className="text-[11px] text-zinc-400 leading-relaxed whitespace-pre-wrap">
            {section.content}
          </p>
          {hasSubsections &&
            section.subsections!.map((sub, i) => (
              <GDDSectionView key={`${sub.title}-${i}`} section={sub} level={level + 1} />
            ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GDD Result View
// ---------------------------------------------------------------------------

function GDDResultView({
  gdd,
  onExport,
}: {
  gdd: GameDesignDocument;
  onExport: () => void;
}) {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-white">{gdd.title}</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className="rounded bg-purple-900/50 px-1.5 py-0.5 text-[10px] text-purple-300">
              {gdd.genre}
            </span>
            <span className="rounded bg-blue-900/50 px-1.5 py-0.5 text-[10px] text-blue-300">
              {gdd.estimatedScope}
            </span>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {gdd.artStyle}
            </span>
          </div>
        </div>
        <button
          onClick={onExport}
          className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
          title="Export as Markdown"
          aria-label="Export GDD as Markdown"
        >
          <Download size={12} />
        </button>
      </div>

      {/* Summary */}
      <p className="text-[11px] italic text-zinc-400 border-l-2 border-purple-600 pl-2">
        {gdd.summary}
      </p>

      {/* Mechanics */}
      {gdd.mechanics.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
            Key Mechanics
          </h4>
          <div className="flex flex-wrap gap-1">
            {gdd.mechanics.map((m) => (
              <span
                key={m}
                className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Sections */}
      <div className="space-y-1 border-t border-zinc-800 pt-2">
        {gdd.sections.map((section, i) => (
          <GDDSectionView key={`${section.title}-${i}`} section={section} level={0} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Genre / Scope selectors
// ---------------------------------------------------------------------------

const GENRE_OPTIONS = [
  '', 'Platformer', 'RPG', 'Puzzle', 'Shooter', 'Adventure',
  'Racing', 'Strategy', 'Simulation', 'Horror', 'Fighting', 'Runner',
];

const SCOPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Auto-detect' },
  { value: 'small', label: 'Small (weekend)' },
  { value: 'medium', label: 'Medium (1-4 weeks)' },
  { value: 'large', label: 'Large (1+ months)' },
];

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function GDDPanel() {
  const [prompt, setPrompt] = useState('');
  const [genre, setGenre] = useState('');
  const [scope, setScope] = useState('');
  const [gdd, setGdd] = useState<GameDesignDocument | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectedGenre = prompt.trim() ? detectGenre(prompt) : null;
  const detectedScope = prompt.trim() ? estimateScope(prompt) : null;

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;

    setIsGenerating(true);
    setError(null);

    const options: GDDGenerateOptions = {};
    if (genre) options.genre = genre;
    if (scope) options.scope = scope as 'small' | 'medium' | 'large';

    try {
      const result = await generateGDD(prompt, options);
      setGdd(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate GDD');
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, genre, scope, isGenerating]);

  const handleExport = useCallback(() => {
    if (!gdd) return;
    const md = gddToMarkdown(gdd);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${gdd.title.replace(/[^a-zA-Z0-9]/g, '_')}_GDD.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }, [gdd]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleGenerate();
      }
    },
    [handleGenerate],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-zinc-800 px-3 py-2">
        <FileText size={14} className="text-amber-400" />
        <span className="text-xs font-medium text-zinc-300">Game Design Document</span>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {/* Prompt input */}
        <div>
          <label htmlFor="gdd-prompt" className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-1">
            Game Idea
          </label>
          <textarea
            id="gdd-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your game idea... e.g., 'a platformer where you collect stars in a haunted castle'"
            rows={3}
            className="w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
            disabled={isGenerating}
          />
          {prompt.trim() && (
            <div className="mt-1 flex gap-2 text-[10px] text-zinc-600">
              {detectedGenre && !genre && (
                <span>Detected genre: <span className="text-zinc-400">{detectedGenre}</span></span>
              )}
              {detectedScope && !scope && (
                <span>Est. scope: <span className="text-zinc-400">{detectedScope}</span></span>
              )}
            </div>
          )}
        </div>

        {/* Options */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="gdd-genre" className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-1">
              Genre
            </label>
            <select
              id="gdd-genre"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-amber-600 focus:outline-none"
              disabled={isGenerating}
            >
              <option value="">Auto-detect</option>
              {GENRE_OPTIONS.filter(Boolean).map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label htmlFor="gdd-scope" className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-1">
              Scope
            </label>
            <select
              id="gdd-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-amber-600 focus:outline-none"
              disabled={isGenerating}
            >
              {SCOPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={!prompt.trim() || isGenerating}
          className="flex w-full items-center justify-center gap-2 rounded bg-amber-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Generating GDD...
            </>
          ) : (
            <>
              <Wand2 size={14} />
              Generate GDD
            </>
          )}
        </button>
        <p className="text-[10px] text-zinc-600 text-center">
          Ctrl+Enter to generate
        </p>

        {/* Error */}
        {error && (
          <div role="alert" className="rounded border border-red-900/50 bg-red-900/20 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        {/* Result */}
        {gdd && !isGenerating && (
          <GDDResultView gdd={gdd} onExport={handleExport} />
        )}

        {/* Empty state */}
        {!gdd && !isGenerating && !error && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <FileText size={28} className="text-zinc-700" />
            <p className="text-[11px] text-zinc-500 max-w-[200px]">
              Describe your game idea and generate a structured design document in seconds.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
