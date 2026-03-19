'use client';

import { useState, useMemo, useCallback } from 'react';
import { Palette, Lock, Unlock, BarChart3, Paintbrush } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import {
  ART_STYLE_PRESETS,
  getStylePresetKeys,
  analyzeStyleConsistency,
  applyStyleToScene,
  generateStylePromptModifier,
  loadLockedStyle,
  saveLockedStyle,
  clearLockedStyle,
} from '@/lib/ai/artStyleEngine';
import type { ArtStyle, StyleConsistencyReport, EntitySummary } from '@/lib/ai/artStyleEngine';
import { getCommandDispatcher } from '@/stores/editorStore';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ColorSwatch({ hex, label }: { hex: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className="h-5 w-5 rounded border border-zinc-600"
        style={{ backgroundColor: hex }}
        title={`${label}: ${hex}`}
      />
      <span className="text-[9px] text-zinc-500">{label}</span>
    </div>
  );
}

function StyleCard({
  presetKey,
  style,
  isSelected,
  onSelect,
}: {
  presetKey: string;
  style: ArtStyle;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { colorPalette } = style;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded border p-2 text-left transition-colors duration-150 ${
        isSelected
          ? 'border-blue-500 bg-zinc-700'
          : 'border-zinc-700 bg-zinc-800 hover:border-zinc-500'
      }`}
      aria-label={`Select ${style.name} art style`}
      aria-pressed={isSelected}
      data-testid={`style-card-${presetKey}`}
    >
      <div className="mb-1 text-xs font-semibold text-zinc-200">{style.name}</div>
      <div className="mb-2 text-[10px] text-zinc-400">{style.description}</div>
      <div className="flex gap-1.5">
        <ColorSwatch hex={colorPalette.primary} label="P" />
        <ColorSwatch hex={colorPalette.secondary} label="S" />
        <ColorSwatch hex={colorPalette.accent} label="A" />
        <ColorSwatch hex={colorPalette.neutral} label="N" />
        <ColorSwatch hex={colorPalette.background} label="B" />
      </div>
    </button>
  );
}

function ConsistencyReport({ report }: { report: StyleConsistencyReport }) {
  const scoreColor =
    report.score >= 80 ? 'text-green-400' : report.score >= 50 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="space-y-2 rounded border border-zinc-700 bg-zinc-800 p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-300">Consistency Score</span>
        <span className={`text-sm font-bold ${scoreColor}`}>{report.score}%</span>
      </div>
      <div className="text-[10px] text-zinc-400">
        {report.consistentCount}/{report.consistentCount + report.deviatingCount} entities match{' '}
        {report.styleName}
      </div>
      {report.deviations.length > 0 && (
        <div className="max-h-32 space-y-1 overflow-y-auto">
          {report.deviations.map((d) => (
            <div key={d.entityId} className="rounded bg-zinc-900 p-1.5 text-[10px]">
              <span className="font-medium text-zinc-300">{d.entityName}</span>
              <ul className="ml-2 mt-0.5 list-disc text-zinc-500">
                {d.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function ArtStylePanel() {
  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    const locked = loadLockedStyle();
    return locked?.presetKey ?? null;
  });
  const [isLocked, setIsLocked] = useState<boolean>(() => loadLockedStyle() !== null);
  const [report, setReport] = useState<StyleConsistencyReport | null>(null);
  const [promptModifier, setPromptModifier] = useState<string | null>(null);

  // Store selectors — primitives only
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const primaryMaterial = useEditorStore((s) => s.primaryMaterial);
  const primaryId = useEditorStore((s) => s.primaryId);

  const presetKeys = useMemo(() => getStylePresetKeys(), []);

  const selectedStyle: ArtStyle | null = useMemo(
    () => (selectedKey ? ART_STYLE_PRESETS[selectedKey] ?? null : null),
    [selectedKey],
  );

  const handleSelect = useCallback(
    (key: string) => {
      setSelectedKey(key);
      setReport(null);
      setPromptModifier(null);
      if (isLocked) {
        const style = ART_STYLE_PRESETS[key];
        if (style) saveLockedStyle(key, style);
      }
    },
    [isLocked],
  );

  const handleToggleLock = useCallback(() => {
    if (isLocked) {
      clearLockedStyle();
      setIsLocked(false);
    } else if (selectedKey && selectedStyle) {
      saveLockedStyle(selectedKey, selectedStyle);
      setIsLocked(true);
    }
  }, [isLocked, selectedKey, selectedStyle]);

  const handleAnalyze = useCallback(() => {
    if (!selectedStyle) return;

    // Build entity summaries from scene graph
    const entities: EntitySummary[] = Object.values(sceneGraph.nodes).map((node) => ({
      entityId: node.entityId,
      name: node.name,
      // We only have the primary material for the selected entity.
      // For a full analysis we'd need per-entity materials from the store,
      // but we can at least check the currently selected entity.
      material: node.entityId === primaryId ? primaryMaterial : null,
    }));

    const result = analyzeStyleConsistency(entities, selectedStyle);
    setReport(result);
  }, [selectedStyle, sceneGraph, primaryId, primaryMaterial]);

  const handleApply = useCallback(() => {
    if (!selectedStyle) return;
    const dispatcher = getCommandDispatcher();
    if (!dispatcher) return;

    const entityIds = sceneGraph.rootIds.flatMap((rootId) => {
      const node = sceneGraph.nodes[rootId];
      if (!node) return [];
      // Include root and its children (flat list of all visible entities)
      const ids = [rootId];
      const collectChildren = (nid: string) => {
        const n = sceneGraph.nodes[nid];
        if (n) {
          for (const childId of n.children) {
            ids.push(childId);
            collectChildren(childId);
          }
        }
      };
      collectChildren(rootId);
      return ids;
    });

    applyStyleToScene(selectedStyle, entityIds, dispatcher);
  }, [selectedStyle, sceneGraph]);

  const handleShowPrompt = useCallback(() => {
    if (!selectedStyle) return;
    setPromptModifier(generateStylePromptModifier(selectedStyle));
  }, [selectedStyle]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-700 px-3 py-2">
        <Palette className="h-4 w-4 text-zinc-400" />
        <h2 className="text-xs font-semibold uppercase text-zinc-400">Art Style</h2>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* Style preset grid */}
        <div className="space-y-1.5">
          {presetKeys.map((key) => (
            <StyleCard
              key={key}
              presetKey={key}
              style={ART_STYLE_PRESETS[key]}
              isSelected={selectedKey === key}
              onSelect={() => handleSelect(key)}
            />
          ))}
        </div>

        {/* Actions */}
        {selectedStyle && (
          <div className="space-y-2 border-t border-zinc-700 pt-2">
            <div className="text-xs font-semibold text-zinc-300">
              Selected: {selectedStyle.name}
            </div>

            {/* Lock toggle */}
            <button
              type="button"
              onClick={handleToggleLock}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors duration-150 ${
                isLocked
                  ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'
                  : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
              }`}
              aria-label={isLocked ? 'Unlock art style' : 'Lock art style for AI generation'}
            >
              {isLocked ? (
                <Lock className="h-3.5 w-3.5" />
              ) : (
                <Unlock className="h-3.5 w-3.5" />
              )}
              {isLocked ? 'Style Locked' : 'Lock Style'}
            </button>

            {/* Analyze button */}
            <button
              type="button"
              onClick={handleAnalyze}
              className="flex w-full items-center gap-2 rounded bg-zinc-700 px-2 py-1.5 text-xs text-zinc-300 transition-colors duration-150 hover:bg-zinc-600"
              aria-label="Analyze scene consistency"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Analyze Consistency
            </button>

            {/* Apply button */}
            <button
              type="button"
              onClick={handleApply}
              className="flex w-full items-center gap-2 rounded bg-blue-600 px-2 py-1.5 text-xs text-white transition-colors duration-150 hover:bg-blue-500"
              aria-label="Apply art style to all entities"
            >
              <Paintbrush className="h-3.5 w-3.5" />
              Apply Style to Scene
            </button>

            {/* Prompt modifier button */}
            <button
              type="button"
              onClick={handleShowPrompt}
              className="flex w-full items-center gap-2 rounded bg-zinc-700 px-2 py-1.5 text-xs text-zinc-300 transition-colors duration-150 hover:bg-zinc-600"
              aria-label="Show AI prompt modifier"
            >
              <Palette className="h-3.5 w-3.5" />
              Show Prompt Modifier
            </button>

            {/* Prompt modifier display */}
            {promptModifier && (
              <div className="rounded border border-zinc-700 bg-zinc-900 p-2 text-[10px] text-zinc-400">
                {promptModifier}
              </div>
            )}

            {/* Consistency report */}
            {report && <ConsistencyReport report={report} />}
          </div>
        )}
      </div>
    </div>
  );
}
