/**
 * System registry for the Game Creation Orchestrator.
 *
 * Re-exports the registry and loads all built-in system definitions.
 * Import this module (not registry.ts directly) to ensure all systems
 * are registered before the registry is queried.
 *
 * Approved spec: specs/2026-03-25-game-creation-orchestrator-phase2a-v4.md
 */

// Re-export public API from the core registry module
export type { SystemStepInput, SystemDefinition } from './registry';
export { SYSTEM_REGISTRY, registerSystem } from './registry';

// Side-effect imports — each file calls registerSystem() on load
import './movement';
import './camera';
import './world';
// NOTE: 'entities' is intentionally NOT registered here. Entity setup is
// handled by planBuilder Phase 2, which iterates gdd.scenes[].entities
// directly. Registering 'entities' in the system registry would cause
// duplicate spawn_entity calls (Phase 2 + Phase 3 both spawning).
