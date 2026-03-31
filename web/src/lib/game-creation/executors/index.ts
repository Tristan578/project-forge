import type { ExecutorName, ExecutorDefinition } from '../types';

export const EXECUTOR_REGISTRY = new Map<ExecutorName, ExecutorDefinition>();

export function registerExecutor(def: ExecutorDefinition): void {
  EXECUTOR_REGISTRY.set(def.name, def);
}

// Executor imports will be added as they are implemented
// import './sceneCreateExecutor';
// import './physicsProfileExecutor';
// etc.
