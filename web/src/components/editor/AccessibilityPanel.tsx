'use client';

import { useState, useCallback, useMemo } from 'react';
import { ScanSearch, Wand2, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import {
  analyzeAccessibility,
  generateAccessibilityProfile,
  generateEntityDescriptions,
  buildEntitySummaries,
  createDefaultProfile,
  type AccessibilityProfile,
  type AccessibilityAudit,
  type AccessibilityIssue,
  type ColorblindType,
  type SceneContext,
} from '@/lib/ai/accessibilityGenerator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSceneContextFromStore(): SceneContext {
  const state = useEditorStore.getState();
  const sceneGraph = state.sceneGraph;

  // The store only has primaryMaterial (for selected entity), not a full map.
  // We build a partial materials map from what's available.
  const materials: SceneContext['materials'] = {};
  if (state.primaryMaterial && state.selectedIds.size > 0) {
    const primaryId = [...state.selectedIds][0];
    if (primaryId) {
      materials[primaryId] = state.primaryMaterial;
    }
  }

  // Lights: the store only has primaryLight for selected entity
  const lights: SceneContext['lights'] = {};
  if (state.primaryLight && state.selectedIds.size > 0) {
    const primaryId = [...state.selectedIds][0];
    if (primaryId) {
      lights[primaryId] = state.primaryLight;
    }
  }

  // Build scripts map from allScripts
  const scripts: SceneContext['scripts'] = {};
  for (const [id, data] of Object.entries(state.allScripts ?? {})) {
    scripts[id] = { enabled: data?.enabled ?? false };
  }

  // Input bindings — use sources field from InputBinding type
  const inputBindings = (state.inputBindings ?? []).map((b) => ({
    actionName: b.actionName,
    keys: b.sources ?? [],
  }));

  // Audio: no full audio map in store, only primaryAudio.
  // We can detect audio entities from the scene graph (those with AudioEnabled component)
  const audioEntities = new Set<string>();
  for (const node of Object.values(sceneGraph.nodes)) {
    if (node.components.includes('AudioEnabled')) {
      audioEntities.add(node.entityId);
    }
  }

  // Game components from allGameComponents
  const gameComponents: SceneContext['gameComponents'] = {};
  for (const [id, components] of Object.entries(state.allGameComponents ?? {})) {
    gameComponents[id] = components.map((c) => ({ type: c.type }));
  }

  return {
    sceneGraph,
    materials,
    lights,
    scripts,
    inputBindings,
    audioEntities,
    gameComponents,
  };
}

function severityIcon(severity: AccessibilityIssue['severity']) {
  switch (severity) {
    case 'critical':
      return <AlertTriangle size={12} className="text-red-400 shrink-0" />;
    case 'major':
      return <AlertTriangle size={12} className="text-amber-400 shrink-0" />;
    case 'minor':
      return <Info size={12} className="text-yellow-400 shrink-0" />;
    case 'info':
      return <Info size={12} className="text-zinc-400 shrink-0" />;
  }
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-400';
  if (score >= 60) return 'text-yellow-400';
  if (score >= 40) return 'text-amber-400';
  return 'text-red-400';
}

function scoreBgColor(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-yellow-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AuditResults({ audit }: { audit: AccessibilityAudit }) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['visual', 'motor', 'auditory', 'cognitive']));

  const toggleCategory = useCallback((cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const issuesByCategory = useMemo(() => {
    const groups: Record<string, AccessibilityIssue[]> = { visual: [], auditory: [], motor: [], cognitive: [] };
    for (const issue of audit.issues) {
      if (!groups[issue.category]) groups[issue.category] = [];
      groups[issue.category].push(issue);
    }
    return groups;
  }, [audit.issues]);

  return (
    <div className="space-y-3">
      {/* Score */}
      <div className="flex items-center gap-3 rounded bg-zinc-800 p-3">
        <div className={`text-2xl font-bold ${scoreColor(audit.score)}`}>{audit.score}</div>
        <div className="flex-1">
          <div className="text-xs text-zinc-300">Accessibility Score</div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-zinc-700">
            <div
              className={`h-1.5 rounded-full transition-all duration-300 ${scoreBgColor(audit.score)}`}
              style={{ width: `${audit.score}%` }}
            />
          </div>
        </div>
        <div className="text-[10px] text-zinc-400">
          {audit.passedChecks.length}/{audit.totalChecks} checks passed
        </div>
      </div>

      {/* Issues by category */}
      {(['visual', 'auditory', 'motor', 'cognitive'] as const).map((cat) => {
        const issues = issuesByCategory[cat] ?? [];
        const isExpanded = expandedCategories.has(cat);
        return (
          <div key={cat} className="rounded border border-zinc-800">
            <button
              onClick={() => toggleCategory(cat)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
              aria-expanded={isExpanded}
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="capitalize">{cat}</span>
              {issues.length > 0 ? (
                <span className="ml-auto rounded-full bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">
                  {issues.length} issue{issues.length !== 1 ? 's' : ''}
                </span>
              ) : (
                <span className="ml-auto flex items-center gap-1 text-[10px] text-green-500">
                  <CheckCircle2 size={10} /> Pass
                </span>
              )}
            </button>
            {isExpanded && issues.length > 0 && (
              <div className="space-y-1 px-2 pb-2">
                {issues.map((issue, i) => (
                  <div key={i} className="flex gap-2 rounded bg-zinc-900 p-2 text-[11px]">
                    {severityIcon(issue.severity)}
                    <div className="min-w-0 flex-1">
                      <div className="text-zinc-300">{issue.message}</div>
                      <div className="mt-0.5 text-zinc-400">{issue.suggestion}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Passed checks */}
      {audit.passedChecks.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Passed Checks</div>
          {audit.passedChecks.map((check, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] text-green-500/80">
              <CheckCircle2 size={10} className="shrink-0" />
              {check}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ColorblindPreview({
  profile,
  onUpdate,
}: {
  profile: AccessibilityProfile;
  onUpdate: (updates: Partial<AccessibilityProfile['colorblindMode']>) => void;
}) {
  const modes: { value: ColorblindType; label: string; description: string }[] = [
    { value: 'protanopia', label: 'Protanopia', description: 'Red-blind (~1% of males)' },
    { value: 'deuteranopia', label: 'Deuteranopia', description: 'Green-blind (~5% of males)' },
    { value: 'tritanopia', label: 'Tritanopia', description: 'Blue-blind (~0.01%)' },
    { value: 'achromatopsia', label: 'Achromatopsia', description: 'Total color blindness' },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-zinc-300">Colorblind Simulation</h4>
        <button
          onClick={() => onUpdate({ enabled: !profile.colorblindMode.enabled })}
          className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
            profile.colorblindMode.enabled
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-700 text-zinc-400 hover:text-zinc-300'
          }`}
          aria-pressed={profile.colorblindMode.enabled}
          aria-label={profile.colorblindMode.enabled ? 'Disable colorblind simulation' : 'Enable colorblind simulation'}
        >
          {profile.colorblindMode.enabled ? 'Active' : 'Off'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {modes.map((mode) => (
          <button
            key={mode.value}
            onClick={() => onUpdate({ mode: mode.value, enabled: true })}
            className={`rounded border p-1.5 text-left text-[10px] transition-colors ${
              profile.colorblindMode.mode === mode.value && profile.colorblindMode.enabled
                ? 'border-blue-500 bg-blue-500/10 text-zinc-200'
                : 'border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
            }`}
            aria-label={`Simulate ${mode.label}`}
          >
            <div className="font-medium">{mode.label}</div>
            <div className="text-zinc-400">{mode.description}</div>
          </button>
        ))}
      </div>

      {profile.colorblindMode.enabled && (
        <div className="space-y-1">
          <label className="text-[10px] text-zinc-400">
            Filter strength: {(profile.colorblindMode.filterStrength * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={profile.colorblindMode.filterStrength}
            onChange={(e) => onUpdate({ filterStrength: Number(e.target.value) })}
            className="w-full accent-blue-500"
            aria-label="Colorblind filter strength"
          />
        </div>
      )}
    </div>
  );
}

function ScreenReaderSection({
  profile,
  onToggle,
  onRegenerate,
}: {
  profile: AccessibilityProfile;
  onToggle: () => void;
  onRegenerate: () => void;
}) {
  const descCount = profile.screenReader.entityDescriptions.size;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-zinc-300">Screen Reader Descriptions</h4>
        <button
          onClick={onToggle}
          className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
            profile.screenReader.enabled
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-700 text-zinc-400 hover:text-zinc-300'
          }`}
          aria-pressed={profile.screenReader.enabled}
          aria-label={profile.screenReader.enabled ? 'Disable screen reader' : 'Enable screen reader'}
        >
          {profile.screenReader.enabled ? 'Active' : 'Off'}
        </button>
      </div>

      <div className="flex items-center justify-between rounded bg-zinc-800 px-2 py-1.5 text-[11px] text-zinc-400">
        <span>{descCount} entity description{descCount !== 1 ? 's' : ''} generated</span>
        <button
          onClick={onRegenerate}
          className="text-blue-400 hover:text-blue-300 transition-colors"
          aria-label="Regenerate entity descriptions"
        >
          Regenerate
        </button>
      </div>

      {descCount > 0 && (
        <div className="max-h-32 space-y-1 overflow-y-auto">
          {Array.from(profile.screenReader.entityDescriptions.entries()).map(([id, desc]) => (
            <div key={id} className="rounded bg-zinc-900 px-2 py-1 text-[10px] text-zinc-400">
              <span className="text-zinc-400">{id.slice(0, 8)}:</span> {desc}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InputRemappingSection({
  profile,
  onToggle,
}: {
  profile: AccessibilityProfile;
  onToggle: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-zinc-300">Input Remapping</h4>
        <button
          onClick={onToggle}
          className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
            profile.inputRemapping.enabled
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-700 text-zinc-400 hover:text-zinc-300'
          }`}
          aria-pressed={profile.inputRemapping.enabled}
          aria-label={profile.inputRemapping.enabled ? 'Disable input remapping' : 'Enable input remapping'}
        >
          {profile.inputRemapping.enabled ? 'Active' : 'Off'}
        </button>
      </div>

      {profile.inputRemapping.remappings.length > 0 ? (
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {profile.inputRemapping.remappings.map((remap, i) => (
            <div key={i} className="flex items-center justify-between rounded bg-zinc-800 px-2 py-1 text-[10px]">
              <span className="text-zinc-300">{remap.action}</span>
              <div className="flex items-center gap-1.5 text-zinc-400">
                <kbd className="rounded bg-zinc-700 px-1 py-0.5 text-[9px]">{remap.primaryKey}</kbd>
                {remap.gamepadButton && (
                  <span className="text-zinc-400">| {remap.gamepadButton}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-zinc-400">No input bindings configured in the scene.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function AccessibilityPanel() {
  const [audit, setAudit] = useState<AccessibilityAudit | null>(null);
  const [profile, setProfile] = useState<AccessibilityProfile>(createDefaultProfile);
  const [isGenerating, setIsGenerating] = useState(false);

  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const entityCount = useMemo(() => Object.keys(sceneGraph.nodes).length, [sceneGraph]);

  const handleRunAudit = useCallback(() => {
    const ctx = buildSceneContextFromStore();
    const result = analyzeAccessibility(ctx);
    setAudit(result);
  }, []);

  const handleAutoGenerate = useCallback(() => {
    setIsGenerating(true);
    // Use setTimeout to avoid blocking UI while generating
    setTimeout(() => {
      try {
        const ctx = buildSceneContextFromStore();
        const newProfile = generateAccessibilityProfile(ctx);
        setProfile(newProfile);
        const result = analyzeAccessibility(ctx);
        setAudit(result);
      } finally {
        setIsGenerating(false);
      }
    }, 0);
  }, []);

  const handleRegenerateDescriptions = useCallback(() => {
    const ctx = buildSceneContextFromStore();
    const summaries = buildEntitySummaries(ctx);
    const descriptions = generateEntityDescriptions(summaries);
    setProfile((prev) => ({
      ...prev,
      screenReader: {
        ...prev.screenReader,
        entityDescriptions: descriptions,
      },
    }));
  }, []);

  const updateColorblindMode = useCallback((updates: Partial<AccessibilityProfile['colorblindMode']>) => {
    setProfile((prev) => ({
      ...prev,
      colorblindMode: { ...prev.colorblindMode, ...updates },
    }));
  }, []);

  const toggleScreenReader = useCallback(() => {
    setProfile((prev) => ({
      ...prev,
      screenReader: { ...prev.screenReader, enabled: !prev.screenReader.enabled },
    }));
  }, []);

  const toggleInputRemapping = useCallback(() => {
    setProfile((prev) => ({
      ...prev,
      inputRemapping: { ...prev.inputRemapping, enabled: !prev.inputRemapping.enabled },
    }));
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Accessibility
        </h3>
        <span className="text-[10px] text-zinc-400">{entityCount} entities</span>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleRunAudit}
            className="flex flex-1 items-center justify-center gap-1.5 rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
            aria-label="Run accessibility audit"
          >
            <ScanSearch size={13} />
            Audit
          </button>
          <button
            onClick={handleAutoGenerate}
            disabled={isGenerating}
            className="flex flex-1 items-center justify-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            aria-label="Auto-generate accessibility profile"
          >
            <Wand2 size={13} />
            {isGenerating ? 'Generating...' : 'Auto-Generate'}
          </button>
        </div>

        {/* Audit results */}
        {audit && <AuditResults audit={audit} />}

        {/* Colorblind preview */}
        <ColorblindPreview profile={profile} onUpdate={updateColorblindMode} />

        {/* Screen reader */}
        <ScreenReaderSection
          profile={profile}
          onToggle={toggleScreenReader}
          onRegenerate={handleRegenerateDescriptions}
        />

        {/* Input remapping */}
        <InputRemappingSection
          profile={profile}
          onToggle={toggleInputRemapping}
        />

        {/* Subtitle settings */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-zinc-300">Subtitles</h4>
            <button
              onClick={() => setProfile((prev) => ({ ...prev, subtitles: { ...prev.subtitles, enabled: !prev.subtitles.enabled } }))}
              className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                profile.subtitles.enabled
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-700 text-zinc-400 hover:text-zinc-300'
              }`}
              aria-pressed={profile.subtitles.enabled}
              aria-label={profile.subtitles.enabled ? 'Disable subtitles' : 'Enable subtitles'}
            >
              {profile.subtitles.enabled ? 'Active' : 'Off'}
            </button>
          </div>
          {profile.subtitles.enabled && (
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-400">Font size</label>
              <select
                value={profile.subtitles.fontSize}
                onChange={(e) =>
                  setProfile((prev) => ({
                    ...prev,
                    subtitles: { ...prev.subtitles, fontSize: e.target.value as 'small' | 'medium' | 'large' | 'extra-large' },
                  }))
                }
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
                aria-label="Subtitle font size"
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
                <option value="extra-large">Extra Large</option>
              </select>
            </div>
          )}
        </div>

        {/* Font scale */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-zinc-300">Font Scale</h4>
            <button
              onClick={() => setProfile((prev) => ({ ...prev, fontSize: { ...prev.fontSize, enabled: !prev.fontSize.enabled } }))}
              className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                profile.fontSize.enabled
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-700 text-zinc-400 hover:text-zinc-300'
              }`}
              aria-pressed={profile.fontSize.enabled}
              aria-label={profile.fontSize.enabled ? 'Disable font scaling' : 'Enable font scaling'}
            >
              {profile.fontSize.enabled ? 'Active' : 'Off'}
            </button>
          </div>
          {profile.fontSize.enabled && (
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-400">
                Scale: {(profile.fontSize.scale * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min={0.75}
                max={2}
                step={0.25}
                value={profile.fontSize.scale}
                onChange={(e) =>
                  setProfile((prev) => ({
                    ...prev,
                    fontSize: { ...prev.fontSize, scale: Number(e.target.value) },
                  }))
                }
                className="w-full accent-blue-500"
                aria-label="Font scale"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
