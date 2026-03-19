'use client';

import { useState, useCallback, useMemo } from 'react';
import { Bone, ChevronDown, ChevronRight, AlertCircle, CheckCircle2, Wand2 } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { getCommandDispatcher } from '@/stores/editorStore';
import {
  RIG_TEMPLATES,
  detectRigType,
  validateRig,
  rigToCommands,
  generateRig,
} from '@/lib/ai/autoRigging';
import type { RigType, RigTemplate, BoneDefinition } from '@/lib/ai/autoRigging';

const RIG_TYPE_LABELS: Record<RigType, string> = {
  humanoid: 'Humanoid (22 bones)',
  quadruped: 'Quadruped (18 bones)',
  bird: 'Bird (14 bones)',
  fish: 'Fish (8 bones)',
  serpent: 'Serpent (12 bones)',
  mechanical: 'Mechanical (10 bones)',
  custom: 'Custom (empty)',
};

const ALL_RIG_TYPES: RigType[] = [
  'humanoid', 'quadruped', 'bird', 'fish', 'serpent', 'mechanical', 'custom',
];

// ---------------------------------------------------------------------------
// Bone Tree Component
// ---------------------------------------------------------------------------

function BoneTreeNode({ bone, allBones, depth }: {
  bone: BoneDefinition;
  allBones: BoneDefinition[];
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const children = useMemo(
    () => allBones.filter((b) => b.parent === bone.name),
    [allBones, bone.name],
  );

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={toggle}
        aria-expanded={expanded}
        aria-label={`Bone: ${bone.name}`}
      >
        {children.length > 0 ? (
          expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />
          )
        ) : (
          <span className="inline-block h-3 w-3 shrink-0" />
        )}
        <Bone className="h-3 w-3 shrink-0 text-zinc-400" />
        <span className="truncate">{bone.name}</span>
        <span className="ml-auto text-[10px] text-zinc-500">L={bone.length.toFixed(2)}</span>
      </button>
      {expanded && children.map((child) => (
        <BoneTreeNode key={child.name} bone={child} allBones={allBones} depth={depth + 1} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Validation Status
// ---------------------------------------------------------------------------

function ValidationStatus({ rig }: { rig: RigTemplate }) {
  const result = useMemo(() => validateRig(rig), [rig]);

  if (result.valid) {
    return (
      <div className="flex items-center gap-1.5 rounded bg-emerald-900/30 px-2 py-1 text-xs text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>Valid rig ({rig.bones.length} bones, {rig.ik_chains.length} IK chains)</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {result.errors.map((err) => (
        <div key={err} className="flex items-start gap-1.5 rounded bg-red-900/30 px-2 py-1 text-xs text-red-400">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{err}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function AutoRiggingPanel() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const primaryName = useEditorStore((s) => {
    if (!s.primaryId) return null;
    const node = s.sceneGraph.nodes[s.primaryId];
    return node?.name ?? null;
  });

  const [description, setDescription] = useState('');
  const [selectedType, setSelectedType] = useState<RigType | 'auto'>('auto');
  const [currentRig, setCurrentRig] = useState<RigTemplate | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showBoneTree, setShowBoneTree] = useState(true);

  const detectedType = useMemo(
    () => description.trim() ? detectRigType(description) : null,
    [description],
  );

  const effectiveType = selectedType === 'auto' ? detectedType : selectedType;

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    try {
      const rig = await generateRig(
        description,
        selectedType === 'auto' ? undefined : selectedType,
      );
      setCurrentRig(rig);
    } finally {
      setIsGenerating(false);
    }
  }, [description, selectedType]);

  const handleSelectTemplate = useCallback((type: RigType) => {
    const templateFn = RIG_TEMPLATES[type];
    setCurrentRig(templateFn());
    setSelectedType(type);
  }, []);

  const handleApplyRig = useCallback(() => {
    if (!currentRig || !primaryId) return;
    const dispatcher = getCommandDispatcher();
    if (!dispatcher) return;

    const commands = rigToCommands(currentRig, primaryId);
    for (const cmd of commands) {
      dispatcher(cmd.command, cmd.payload);
    }
  }, [currentRig, primaryId]);

  const rootBones = useMemo(
    () => currentRig?.bones.filter((b) => !b.parent) ?? [],
    [currentRig],
  );

  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value),
    [],
  );

  const handleTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => setSelectedType(e.target.value as RigType | 'auto'),
    [],
  );

  const toggleBoneTree = useCallback(() => setShowBoneTree((prev) => !prev), []);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-900 text-zinc-200">
      <div className="space-y-3 p-3">
        {/* Header */}
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Auto-Rigging
        </h3>

        {/* Target entity */}
        <div className="rounded bg-zinc-800 px-2 py-1.5 text-xs">
          <span className="text-zinc-500">Target: </span>
          {primaryId ? (
            <span className="text-zinc-200">{primaryName ?? primaryId}</span>
          ) : (
            <span className="italic text-zinc-500">Select an entity</span>
          )}
        </div>

        {/* Description input */}
        <div>
          <label htmlFor="rig-description" className="mb-1 block text-xs text-zinc-400">
            Model Description
          </label>
          <textarea
            id="rig-description"
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            rows={2}
            placeholder="e.g. a medieval knight in armor"
            value={description}
            onChange={handleDescriptionChange}
          />
          {detectedType && selectedType === 'auto' && (
            <p className="mt-0.5 text-[10px] text-zinc-500">
              Detected: <span className="text-zinc-400">{detectedType}</span>
            </p>
          )}
        </div>

        {/* Rig type selector */}
        <div>
          <label htmlFor="rig-type" className="mb-1 block text-xs text-zinc-400">
            Rig Type
          </label>
          <select
            id="rig-type"
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={selectedType}
            onChange={handleTypeChange}
          >
            <option value="auto">Auto-detect{effectiveType ? ` (${effectiveType})` : ''}</option>
            {ALL_RIG_TYPES.map((type) => (
              <option key={type} value={type}>{RIG_TYPE_LABELS[type]}</option>
            ))}
          </select>
        </div>

        {/* Generate button */}
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleGenerate}
          disabled={isGenerating}
          aria-label="Generate rig"
        >
          <Wand2 className="h-3.5 w-3.5" />
          {isGenerating ? 'Generating...' : 'Generate Rig'}
        </button>

        {/* Template gallery */}
        <div>
          <p className="mb-1.5 text-xs text-zinc-400">Or choose a template:</p>
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_RIG_TYPES.filter((t) => t !== 'custom').map((type) => {
              const tmpl = RIG_TEMPLATES[type]();
              return (
                <button
                  key={type}
                  type="button"
                  className={`rounded border px-2 py-1.5 text-left text-xs transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                    currentRig?.type === type
                      ? 'border-blue-500 bg-blue-900/30 text-blue-300'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600'
                  }`}
                  onClick={() => handleSelectTemplate(type)}
                  aria-label={`Select ${type} template`}
                >
                  <span className="block font-medium capitalize">{type}</span>
                  <span className="text-[10px] text-zinc-500">{tmpl.bones.length} bones</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Current rig info */}
        {currentRig && (
          <>
            {/* Validation */}
            <ValidationStatus rig={currentRig} />

            {/* Bone hierarchy */}
            <div>
              <button
                type="button"
                className="mb-1 flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-300"
                onClick={toggleBoneTree}
                aria-expanded={showBoneTree}
                aria-label="Toggle bone hierarchy"
              >
                {showBoneTree ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                Bone Hierarchy
              </button>
              {showBoneTree && (
                <div className="max-h-48 overflow-y-auto rounded border border-zinc-700 bg-zinc-800 p-1">
                  {rootBones.map((bone) => (
                    <BoneTreeNode
                      key={bone.name}
                      bone={bone}
                      allBones={currentRig.bones}
                      depth={0}
                    />
                  ))}
                  {rootBones.length === 0 && (
                    <p className="p-2 text-center text-xs italic text-zinc-500">
                      No bones in template
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* IK Chains summary */}
            {currentRig.ik_chains.length > 0 && (
              <div className="rounded border border-zinc-700 bg-zinc-800 p-2">
                <p className="mb-1 text-xs font-medium text-zinc-400">
                  IK Chains ({currentRig.ik_chains.length})
                </p>
                {currentRig.ik_chains.map((chain) => (
                  <div key={chain.name} className="text-[10px] text-zinc-500">
                    {chain.name}: {chain.startBone} → {chain.endBone}
                    {chain.poleTarget && ` (pole: ${chain.poleTarget})`}
                  </div>
                ))}
              </div>
            )}

            {/* Apply button */}
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleApplyRig}
              disabled={!primaryId || !validateRig(currentRig).valid}
              aria-label="Apply rig to selected entity"
            >
              <Bone className="h-3.5 w-3.5" />
              Apply Rig to Entity
            </button>
          </>
        )}
      </div>
    </div>
  );
}
