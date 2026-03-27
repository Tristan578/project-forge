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
  | 'scene_create'
  | 'physics_profile'
  | 'character_setup'
  | 'entity_setup'
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

export interface EntityBlueprint {
  name: string;
  role: 'player' | 'enemy' | 'npc' | 'decoration' | 'trigger' | 'interactable' | 'projectile';
  systems: SystemCategory[];
  appearance: string;
  behaviors: string[];
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
  store: EditorState;
  projectType: '2d' | '3d';
  userTier: UserTier;
  signal: AbortSignal;
  resolveStepOutput: (stepIdOrExecutorName: string) => Record<string, unknown> | undefined;
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
