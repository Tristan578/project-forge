'use client';

import { useState, useCallback, useEffect } from 'react';
import { Globe, Users, Map, Clock, BookOpen, Shield, RefreshCw, Download, AlertTriangle, CheckCircle } from 'lucide-react';
import type { GameWorld, ConsistencyReport } from '@/lib/ai/worldBuilder';
import { validateWorldConsistency, worldToMarkdown, loadPersistedWorld } from '@/lib/ai/worldBuilder';

const RELATIONSHIP_COLORS: Record<string, string> = {
  ally: 'text-green-400',
  enemy: 'text-red-400',
  neutral: 'text-zinc-400',
};

const ALIGNMENT_COLORS: Record<string, string> = {
  friendly: 'bg-green-900/40 border-green-700/50',
  hostile: 'bg-red-900/40 border-red-700/50',
  neutral: 'bg-zinc-800/60 border-zinc-700/50',
};

function FactionCard({ faction }: { faction: GameWorld['factions'][0] }) {
  const [expanded, setExpanded] = useState(false);
  const relEntries = Object.entries(faction.relationships);

  return (
    <div className={`rounded border p-2 ${ALIGNMENT_COLORS[faction.alignment] ?? 'bg-zinc-800 border-zinc-700'}`}>
      <button
        className="w-full flex items-center justify-between gap-2 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Users className="w-3 h-3 text-zinc-400 shrink-0" />
          <span className="text-xs font-semibold text-zinc-200 truncate">{faction.name}</span>
          <span className="text-xs text-zinc-500 shrink-0">({faction.alignment})</span>
        </div>
        <span className="text-zinc-500 text-xs">{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1 pl-5">
          <p className="text-xs text-zinc-400">{faction.description}</p>
          <p className="text-xs text-zinc-500">
            <span className="text-zinc-400">Leader:</span> {faction.leader}
          </p>
          <p className="text-xs text-zinc-500">
            <span className="text-zinc-400">Territory:</span> {faction.territory}
          </p>
          {faction.traits.length > 0 && (
            <p className="text-xs text-zinc-500">
              <span className="text-zinc-400">Traits:</span> {faction.traits.join(', ')}
            </p>
          )}
          {relEntries.length > 0 && (
            <div className="mt-1">
              <p className="text-xs text-zinc-400 font-medium">Relationships:</p>
              <div className="grid grid-cols-1 gap-0.5 mt-0.5">
                {relEntries.map(([name, rel]) => (
                  <p key={name} className="text-xs text-zinc-500">
                    {name}:{' '}
                    <span className={RELATIONSHIP_COLORS[rel] ?? 'text-zinc-400'}>{rel}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RegionItem({ region }: { region: GameWorld['regions'][0] }) {
  const [expanded, setExpanded] = useState(false);
  const dangerColor =
    region.dangerLevel >= 8 ? 'text-red-400' :
    region.dangerLevel >= 5 ? 'text-yellow-400' :
    'text-green-400';

  return (
    <div className="rounded border border-zinc-700/50 bg-zinc-800/40 p-2">
      <button
        className="w-full flex items-center justify-between gap-2 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Map className="w-3 h-3 text-zinc-400 shrink-0" />
          <span className="text-xs font-semibold text-zinc-200 truncate">{region.name}</span>
          <span className="text-xs text-zinc-500 shrink-0">[{region.biome}]</span>
        </div>
        <span className={`text-xs font-mono shrink-0 ${dangerColor}`}>
          ⚠ {region.dangerLevel}/10
        </span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1 pl-5">
          <p className="text-xs text-zinc-400">{region.description}</p>
          {region.resources.length > 0 && (
            <p className="text-xs text-zinc-500">
              <span className="text-zinc-400">Resources:</span> {region.resources.join(', ')}
            </p>
          )}
          {region.landmarks.length > 0 && (
            <p className="text-xs text-zinc-500">
              <span className="text-zinc-400">Landmarks:</span> {region.landmarks.join(', ')}
            </p>
          )}
          {region.connectedTo.length > 0 && (
            <p className="text-xs text-zinc-500">
              <span className="text-zinc-400">Connected to:</span> {region.connectedTo.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function LoreEntry({ entry }: { entry: GameWorld['lore'][0] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded border border-zinc-700/50 bg-zinc-800/40 p-2">
      <button
        className="w-full flex items-center justify-between gap-2 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-3 h-3 text-zinc-400 shrink-0" />
          <span className="text-xs font-semibold text-zinc-200 truncate">{entry.title}</span>
          <span className="text-xs text-zinc-500 shrink-0">[{entry.category}]</span>
        </div>
        <span className="text-zinc-500 text-xs">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <p className="mt-2 pl-5 text-xs text-zinc-400">{entry.content}</p>
      )}
    </div>
  );
}

type Tab = 'factions' | 'regions' | 'timeline' | 'lore' | 'rules';

interface WorldPanelProps {
  world?: GameWorld;
  onRegenerate?: () => void;
}

export function WorldPanel({ world: propWorld, onRegenerate }: WorldPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('factions');
  const [world, setWorld] = useState<GameWorld | null>(propWorld ?? null);
  const [report, setReport] = useState<ConsistencyReport | null>(null);

  // Load from localStorage if no prop world
  useEffect(() => {
    if (!propWorld) {
      const stored = loadPersistedWorld();
      if (stored) {
        setWorld(stored);
        setReport(validateWorldConsistency(stored));
      }
    } else {
      setWorld(propWorld);
      setReport(validateWorldConsistency(propWorld));
    }
  }, [propWorld]);

  const handleExportLore = useCallback(() => {
    if (!world) return;
    const md = worldToMarkdown(world);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${world.name.replace(/\s+/g, '_')}_lore.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [world]);

  if (!world) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-4 text-center">
        <Globe className="w-8 h-8 text-zinc-600" />
        <p className="text-xs text-zinc-500">No world generated yet.</p>
        <p className="text-xs text-zinc-600">
          Ask the AI: &ldquo;Build me a sci-fi world with 4 factions.&rdquo;
        </p>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'factions', label: 'Factions', count: world.factions.length },
    { id: 'regions', label: 'Regions', count: world.regions.length },
    { id: 'timeline', label: 'Timeline', count: world.timeline.length },
    { id: 'lore', label: 'Lore', count: world.lore.length },
    { id: 'rules', label: 'Rules', count: world.rules.length },
  ];

  const errorCount = report?.issues.filter((i) => i.severity === 'error').length ?? 0;
  const warnCount = report?.issues.filter((i) => i.severity === 'warning').length ?? 0;

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Globe className="w-4 h-4 text-blue-400 shrink-0" />
            <h2 className="text-sm font-semibold text-zinc-200 truncate">{world.name}</h2>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                title="Regenerate world"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={handleExportLore}
              className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
              title="Export lore as Markdown"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <p className="text-xs text-zinc-500 leading-tight">
          <span className="text-zinc-400">{world.genre}</span> &bull; {world.era}
        </p>
        <p className="text-xs text-zinc-600 leading-tight line-clamp-2">{world.description}</p>

        {/* Consistency indicator */}
        {report && (errorCount > 0 || warnCount > 0) && (
          <div className="flex items-center gap-1.5 pt-0.5">
            {errorCount > 0 ? (
              <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
            ) : (
              <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />
            )}
            <span className="text-xs text-zinc-500">
              {errorCount > 0
                ? `${errorCount} consistency error(s), ${warnCount} warning(s)`
                : `${warnCount} minor warning(s)`}
            </span>
          </div>
        )}
        {report?.valid && errorCount === 0 && warnCount === 0 && (
          <div className="flex items-center gap-1.5 pt-0.5">
            <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />
            <span className="text-xs text-zinc-500">World is consistent</span>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-zinc-800 shrink-0 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-2 py-1.5 text-xs whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'text-blue-400 border-b-2 border-blue-500'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.label}
            <span className="ml-1 text-zinc-600">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {activeTab === 'factions' && (
          <>
            {world.factions.map((f) => (
              <FactionCard key={f.name} faction={f} />
            ))}
          </>
        )}

        {activeTab === 'regions' && (
          <>
            {world.regions.map((r) => (
              <RegionItem key={r.name} region={r} />
            ))}
          </>
        )}

        {activeTab === 'timeline' && (
          <div className="space-y-2">
            {world.timeline.map((event, idx) => (
              <div key={`${event.year}-${idx}`} className="flex gap-2">
                <div className="flex flex-col items-center shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1 shrink-0" />
                  {idx < world.timeline.length - 1 && (
                    <div className="w-px flex-1 bg-zinc-700 mt-0.5" />
                  )}
                </div>
                <div className="pb-2 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-zinc-500 shrink-0" />
                    <span className="text-xs font-mono text-zinc-400 shrink-0">
                      {event.year < 0 ? `${Math.abs(event.year)} BF` : `Year ${event.year}`}
                    </span>
                    <span className="text-xs font-semibold text-zinc-200 truncate">{event.name}</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5 pl-4">{event.description}</p>
                  <p className="text-xs text-zinc-600 mt-0.5 pl-4 italic">Impact: {event.impact}</p>
                  {event.factionsInvolved.length > 0 && (
                    <p className="text-xs text-zinc-600 mt-0.5 pl-4">
                      Factions: {event.factionsInvolved.join(', ')}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'lore' && (
          <>
            {world.lore.map((entry) => (
              <LoreEntry key={entry.title} entry={entry} />
            ))}
          </>
        )}

        {activeTab === 'rules' && (
          <div className="space-y-2">
            {world.rules.map((rule) => (
              <div key={rule.name} className="rounded border border-zinc-700/50 bg-zinc-800/40 p-2">
                <div className="flex items-center gap-2">
                  <Shield className="w-3 h-3 text-zinc-400 shrink-0" />
                  <span className="text-xs font-semibold text-zinc-200">{rule.name}</span>
                </div>
                <p className="text-xs text-zinc-400 mt-1 pl-5">{rule.description}</p>
                <p className="text-xs text-zinc-500 mt-0.5 pl-5 italic">{rule.gameplayEffect}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
