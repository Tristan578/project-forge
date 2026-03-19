'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Users,
  GitBranch,
  Download,
  Loader2,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import {
  NARRATIVE_PRESETS,
  generateNarrative,
  narrativeToDialogueTree,
  findDeadEnds,
  buildSceneGraph,
} from '@/lib/ai/narrativeGenerator';
import type {
  NarrativeArc,
  Act,
  NarrativeScene,
  Character,
  Ending,
  Choice,
} from '@/lib/ai/narrativeGenerator';
import { useDialogueStore } from '@/stores/dialogueStore';

// ============================================================================
// Sub-components
// ============================================================================

function PresetPicker({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const presets = useMemo(() => Object.values(NARRATIVE_PRESETS), []);

  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-zinc-400">
        Story Structure
      </label>
      <select
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 border border-zinc-700"
        aria-label="Select narrative preset"
      >
        <option value="">Auto-detect</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {selected && NARRATIVE_PRESETS[selected] && (
        <p className="text-[10px] text-zinc-500">
          {NARRATIVE_PRESETS[selected].description}
        </p>
      )}
    </div>
  );
}

function CharacterCard({ character }: { character: Character }) {
  const roleColors: Record<string, string> = {
    protagonist: 'text-blue-400',
    antagonist: 'text-red-400',
    ally: 'text-green-400',
    neutral: 'text-zinc-400',
  };

  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/50 p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-200">
          {character.name}
        </span>
        <span
          className={`text-[10px] uppercase ${roleColors[character.role] ?? 'text-zinc-400'}`}
        >
          {character.role}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-zinc-500">{character.description}</p>
      <p className="mt-0.5 text-[10px] text-zinc-600 italic">
        Motivation: {character.motivation}
      </p>
    </div>
  );
}

function EndingCard({ ending }: { ending: Ending }) {
  const typeColors: Record<string, string> = {
    good: 'bg-green-900/30 text-green-400',
    neutral: 'bg-zinc-800 text-zinc-400',
    bad: 'bg-red-900/30 text-red-400',
    secret: 'bg-purple-900/30 text-purple-400',
  };

  return (
    <div
      className={`rounded border border-zinc-700 p-2 ${typeColors[ending.type] ?? ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{ending.name}</span>
        <span className="text-[10px] uppercase">{ending.type}</span>
      </div>
      <p className="mt-1 text-[10px] opacity-80">{ending.description}</p>
      {ending.conditions.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {ending.conditions.map((c, i) => (
            <li key={i} className="text-[10px] opacity-60">
              - {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SceneNode({
  scene,
  isExpanded,
  onToggle,
}: {
  scene: NarrativeScene;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const hasChoices = !!scene.choices && scene.choices.length > 0;

  return (
    <div className="border-l-2 border-zinc-700 pl-2">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 text-xs text-zinc-300 hover:text-zinc-100 transition-colors w-full text-left"
        aria-expanded={isExpanded}
      >
        {isExpanded ? (
          <ChevronDown size={12} />
        ) : (
          <ChevronRight size={12} />
        )}
        <span className="font-medium">{scene.name}</span>
        {hasChoices && (
          <GitBranch size={10} className="ml-1 text-blue-400" />
        )}
      </button>

      {isExpanded && (
        <div className="ml-4 mt-1 space-y-1">
          <p className="text-[10px] text-zinc-500">{scene.description}</p>

          {scene.dialogue.map((line, i) => (
            <div key={i} className="text-[10px]">
              <span className="font-medium text-zinc-400">
                {line.speaker}
                {line.emotion && (
                  <span className="text-zinc-600 italic">
                    {' '}
                    ({line.emotion})
                  </span>
                )}
                :
              </span>{' '}
              <span className="text-zinc-500">{line.text}</span>
            </div>
          ))}

          {scene.choices && scene.choices.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {scene.choices.map((choice: Choice, i: number) => (
                <div
                  key={i}
                  className="flex items-start gap-1 rounded bg-zinc-800/50 p-1 text-[10px]"
                >
                  <GitBranch
                    size={10}
                    className="mt-0.5 shrink-0 text-blue-400"
                  />
                  <div>
                    <span className="text-zinc-300">{choice.text}</span>
                    <span className="ml-1 text-zinc-600">
                      -&gt; {choice.nextSceneId}
                    </span>
                    {choice.affectsEnding && (
                      <span className="ml-1 text-purple-400">
                        [{choice.affectsEnding}]
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {scene.nextSceneId && !hasChoices && (
            <p className="text-[10px] text-zinc-600">
              Next: {scene.nextSceneId}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ActSection({ act }: { act: Act }) {
  const [expanded, setExpanded] = useState(true);
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(
    new Set(),
  );

  const toggleScene = useCallback((id: string) => {
    setExpandedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/30">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 p-2 text-left text-xs font-semibold text-zinc-200 hover:bg-zinc-800/50 transition-colors"
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>
          Act {act.number}: {act.name}
        </span>
        <span className="ml-auto text-[10px] font-normal text-zinc-500">
          {act.scenes.length} scenes
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 p-2 pt-0">
          <p className="text-[10px] text-zinc-500 italic">
            Turning point: {act.turningPoint}
          </p>
          {act.scenes.map((scene: NarrativeScene) => (
            <SceneNode
              key={scene.id}
              scene={scene}
              isExpanded={expandedScenes.has(scene.id)}
              onToggle={() => toggleScene(scene.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BranchingVisualizer({ arc }: { arc: NarrativeArc }) {
  const graph = useMemo(() => buildSceneGraph(arc), [arc]);
  const entries = useMemo(() => [...graph.entries()], [graph]);

  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold uppercase text-zinc-400">
        Scene Flow
      </h3>
      <div className="space-y-0.5">
        {entries.map(([id, data]) => (
          <div key={id} className="flex items-center gap-1 text-[10px]">
            <span className="min-w-[100px] truncate font-mono text-zinc-400">
              {data.sceneName}
            </span>
            {data.targets.length > 0 ? (
              <>
                <span className="text-zinc-600">-&gt;</span>
                <span className="text-zinc-500">
                  {data.targets
                    .map(
                      (t) => graph.get(t)?.sceneName ?? t,
                    )
                    .join(', ')}
                </span>
              </>
            ) : (
              <span className="text-zinc-600 italic">(end)</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Main Panel
// ============================================================================

async function defaultFetchFn(prompt: string): Promise<string> {
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      model: 'claude-sonnet-4-20250514',
    }),
  });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  const data = await resp.json();
  return data.content ?? data.text ?? JSON.stringify(data);
}

export function NarrativePanel() {
  const [premise, setPremise] = useState('');
  const [preset, setPreset] = useState('');
  const [arc, setArc] = useState<NarrativeArc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importTree = useDialogueStore((s) => s.importTree);
  const selectTree = useDialogueStore((s) => s.selectTree);

  const deadEnds = useMemo(
    () => (arc ? findDeadEnds(arc) : []),
    [arc],
  );

  const handleGenerate = useCallback(async () => {
    if (!premise.trim()) return;
    setLoading(true);
    setError(null);
    setArc(null);

    try {
      const result = await generateNarrative(
        premise,
        defaultFetchFn,
        { preset: preset || undefined },
      );
      setArc(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate narrative');
    } finally {
      setLoading(false);
    }
  }, [premise, preset]);

  const handleExportToDialogue = useCallback(() => {
    if (!arc) return;
    const tree = narrativeToDialogueTree(arc);
    const treeId = importTree(JSON.stringify(tree));
    if (treeId) selectTree(treeId);
  }, [arc, importTree, selectTree]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-900 text-zinc-300">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-700 px-3 py-2">
        <BookOpen size={14} className="text-zinc-400" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Narrative Arc Generator
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Input Section */}
        <div className="space-y-2">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Story Premise
            </label>
            <textarea
              value={premise}
              onChange={(e) => setPremise(e.target.value)}
              placeholder="Describe your story concept... e.g. 'A detective in a cyberpunk city investigates a series of AI-related crimes'"
              className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 border border-zinc-700 placeholder-zinc-600 resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none"
              rows={3}
              aria-label="Story premise input"
            />
          </div>

          <PresetPicker selected={preset} onSelect={setPreset} />

          <button
            onClick={handleGenerate}
            disabled={loading || !premise.trim()}
            className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Generate narrative"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Generate Narrative
              </>
            )}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded border border-red-800 bg-red-900/20 p-2 text-xs text-red-400">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Generated Narrative */}
        {arc && (
          <div className="space-y-3">
            {/* Title and meta */}
            <div>
              <h3 className="text-sm font-bold text-zinc-100">{arc.title}</h3>
              <p className="text-[10px] text-zinc-500">
                {arc.genre} | Themes: {arc.themes.join(', ')}
              </p>
            </div>

            {/* Dead end warnings */}
            {deadEnds.length > 0 && (
              <div className="flex items-start gap-2 rounded border border-yellow-800 bg-yellow-900/20 p-2 text-xs text-yellow-400">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  Terminal scenes (expected for endings):{' '}
                  {deadEnds.join(', ')}
                </span>
              </div>
            )}

            {/* Characters */}
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Users size={12} className="text-zinc-400" />
                <h3 className="text-xs font-semibold uppercase text-zinc-400">
                  Characters
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-1">
                {arc.characters.map((c) => (
                  <CharacterCard key={c.name} character={c} />
                ))}
              </div>
            </div>

            {/* Acts */}
            <div className="space-y-2">
              {arc.acts.map((act: Act) => (
                <ActSection key={act.number} act={act} />
              ))}
            </div>

            {/* Branching Visualizer */}
            <BranchingVisualizer arc={arc} />

            {/* Endings */}
            <div className="space-y-1">
              <h3 className="text-xs font-semibold uppercase text-zinc-400">
                Endings
              </h3>
              <div className="grid grid-cols-1 gap-1">
                {arc.endings.map((e) => (
                  <EndingCard key={e.id} ending={e} />
                ))}
              </div>
            </div>

            {/* Export */}
            <button
              onClick={handleExportToDialogue}
              className="flex w-full items-center justify-center gap-2 rounded bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600 transition-colors"
              aria-label="Export narrative to dialogue system"
            >
              <Download size={14} />
              Export to Dialogue System
            </button>
          </div>
        )}

        {/* Empty state */}
        {!arc && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <BookOpen size={32} className="mb-2 text-zinc-700" />
            <p className="text-xs text-zinc-500">
              Enter a story premise and click Generate to create a branching
              narrative with acts, scenes, dialogue, and multiple endings.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
