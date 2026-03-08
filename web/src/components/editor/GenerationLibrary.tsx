'use client';

import { useState, useCallback } from 'react';
import { Search, Trash2, RotateCcw, Download, X, Clock, Sparkles } from 'lucide-react';
import { useGenerationHistoryStore, type HistoryEntry } from '@/stores/generationHistoryStore';
import type { GenerationType } from '@/stores/generationStore';

const TYPE_LABELS: Record<GenerationType, string> = {
  model: '3D Model',
  texture: 'Texture',
  sfx: 'Sound FX',
  voice: 'Voice',
  skybox: 'Skybox',
  music: 'Music',
  sprite: 'Sprite',
  sprite_sheet: 'Sprite Sheet',
  tileset: 'Tileset',
  'pixel-art': 'Pixel Art',
};

const TYPE_COLORS: Record<GenerationType, string> = {
  model: 'bg-blue-600',
  texture: 'bg-green-600',
  sfx: 'bg-orange-600',
  voice: 'bg-purple-600',
  skybox: 'bg-cyan-600',
  music: 'bg-pink-600',
  sprite: 'bg-yellow-600',
  sprite_sheet: 'bg-yellow-700',
  tileset: 'bg-teal-600',
  'pixel-art': 'bg-indigo-600',
};

const ALL_TYPES: GenerationType[] = [
  'model', 'texture', 'sfx', 'voice', 'skybox', 'music', 'sprite', 'sprite_sheet', 'tileset', 'pixel-art',
];

interface GenerationLibraryProps {
  onClose: () => void;
  onRegenerate?: (entry: HistoryEntry) => void;
}

export function GenerationLibrary({ onClose, onRegenerate }: GenerationLibraryProps) {
  const entries = useGenerationHistoryStore((s) => s.filteredEntries());
  const searchQuery = useGenerationHistoryStore((s) => s.searchQuery);
  const filterType = useGenerationHistoryStore((s) => s.filterType);
  const setSearchQuery = useGenerationHistoryStore((s) => s.setSearchQuery);
  const setFilterType = useGenerationHistoryStore((s) => s.setFilterType);
  const removeEntry = useGenerationHistoryStore((s) => s.removeEntry);
  const clearAll = useGenerationHistoryStore((s) => s.clearAll);
  const allEntries = useGenerationHistoryStore((s) => s.entries);

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleClear = useCallback(() => {
    clearAll();
    setShowClearConfirm(false);
  }, [clearAll]);

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60_000) return 'Just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-blue-400" />
          <h2 className="font-semibold text-zinc-200">Generation Library</h2>
          <span className="text-xs text-zinc-500">({allEntries.length})</span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      {/* Search + Filter */}
      <div className="border-b border-zinc-700 px-4 py-2 space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search prompts..."
            className="w-full rounded border border-zinc-700 bg-zinc-900 pl-8 pr-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          <FilterChip
            label="All"
            active={filterType === 'all'}
            onClick={() => setFilterType('all')}
          />
          {ALL_TYPES.map((t) => (
            <FilterChip
              key={t}
              label={TYPE_LABELS[t]}
              active={filterType === t}
              onClick={() => setFilterType(t)}
            />
          ))}
        </div>
      </div>

      {/* Entries List */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-zinc-500">
            <Sparkles size={32} />
            <p className="text-sm">
              {allEntries.length === 0
                ? 'No generations yet. Generated assets will appear here.'
                : 'No results match your search.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                onRemove={() => removeEntry(entry.id)}
                onRegenerate={onRegenerate ? () => onRegenerate(entry) : undefined}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {allEntries.length > 0 && (
        <div className="border-t border-zinc-700 px-4 py-2">
          {showClearConfirm ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">Clear all history?</span>
              <button
                onClick={handleClear}
                className="rounded bg-red-700 px-2 py-0.5 text-xs text-white hover:bg-red-600"
              >
                Confirm
              </button>
              <button
                onClick={() => setShowClearConfirm(false)}
                className="rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-red-400 transition-colors"
            >
              <Trash2 size={12} />
              Clear history
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  );
}

function EntryRow({
  entry,
  onRemove,
  onRegenerate,
  formatDate,
}: {
  entry: HistoryEntry;
  onRemove: () => void;
  onRegenerate?: () => void;
  formatDate: (ts: number) => string;
}) {
  return (
    <div className="group flex items-start gap-3 px-4 py-3 hover:bg-zinc-800/50 transition-colors">
      {/* Type badge */}
      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${TYPE_COLORS[entry.type]}`}>
        {TYPE_LABELS[entry.type]}
      </span>

      {/* Prompt + meta */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-zinc-200" title={entry.prompt}>
          {entry.prompt}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
          <span className="flex items-center gap-0.5">
            <Clock size={10} />
            {formatDate(entry.createdAt)}
          </span>
          <span>{entry.provider}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {entry.resultUrl && (
          <a
            href={entry.resultUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
            title="Download result"
          >
            <Download size={14} />
          </a>
        )}
        {onRegenerate && (
          <button
            onClick={onRegenerate}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-blue-400"
            title="Regenerate with same prompt"
          >
            <RotateCcw size={14} />
          </button>
        )}
        <button
          onClick={onRemove}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
          title="Remove from library"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
