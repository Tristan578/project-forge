'use client';

import { useState, useCallback, useMemo } from 'react';
import { Bone, ChevronDown, ChevronRight, AlertCircle, CheckCircle2, Wand2 } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import {
  RIG_TEMPLATES,
  detectRigType,
  validateRig,
  rigToCommands,
  generateRig,
} from '@/lib/ai/autoRigging';
import type { RigType, RigTemplate, BoneDefinition } from '@/lib/ai/autoRigging';
import { parseSkeletonWire2d } from '@/lib/skeleton2d/skeletonPayload';

const RIG_TYPE_LABELS: Record<RigType, string> = {
  humanoid: 'Humanoid (23 bones)',
  quadruped: 'Quadruped (19 bones)',
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
            <ChevronDown className="h-3 w-3 shrink-0 text-zinc-400" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-zinc-400" />
          )
        ) : (
          <span className="inline-block h-3 w-3 shrink-0" />
        )}
        <Bone className="h-3 w-3 shrink-0 text-zinc-400" />
        <span className="truncate">{bone.name}</span>
        <span className="ml-auto text-[10px] text-zinc-400">L={bone.length.toFixed(2)}</span>
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
  // Both actions in this panel used to be silent on every path — Apply Rig
  // returned early on a missing selection or an unusable rig and said nothing,
  // and Generate had a `finally` with no `catch`, so a throw only cleared the
  // spinner. The status lives in one place so a screen reader announces either
  // outcome (PF-1170).
  // `warn` is a third outcome, not a shade of the other two: a rig whose IK chain the
  // payload builder had to bound did apply, so calling it an error is wrong — and
  // calling it a plain success is how a chain that cannot reach its target looks like
  // one that can.
  const [status, setStatus] = useState<{
    kind: 'ok' | 'warn' | 'error';
    message: string;
  } | null>(null);

  const detectedType = useMemo(
    () => description.trim() ? detectRigType(description) : null,
    [description],
  );

  const effectiveType = selectedType === 'auto' ? detectedType : selectedType;

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setStatus(null);
    try {
      const rig = await generateRig(
        description,
        selectedType === 'auto' ? undefined : selectedType,
      );
      setCurrentRig(rig);
      setStatus({
        kind: 'ok',
        message: `Generated a ${rig.type} rig with ${rig.bones.length} bones. Not applied yet.`,
      });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: `Could not generate a rig: ${err instanceof Error ? err.message : 'unknown error'}`,
      });
    } finally {
      setIsGenerating(false);
    }
  }, [description, selectedType]);

  const handleSelectTemplate = useCallback((type: RigType) => {
    const templateFn = RIG_TEMPLATES[type];
    const rig = templateFn();
    setCurrentRig(rig);
    setSelectedType(type);
    setStatus({
      kind: 'ok',
      message: `Loaded the ${type} template with ${rig.bones.length} bones. Not applied yet.`,
    });
  }, []);

  const setSkeleton2d = useEditorStore((s) => s.setSkeleton2d);

  const handleApplyRig = useCallback(() => {
    if (!currentRig) {
      setStatus({ kind: 'error', message: 'Generate or choose a rig first.' });
      return;
    }
    if (!primaryId) {
      setStatus({ kind: 'error', message: 'Select an entity in the scene to apply the rig to.' });
      return;
    }

    // Go through the store (not direct dispatch) so Zustand state stays
    // in sync with the engine — required for save, inspector, and scripts.
    const rigWarnings: string[] = [];
    const commands = rigToCommands(currentRig, primaryId, rigWarnings);
    // `rigToCommands` emits the engine's real command name and nests the skeleton
    // under `skeletonData`. This used to look for `set_skeleton_2d` and spread the
    // payload root, so once the builder was corrected the find never matched and
    // Apply Rig silently did nothing (PF-1170).
    const skeletonCmd = commands.find((c) => c.command === 'create_skeleton2d');
    const skeletonData = (skeletonCmd?.payload as { skeletonData?: unknown } | undefined)?.skeletonData;
    if (!skeletonData) {
      // The silent `if (skeletonData)` here is exactly how the broken command
      // name above went unnoticed for as long as it did.
      setStatus({
        kind: 'error',
        message: 'Could not apply the rig: the generated rig produced no skeleton to send.',
      });
      return;
    }
    // `buildCreateSkeleton2dPayload` emits the ENGINE's wire shape, which is not the
    // store's: a wire bone's `localPosition` is a 3-tuple where the store declares a
    // pair, and a wire mesh attachment carries `weights` the store's flat attachment
    // has nowhere to put. Casting it in (`as Parameters<typeof setSkeleton2d>[1]`) is
    // the same class of lie as `{ ...input } satisfies T` — it type-checks and then
    // the inspector renders a value whose declared type says it cannot exist. Narrow
    // through the module that owns the wire→store direction instead. Bone z is
    // dropped, which is correct: nothing in the engine reads `local_position[2]`
    // (it is preserved but never used), the store cannot hold it, and the first
    // `SKELETON2D_UPDATED` event narrows it away regardless.
    const parsed = parseSkeletonWire2d(skeletonData);
    if (!parsed) {
      setStatus({
        kind: 'error',
        message: 'Could not apply the rig: the generated skeleton was not in a readable shape.',
      });
      return;
    }
    setSkeleton2d(primaryId, parsed);
    const applied = `Applied a ${currentRig.bones.length}-bone rig to the selected entity.`;
    setStatus(
      rigWarnings.length > 0
        ? { kind: 'warn', message: `${applied} ${rigWarnings.join(' ')}` }
        : { kind: 'ok', message: applied },
    );
  }, [currentRig, primaryId, setSkeleton2d]);

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
          <span className="text-zinc-400">Target: </span>
          {primaryId ? (
            <span className="text-zinc-200">{primaryName ?? primaryId}</span>
          ) : (
            <span className="italic text-zinc-400">Select an entity</span>
          )}
        </div>

        {/* Description input */}
        <div>
          <label htmlFor="rig-description" className="mb-1 block text-xs text-zinc-400">
            Model Description
          </label>
          <textarea
            id="rig-description"
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            rows={2}
            placeholder="e.g. a medieval knight in armor"
            value={description}
            onChange={handleDescriptionChange}
          />
          {detectedType && selectedType === 'auto' && (
            <p className="mt-0.5 text-[10px] text-zinc-400">
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
                  <span className="text-[10px] text-zinc-400">{tmpl.bones.length} bones</span>
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
                    <p className="p-2 text-center text-xs italic text-zinc-400">
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
                  <div key={chain.name} className="text-[10px] text-zinc-400">
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

        {/* Rendered unconditionally: a live region only announces changes to a
            region already in the accessibility tree, so mounting it alongside
            the message would leave the first result unannounced. */}
        <div role="status" aria-live="polite" className="min-h-0">
          {status && (
            <p
              className={`flex items-start gap-1.5 rounded px-2 py-1.5 text-[11px] ${
                status.kind === 'ok'
                  ? 'bg-emerald-950/50 text-emerald-300'
                  : status.kind === 'warn'
                    ? 'bg-amber-950/50 text-amber-300'
                    : 'bg-red-950/50 text-red-300'
              }`}
            >
              {status.kind === 'ok'
                ? <CheckCircle2 className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                : <AlertCircle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />}
              {status.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
