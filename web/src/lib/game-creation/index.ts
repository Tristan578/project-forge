/**
 * Public API for the Game Creation Orchestrator (Phase 2A).
 *
 * Systems-not-genres: all capabilities are exported as composable system
 * primitives. Callers import what they need; nothing auto-executes on import.
 *
 * Approved spec: specs/2026-03-25-game-creation-orchestrator-phase2a-v4.md
 */

export { decomposeIntoSystems } from './decomposer';
export { buildPlan } from './planBuilder';
export { runPipeline } from './pipelineRunner';
export type { PipelineCallbacks } from './pipelineRunner';
export { SYSTEM_REGISTRY, registerSystem } from './systems';
export type { SystemStepInput, SystemDefinition } from './systems';
export { EXECUTOR_REGISTRY, registerExecutor } from './executors';
// The closed per-entity behaviour vocabulary (PF-1114). Exported here because
// anything that constructs or validates a GDD outside this directory needs the
// same enum the decomposition schema uses -- a second hand-written copy of the
// verb list is how the two stop agreeing.
export { BEHAVIOR_VOCAB, BEHAVIOR_PLANS, zBehavior, isBehavior } from './behaviorVocabulary';
export type { Behavior, BehaviorPlan } from './behaviorVocabulary';
// The one versioned brief contract for manual and AI briefs (#10174). Same
// reason as the vocabulary above: a brief read or written outside this
// directory (persistence, the editor) validates with THIS function, not a
// second one.
export {
  BRIEF_ISSUE_CODES,
  BRIEF_LIMITS,
  BRIEF_SCHEMA_VERSION,
  validateBrief,
  zBriefContent,
  zGameBrief,
} from './briefSchema';
export type {
  BriefIssue,
  BriefIssueCode,
  BriefValidation,
  GameBrief,
  OpenDecision,
} from './briefSchema';
export type {
  OrchestratorGDD,
  OrchestratorPlan,
  PlanStep,
  ExecutorName,
  ExecutorContext,
  ExecutorResult,
  UserTier,
  SystemCategory,
  TokenEstimate,
  ApprovalGate,
} from './types';
