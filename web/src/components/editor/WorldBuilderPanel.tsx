'use client';

import { useState, useCallback, useMemo } from 'react';
import { Globe, Users, Map, Clock, BookOpen, Scroll, Download, Sparkles, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import {
  WORLD_PRESETS,
  generateWorld,
  worldToMarkdown,
  type GameWorld,
  type Faction,
  type Region,
} from '@/lib/ai/worldBuilder';

// ---- Sub-components ----

function FactionCard({ faction }: { faction: Faction }) {
  const [expanded, setExpanded] = useState(false);
  const alignmentColor =
    faction.alignment === 'friendly'
      ? 'text-green-400'
      : faction.alignment === 'hostile'
        ? 'text-red-400'
        : 'text-yellow-400';

  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/50 p-2">
      <button
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label={`Toggle ${faction.name} details`}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-xs font-medium text-zinc-200">{faction.name}</span>
        <span className={`ml-auto text-[10px] ${alignmentColor}`}>{faction.alignment}</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1 pl-5 text-[11px] text-zinc-400">
          <p>{faction.description}</p>
          <p><span className="text-zinc-500">Leader:</span> {faction.leader}</p>
          <p><span className="text-zinc-500">Territory:</span> {faction.territory}</p>
          <p><span className="text-zinc-500">Traits:</span> {faction.traits.join(', ')}</p>
          {Object.keys(faction.relationships).length > 0 && (
            <div className="mt-1">
              <span className="text-zinc-500">Relationships:</span>
              <ul className="ml-3 mt-0.5">
                {Object.entries(faction.relationships).map(([name, rel]) => (
                  <li key={name}>
                    {name}:{' '}
                    <span
                      className={
                        rel === 'ally'
                          ? 'text-green-400'
                          : rel === 'enemy'
                            ? 'text-red-400'
                            : 'text-yellow-400'
                      }
                    >
                      {rel}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RegionNode({ region, allRegions }: { region: Region; allRegions: Region[] }) {
  const [expanded, setExpanded] = useState(false);
  const dangerColor =
    region.dangerLevel <= 3
      ? 'bg-green-500'
      : region.dangerLevel <= 6
        ? 'bg-yellow-500'
        : 'bg-red-500';

  // Only use allRegions for validation — check connections exist
  const validConnections = useMemo(
    () => {
      const regionNames = new Set(allRegions.map((r) => r.name));
      return region.connectedTo.filter((name) => regionNames.has(name));
    },
    [region.connectedTo, allRegions]
  );

  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/50 p-2">
      <button
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label={`Toggle ${region.name} details`}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-xs font-medium text-zinc-200">{region.name}</span>
        <span className="ml-auto flex items-center gap-1">
          <span className={`inline-block h-2 w-2 rounded-full ${dangerColor}`} />
          <span className="text-[10px] text-zinc-500">{region.dangerLevel}/10</span>
        </span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1 pl-5 text-[11px] text-zinc-400">
          <p>{region.description}</p>
          <p><span className="text-zinc-500">Biome:</span> {region.biome}</p>
          <p><span className="text-zinc-500">Resources:</span> {region.resources.join(', ')}</p>
          <p><span className="text-zinc-500">Landmarks:</span> {region.landmarks.join(', ')}</p>
          {validConnections.length > 0 && (
            <p><span className="text-zinc-500">Connected to:</span> {validConnections.join(', ')}</p>
          )}
        </div>
      )}
    </div>
  );
}

function TimelineView({ events }: { events: GameWorld['timeline'] }) {
  if (events.length === 0) return null;
  return (
    <div className="relative ml-3 border-l border-zinc-700 pl-4">
      {events.map((event, i) => (
        <div key={i} className="relative mb-3 last:mb-0">
          <div className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-blue-500" />
          <div className="text-[10px] text-blue-400">Year {event.year}</div>
          <div className="text-xs font-medium text-zinc-200">{event.name}</div>
          <div className="text-[11px] text-zinc-400">{event.description}</div>
          <div className="text-[10px] text-zinc-500 italic">{event.impact}</div>
          {event.factionsInvolved.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-1">
              {event.factionsInvolved.map((f) => (
                <span key={f} className="rounded bg-zinc-700 px-1 py-0.5 text-[9px] text-zinc-400">
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function LoreBrowser({ entries }: { entries: GameWorld['lore'] }) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const cats = new Set(entries.map((e) => e.category));
    return Array.from(cats).sort();
  }, [entries]);

  const filtered = selectedCategory
    ? entries.filter((e) => e.category === selectedCategory)
    : entries;

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">
        <button
          className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
            !selectedCategory ? 'bg-blue-600 text-white' : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
          }`}
          onClick={() => setSelectedCategory(null)}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            className={`rounded px-1.5 py-0.5 text-[10px] capitalize transition-colors ${
              selectedCategory === cat ? 'bg-blue-600 text-white' : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
            }`}
            onClick={() => setSelectedCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {filtered.map((entry, i) => (
          <div key={i} className="rounded border border-zinc-700 bg-zinc-800/50 p-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-zinc-200">{entry.title}</span>
              <span className="rounded bg-zinc-700 px-1 py-0.5 text-[9px] capitalize text-zinc-500">
                {entry.category}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-400">{entry.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Section wrapper ----

function Section({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-zinc-800 pb-2">
      <button
        className="flex w-full items-center gap-1.5 py-1.5 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        <span className="text-xs font-semibold uppercase text-zinc-400">{title}</span>
        {count != null && (
          <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
            {count}
          </span>
        )}
      </button>
      {open && <div className="mt-1 space-y-1.5">{children}</div>}
    </div>
  );
}

// ---- Main panel ----

const PRESET_OPTIONS = [
  { value: '', label: 'Custom (AI generates from description)' },
  { value: 'medieval_fantasy', label: 'Medieval Fantasy' },
  { value: 'sci_fi_space', label: 'Sci-Fi Space Opera' },
  { value: 'post_apocalyptic', label: 'Post-Apocalyptic' },
  { value: 'cyberpunk_city', label: 'Cyberpunk City' },
  { value: 'mythological', label: 'Mythological' },
];

export function WorldBuilderPanel() {
  const [description, setDescription] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [world, setWorld] = useState<GameWorld | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await generateWorld(description, selectedPreset || undefined);
      setWorld(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate world');
    } finally {
      setLoading(false);
    }
  }, [description, selectedPreset]);

  const handleLoadPreset = useCallback(() => {
    if (selectedPreset && WORLD_PRESETS[selectedPreset]) {
      setWorld(structuredClone(WORLD_PRESETS[selectedPreset]));
      setError(null);
    }
  }, [selectedPreset]);

  const handleExportMarkdown = useCallback(() => {
    if (!world) return;
    const md = worldToMarkdown(world);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${world.name.toLowerCase().replace(/\s+/g, '-')}-lore.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Defer revocation so the browser's download manager can read the blob
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [world]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-900 text-zinc-300">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Globe size={14} className="text-blue-400" />
        <span className="text-xs font-semibold uppercase text-zinc-400">World Builder</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* Input section */}
        <div className="mb-4 space-y-2">
          <label className="block text-[11px] text-zinc-500" htmlFor="world-desc">
            Describe your world concept
          </label>
          <textarea
            id="world-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A steampunk world where clockwork automatons have gained sentience..."
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            rows={3}
          />

          <label className="block text-[11px] text-zinc-500" htmlFor="world-preset">
            Genre preset (optional)
          </label>
          <select
            id="world-preset"
            value={selectedPreset}
            onChange={(e) => setSelectedPreset(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {PRESET_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <button
              onClick={handleGenerate}
              disabled={loading || (!description.trim() && !selectedPreset)}
              className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Generate world with AI"
            >
              {loading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              Generate
            </button>
            {selectedPreset && (
              <button
                onClick={handleLoadPreset}
                disabled={loading}
                className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
                aria-label="Load preset world"
              >
                Load Preset
              </button>
            )}
          </div>

          {error && (
            <div className="rounded border border-red-800 bg-red-900/30 px-2 py-1 text-[11px] text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* World display */}
        {world && (
          <div className="space-y-3">
            {/* World header */}
            <div className="rounded border border-zinc-700 bg-zinc-800/50 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-sm font-bold text-zinc-100">{world.name}</h2>
                  <div className="mt-0.5 flex gap-2 text-[10px] text-zinc-500">
                    <span>{world.genre}</span>
                    <span>|</span>
                    <span>{world.era}</span>
                  </div>
                </div>
                <button
                  onClick={handleExportMarkdown}
                  className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
                  aria-label="Export world as markdown"
                >
                  <Download size={10} />
                  Export
                </button>
              </div>
              <p className="mt-2 text-[11px] text-zinc-400">{world.description}</p>
            </div>

            {/* Factions */}
            <Section
              title="Factions"
              icon={<Users size={12} className="text-purple-400" />}
              count={world.factions.length}
            >
              {world.factions.map((f) => (
                <FactionCard key={f.name} faction={f} />
              ))}
            </Section>

            {/* Regions */}
            <Section
              title="Regions"
              icon={<Map size={12} className="text-green-400" />}
              count={world.regions.length}
            >
              {world.regions.map((r) => (
                <RegionNode key={r.name} region={r} allRegions={world.regions} />
              ))}
            </Section>

            {/* Timeline */}
            <Section
              title="Timeline"
              icon={<Clock size={12} className="text-blue-400" />}
              count={world.timeline.length}
            >
              <TimelineView events={world.timeline} />
            </Section>

            {/* Lore */}
            <Section
              title="Lore"
              icon={<BookOpen size={12} className="text-amber-400" />}
              count={world.lore.length}
            >
              <LoreBrowser entries={world.lore} />
            </Section>

            {/* Rules */}
            <Section
              title="Gameplay Rules"
              icon={<Scroll size={12} className="text-cyan-400" />}
              count={world.rules.length}
            >
              {world.rules.map((rule, i) => (
                <div key={i} className="rounded border border-zinc-700 bg-zinc-800/50 p-2">
                  <div className="text-xs font-medium text-zinc-200">{rule.name}</div>
                  <p className="mt-0.5 text-[11px] text-zinc-400">{rule.description}</p>
                  <p className="mt-0.5 text-[10px] italic text-zinc-500">{rule.gameplayEffect}</p>
                </div>
              ))}
            </Section>
          </div>
        )}

        {/* Empty state */}
        {!world && !loading && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Globe size={32} className="mb-3 text-zinc-700" />
            <p className="text-xs text-zinc-500">
              Describe a world concept or select a genre preset to get started.
            </p>
            <p className="mt-1 text-[10px] text-zinc-600">
              The AI will generate factions, regions, history, and lore for your game.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
