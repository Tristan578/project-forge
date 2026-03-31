/**
 * Core registry store — no side-effect imports here.
 *
 * Sub-modules (movement, camera, etc.) import from this file so that
 * SYSTEM_REGISTRY is always initialized before registerSystem() is called.
 */

import type { GameSystem, OrchestratorGDD, ExecutorName } from '../types';

export interface SystemStepInput {
  executor: ExecutorName;
  input: Record<string, unknown>;
}

export interface SystemDefinition {
  category: string;
  setupSteps: (system: GameSystem, gdd: OrchestratorGDD) => SystemStepInput[];
}

export const SYSTEM_REGISTRY = new Map<string, SystemDefinition>();

export function registerSystem(def: SystemDefinition): void {
  SYSTEM_REGISTRY.set(def.category, def);
}
