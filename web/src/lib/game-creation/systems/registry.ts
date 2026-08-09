/**
 * Core registry store — no side-effect imports here.
 *
 * Sub-modules (movement, camera, etc.) import from this file so that
 * SYSTEM_REGISTRY is always initialized before registerSystem() is called.
 */

import type {
  GameSystem,
  OrchestratorGDD,
  ExecutorName,
  EntityBlueprint,
} from '../types';

export interface SystemStepInput {
  executor: ExecutorName;
  input: Record<string, unknown>;
}

/**
 * An entity as the plan sees it: the blueprint the GDD designed, paired with
 * the engine id `buildPlan` minted for it. The engine addresses entities by
 * their `EntityId` component — a UUID that is a separate component from
 * `EntityName` — so a system step that needs to target an entity must bind to
 * `entityId`, never to `entity.name`.
 */
export interface PlannedEntity {
  entityId: string;
  scene: string;
  entity: EntityBlueprint;
}

/**
 * Everything a system definition needs from the plan being built, beyond the
 * system and the GDD themselves.
 */
export interface SystemStepContext {
  entities: PlannedEntity[];
  /**
   * Record a plan-level warning for the user. A system that cannot plan one of
   * its steps — because the GDD gave it nothing to target — should drop that
   * step and say so here rather than emit a step that is certain to fail: a
   * non-optional step failing sets the whole plan to `failed`, discarding every
   * other thing the build would have produced. The collected messages surface
   * on the final approval gate.
   */
  warn: (message: string) => void;
}

export interface SystemDefinition {
  category: string;
  /**
   * `ctx` is required rather than optional: `registerSystem` is public API, so
   * a definition written without it should be a compile error here rather than
   * a step that silently targets nothing at runtime.
   */
  setupSteps: (
    system: GameSystem,
    gdd: OrchestratorGDD,
    ctx: SystemStepContext,
  ) => SystemStepInput[];
}

export const SYSTEM_REGISTRY = new Map<string, SystemDefinition>();

export function registerSystem(def: SystemDefinition): void {
  SYSTEM_REGISTRY.set(def.category, def);
}
