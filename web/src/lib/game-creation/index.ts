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
