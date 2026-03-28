'use client';

import { useState, useCallback } from 'react';
import {
  TreePine,
  Play,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  Sparkles,
  Copy,
} from 'lucide-react';
import {
  type BehaviorTree,
  type BehaviorNode,
  type BehaviorVariable,
  BEHAVIOR_PRESETS,
  getPreset,
  behaviorTreeToScript,
  generateBehaviorTree,
  validateTree,
  countNodes,
  getTreeDepth,
} from '@/lib/ai/behaviorTree';
import { useEditorStore } from '@/stores/editorStore';

// ---- Tree Node Visualization ----

const NODE_TYPE_ICONS: Record<string, string> = {
  sequence: '\u2192',     // →
  selector: '\u2753',     // ?
  parallel: '\u2225',     // ∥
  condition: '\u2049',    // ⁉
  action: '\u25B6',       // ▶
  decorator: '\u2B50',    // ⭐
  inverter: '\u00AC',     // ¬
  repeater: '\u21BA',     // ↺
};

const NODE_TYPE_COLORS: Record<string, string> = {
  sequence: 'text-blue-400',
  selector: 'text-yellow-400',
  parallel: 'text-purple-400',
  condition: 'text-orange-400',
  action: 'text-green-400',
  decorator: 'text-pink-400',
  inverter: 'text-red-400',
  repeater: 'text-cyan-400',
};

function TreeNodeView({ node, depth }: { node: BehaviorNode; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const icon = NODE_TYPE_ICONS[node.type] ?? '\u25CF';
  const colorClass = NODE_TYPE_COLORS[node.type] ?? 'text-zinc-400';

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <button
        onClick={hasChildren ? handleToggle : undefined}
        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-zinc-800/50"
        aria-expanded={hasChildren ? expanded : undefined}
        aria-label={`${node.type}: ${node.name}`}
      >
        {hasChildren ? (
          expanded ? <ChevronDown size={12} className="shrink-0 text-zinc-400" /> : <ChevronRight size={12} className="shrink-0 text-zinc-400" />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className={`shrink-0 font-mono text-[10px] ${colorClass}`}>{icon}</span>
        <span className="text-zinc-300">{node.name}</span>
        <span className="ml-auto text-[10px] text-zinc-400">{node.type}</span>
      </button>
      {hasChildren && expanded && node.children!.map((child) => (
        <TreeNodeView key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

// ---- Variable Editor ----

function VariableEditor({ variables }: { variables: BehaviorVariable[] }) {
  if (variables.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Variables</h4>
      {variables.map((v) => (
        <div key={v.name} className="flex items-center gap-2 text-xs">
          <span className="min-w-0 truncate text-zinc-300">{v.name}</span>
          <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{v.type}</span>
          <span className="ml-auto truncate text-zinc-400">{JSON.stringify(v.defaultValue)}</span>
        </div>
      ))}
    </div>
  );
}

// ---- Main Panel ----

export function BehaviorTreePanel() {
  const [description, setDescription] = useState('');
  const [currentTree, setCurrentTree] = useState<BehaviorTree | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedScript, setGeneratedScript] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);

  const primaryId = useEditorStore((s) => s.primaryId);
  const setScript = useEditorStore((s) => s.setScript);

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return;
    setIsGenerating(true);
    setError(null);
    setGeneratedScript(null);

    try {
      const tree = await generateBehaviorTree(description.trim());
      setCurrentTree(tree);
      const script = behaviorTreeToScript(tree);
      setGeneratedScript(script);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  }, [description]);

  const handleSelectPreset = useCallback((key: string) => {
    const tree = getPreset(key);
    if (!tree) return;
    setCurrentTree(tree);
    setGeneratedScript(behaviorTreeToScript(tree));
    setError(null);
    setShowPresets(false);
    setDescription(tree.description);
  }, []);

  const handleApplyToEntity = useCallback(() => {
    if (!primaryId || !generatedScript) return;
    setScript(primaryId, generatedScript, true, 'behavior_tree');
  }, [primaryId, generatedScript, setScript]);

  const handleCopyScript = useCallback(() => {
    if (!generatedScript) return;
    void navigator.clipboard.writeText(generatedScript);
  }, [generatedScript]);

  const validationErrors = currentTree ? validateTree(currentTree) : [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <TreePine size={14} className="text-teal-400" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Behavior Tree DSL
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Description Input */}
        <div className="space-y-1.5">
          <label htmlFor="bt-description" className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Describe NPC Behavior
          </label>
          <textarea
            id="bt-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. patrol between points A and B, chase the player when they get close, retreat when health is low"
            className="w-full resize-none rounded border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-200 placeholder:text-zinc-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            rows={3}
            disabled={isGenerating}
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !description.trim()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded bg-teal-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Generate behavior tree"
          >
            {isGenerating ? (
              <Loader2 size={12} className="motion-safe:animate-spin" />
            ) : (
              <Sparkles size={12} />
            )}
            {isGenerating ? 'Generating...' : 'Generate Behavior'}
          </button>
          <button
            onClick={() => setShowPresets(!showPresets)}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
            aria-label="Toggle preset library"
            aria-expanded={showPresets}
          >
            Presets
          </button>
        </div>

        {/* Preset Library */}
        {showPresets && (
          <div className="space-y-1 rounded border border-zinc-700 bg-zinc-900/50 p-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Preset Behaviors
            </h4>
            {Object.entries(BEHAVIOR_PRESETS).map(([key, factory]) => {
              const preview = factory();
              return (
                <button
                  key={key}
                  onClick={() => handleSelectPreset(key)}
                  className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-zinc-800"
                  aria-label={`Apply ${preview.name} preset`}
                >
                  <span className="text-xs font-medium text-zinc-200">{preview.name}</span>
                  <span className="text-[10px] text-zinc-400">{preview.description}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="flex items-start gap-2 rounded border border-red-800/50 bg-red-900/20 px-2.5 py-2 text-xs text-red-300" role="alert">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Tree Visualization */}
        {currentTree && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Tree: {currentTree.name}
              </h4>
              <span className="text-[10px] text-zinc-400">
                {countNodes(currentTree.root)} nodes, depth {getTreeDepth(currentTree.root)}
              </span>
            </div>

            {/* Validation warnings */}
            {validationErrors.length > 0 && (
              <div className="rounded border border-yellow-800/50 bg-yellow-900/20 px-2 py-1.5 text-[10px] text-yellow-300">
                {validationErrors.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            )}

            {/* Node tree */}
            <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2">
              <TreeNodeView node={currentTree.root} depth={0} />
            </div>

            {/* Variables */}
            <VariableEditor variables={currentTree.variables} />

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleApplyToEntity}
                disabled={!primaryId || !generatedScript}
                className="flex flex-1 items-center justify-center gap-1.5 rounded bg-green-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Apply behavior to selected entity"
                title={!primaryId ? 'Select an entity first' : 'Apply as script to selected entity'}
              >
                <Play size={12} />
                Apply to Entity
              </button>
              <button
                onClick={handleCopyScript}
                disabled={!generatedScript}
                className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Copy generated script"
                title="Copy generated TypeScript to clipboard"
              >
                <Copy size={12} />
              </button>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!currentTree && !isGenerating && !error && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <TreePine size={24} className="text-zinc-700" />
            <p className="text-xs text-zinc-400">
              Describe NPC behavior in plain English or pick a preset to generate a behavior tree.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
