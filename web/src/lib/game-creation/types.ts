/**
 * Phase 2A — Game Creation Orchestrator type definitions.
 *
 * Systems-not-genres: games are compositions of independent systems
 * (movement, input, camera, etc.), not genre categories.
 *
 * Approved spec: specs/2026-03-25-game-creation-orchestrator-phase2a-v4.md
 * Review: 4/4 PASS (architect, security, UX, DX)
 */

import { z } from 'zod';
import type { GddScope } from '@/lib/config/enums';
import type { EditorState } from '@/stores/editorStore';

// ---------------------------------------------------------------------------
// Executor names (type-safe union — compile-time checked)
// ---------------------------------------------------------------------------

export type ExecutorName =
  | 'plan_present'
  | 'scene_create'
  | 'physics_enable'
  | 'physics_profile'
  | 'camera_setup'
  | 'character_setup'
  | 'game_component'
  | 'entity_setup'
  | 'world_build'
  | 'asset_generate'
  | 'custom_script_generate'
  | 'verify_all_scenes'
  | 'auto_polish';

// ---------------------------------------------------------------------------
// System categories
// ---------------------------------------------------------------------------

export type SystemCategory =
  | 'movement' | 'input' | 'camera' | 'world' | 'challenge'
  | 'entities' | 'progression' | 'feedback' | 'narrative'
  | 'audio' | 'visual' | 'physics';

const SYSTEM_CATEGORIES_ARRAY: [SystemCategory, ...SystemCategory[]] = [
  'movement', 'input', 'camera', 'world', 'challenge',
  'entities', 'progression', 'feedback', 'narrative',
  'audio', 'visual', 'physics',
];

export const zSystemCategory = z.enum(SYSTEM_CATEGORIES_ARRAY);

// ---------------------------------------------------------------------------
// Game System
// ---------------------------------------------------------------------------

export interface GameSystem {
  category: SystemCategory;
  type: string;
  config: Record<string, unknown>;
  priority: 'core' | 'secondary' | 'polish';
  dependsOn: SystemCategory[];
}

// ---------------------------------------------------------------------------
// Feel Directive — captures experiential intent beyond raw systems
// ---------------------------------------------------------------------------

export interface FeelDirective {
  mood: string;
  pacing: 'slow' | 'medium' | 'fast';
  weight: 'floaty' | 'light' | 'medium' | 'heavy' | 'weighty';
  referenceGames: string[];
  oneLiner: string;
}

// ---------------------------------------------------------------------------
// Scene and Entity Blueprints
// ---------------------------------------------------------------------------

export interface SceneBlueprint {
  name: string;
  purpose: string;
  systems: SystemCategory[];
  entities: EntityBlueprint[];
  transitions: { to: string; trigger: string }[];
}

/**
 * Every role the GDD generator may file an entity under.
 *
 * ONE exported copy, because three consumers have to agree on it and a
 * hand-mirrored second copy is how they stop agreeing: the Zod schema the LLM
 * output is validated against (`zEntityRole`, used by `decomposer.ts`), the
 * `EntityBlueprint` type below, and `physicsRoles.ts`, which decides which of
 * these roles gets a physical body.
 *
 * Drift there is silent AND load-bearing: a role this list gains but
 * `PHYSICS_ROLE_PROFILES` does not is dropped from the `physics_enable` step by
 * a bare `continue`, so entities with that role spawn with no `PhysicsEnabled`
 * and no collider — nothing in the generated game collides with them, which is
 * exactly the bug PF-1213 exists to fix. Deriving `PhysicsRole` from this tuple
 * makes that a compile error instead.
 *
 * Same single-source-of-truth shape as `SYSTEM_CATEGORIES_ARRAY` above.
 */
export const ENTITY_ROLES = [
  'player', 'enemy', 'npc', 'decoration', 'trigger', 'interactable', 'projectile',
] as const;

export type EntityRole = (typeof ENTITY_ROLES)[number];

export const zEntityRole = z.enum(ENTITY_ROLES);

export interface EntityBlueprint {
  name: string;
  role: EntityRole;
  systems: SystemCategory[];
  /** Free text; `primitive:<shape>` selects the spawned mesh (see entitySetupExecutor). */
  appearance: string;
}

// ---------------------------------------------------------------------------
// Asset Manifest
// ---------------------------------------------------------------------------

export interface AssetNeed {
  type: '3d-model' | 'texture' | 'sound' | 'music' | 'voice' | 'sprite';
  description: string;
  entityRef?: string;
  styleDirective: string;
  priority: 'required' | 'nice-to-have';
  fallback: string;
}

export const FALLBACK_SCHEMA = z.string().regex(
  /^(primitive|builtin):[a-z][a-z0-9_-]{0,63}$/,
  'Fallback must be "primitive:<name>" or "builtin:<name>" with lowercase alphanumeric name'
);

// ---------------------------------------------------------------------------
// Orchestrator GDD — the systems-based game design document
// ---------------------------------------------------------------------------

export interface OrchestratorGDD {
  id: string;
  title: string;
  description: string;
  systems: GameSystem[];
  scenes: SceneBlueprint[];
  assetManifest: AssetNeed[];
  estimatedScope: GddScope;
  styleDirective: string;
  feelDirective: FeelDirective;
  constraints: string[];
  projectType: '2d' | '3d';
}

// ---------------------------------------------------------------------------
// Plan and Steps
// ---------------------------------------------------------------------------

export interface PlanStep {
  id: string;
  executor: ExecutorName;
  input: Record<string, unknown>;
  dependsOn: string[];
  maxRetries: number;
  optional: boolean;
  fallbackStepId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: Record<string, unknown>;
  error?: OrchestratorStepError;
  userFacingErrorMessage?: string;
}

export interface OrchestratorPlan {
  id: string;
  projectId: string;
  prompt: string;
  gdd: OrchestratorGDD;
  steps: PlanStep[];
  approvalGates: ApprovalGate[];
  tokenEstimate: TokenEstimate;
  status: 'planning' | 'awaiting_approval' | 'executing' | 'completed' | 'failed' | 'cancelled';
  currentStepIndex: number;
  createdAt: number;
  /**
   * Problems with the PLAN itself, as opposed to a step that ran and had
   * something to report (`PlanStep.warnings`).
   *
   * `runPipeline` records an empty `steps` slot here. It tolerates one rather
   * than crashing on it, and a tolerated gap with nothing written down is a
   * plan that reports full success while a step it was supposed to run simply
   * is not there — so the gap is recorded where the caller can see it.
   */
  warnings?: string[];
}

export interface OrchestratorStepError {
  code: string;
  message: string;
  userFacingMessage: string;
  retryable: boolean;
  details?: unknown;
}

// ---------------------------------------------------------------------------
// Approval Gates
// ---------------------------------------------------------------------------

export interface ApprovalGate {
  id: string;
  label: string;
  description: string;
  afterStepId: string;
  status: 'pending' | 'approved' | 'rejected';
  displayData: ApprovalDisplayData;
}

export interface ApprovalDisplayData {
  sceneSummaries?: Array<{
    name: string;
    entityCount: number;
    systemDescriptions: string[];
  }>;
  assetList?: Array<{
    description: string;
    type: string;
    estimatedTokenCost: number;
    hasFallback: boolean;
  }>;
  completionSummary?: {
    totalEntities: number;
    totalScenes: number;
    totalScripts: number;
    warnings: string[];
  };
}

// ---------------------------------------------------------------------------
// Token Estimation
// ---------------------------------------------------------------------------

export interface TokenEstimate {
  breakdown: Array<{
    category: string;
    estimatedTokens: number;
    variance: number;
  }>;
  totalEstimated: number;
  totalVarianceHigh: number;
  totalVarianceLow: number;
  userTier: string;
  sufficientBalance: boolean;
  warningMessage?: string;
}

// ---------------------------------------------------------------------------
// Executor Context and Definition
// ---------------------------------------------------------------------------

export type UserTier = 'starter' | 'hobbyist' | 'creator' | 'pro';

export interface ExecutorContext {
  dispatchCommand: (command: string, payload: unknown) => void;
  dispatchCommandBatch?: (commands: Array<{ command: string; payload?: unknown }>) => import('@/hooks/useEngine').BatchResult;
  /**
   * Reads the editor store LIVE at call time.
   *
   * Supplied by the orchestrator rather than imported, deliberately: a static
   * or dynamic `import('@/stores/editorStore')` from an executor is a real
   * module edge, and the executor barrel is reachable from
   * `/api/game/decompose`, so importing the store there drags `useEngine`
   * (and its `useSyncExternalStore`) into a React Server Component and breaks
   * `next build`. Passing a function keeps the edge in client-only code.
   *
   * This replaced a plain `store: EditorState` snapshot field. The snapshot was
   * taken once, before the pipeline started, and Zustand 5 replaces the state
   * object on every write (`state = Object.assign({}, state, next)`) — so it
   * could never observe a write made by an earlier step, and every entity the
   * pipeline itself spawned was missing from it. Two executors were reading it
   * as if it were live; one of them dispatched a despawned `entityId` straight
   * to the engine (PF-1118). The field is gone rather than deprecated so the
   * mistake is a type error, not a comment someone has to notice.
   */
  getStore: () => EditorState;
  projectType: '2d' | '3d';
  userTier: UserTier;
  signal: AbortSignal;
  /**
   * The output of the FIRST COMPLETED step matching a step id or executor name.
   *
   * Same "completed only" rule as `resolveStepOutputs` below, and for the same
   * reason: a caller reaching for one output must not get a different answer
   * about what counts as an output than a caller reaching for all of them. A
   * step that has not run, produced no output, was skipped, or FAILED
   * contributes nothing here either — see the note on `resolveStepOutputs` for
   * why a truthy `output` is not evidence the step worked.
   *
   * Answers with the FIRST match, which is the right answer for a step that
   * appears once and a silently wrong one for a step that does not. Reach for
   * `resolveStepOutputs` whenever the executor can be planned more than once.
   */
  resolveStepOutput: (stepIdOrExecutorName: string) => Record<string, unknown> | undefined;
  /**
   * The output of EVERY completed step run by `executorName`, in plan order.
   *
   * `resolveStepOutput` answers with the FIRST match, which is the right answer
   * for a step that appears once and a silently wrong one for a step that does
   * not. A plan carries two `physics_enable` steps — one for the blueprint cast
   * (planBuilder Phase 2.5) and one for the world geometry (`systems/world.ts`)
   * — so reading the singular resolver for its `entityIds` returns the cast and
   * drops the ground, platforms and walls with nothing to show for it: the feel
   * pass lands on the player and the collectibles but not on the floor they
   * stand on. Nothing errors, because the ids simply never arrive.
   *
   * COMPLETED steps only. A step that has not run, produced no output, was
   * skipped, or FAILED contributes nothing — `pipelineRunner` deliberately keeps
   * a failed step's diagnostic output on the step (`verify_all_scenes` reports
   * why the game cannot be won and then returns `success: false`), so a truthy
   * `output` is not evidence the step worked. A failed OPTIONAL step is skipped
   * and the plan carries on, which is precisely when folding its half-finished
   * ids in as finished work would go unnoticed.
   */
  resolveStepOutputs: (executorName: string) => Record<string, unknown>[];
}

export interface ExecutorDefinition {
  name: ExecutorName;
  inputSchema: z.ZodType;
  execute: (input: Record<string, unknown>, ctx: ExecutorContext) => Promise<ExecutorResult>;
  userFacingErrorMessage: string;
}

export interface ExecutorResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: OrchestratorStepError;
}
