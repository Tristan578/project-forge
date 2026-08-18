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
export type {
  SystemStepInput,
  SystemDefinition,
  SystemStepContext,
  PlannedEntity,
} from './registry';
export { SYSTEM_REGISTRY, registerSystem } from './registry';

// Side-effect imports — each file calls registerSystem() on load
import './movement';
import './camera';
import './world';
import './progression';
import './feedback';
import './entities';
import './challenge';

// The plan-level win-condition fallback, for the many GDDs that declare no
// progression system for the definition above to run on. Declared BELOW the
// side-effect imports on purpose: `export … from` is an import declaration and
// is hoisted in source order, so re-exporting from './progression' above them
// would evaluate that module first and reorder the whole registry.
export { defaultWinConditionStep, DEFAULT_TARGET_SCORE } from './progression';
// NOTE: entity SPAWNING stays in planBuilder Phase 2, which iterates
// gdd.scenes[].entities directly. The 'entities' and 'challenge' systems
// registered above plan `game_component` steps ONLY — they never emit
// spawn_entity — so they attach behaviour to what Phase 2 already spawned
// rather than spawning it a second time. A system added here that DID spawn
// would reintroduce the duplicate-spawn hazard this note used to describe.
