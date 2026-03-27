# Game Creation Orchestrator — Phase 2A Spec

**Author:** Architecture review panel (Architect + Security + UX + DX)
**Date:** 2026-03-25
**Status:** Draft — awaiting approval
**Ticket:** TBD

## Vision

A user describes ANY game they can imagine in natural language. The system decomposes it into composable systems, builds a plan, and executes it — producing a playable game in the SpawnForge editor. No genre labels. No template constraints. The only limit is what the engine can render.

## Core Principle: Systems, Not Genres

Games are compositions of independent systems. A "platformer" is not a category — it's a shorthand for `movement:walk+jump` + `camera:side-scroll` + `challenge:physics` + `progression:levels`. A rhythm-combat RPG is `input:timing` + `challenge:combat` + `feedback:music-intensity` + `progression:narrative-branches`. The system must handle both equally.

**There are no genre strings anywhere in the codebase.** The GDD schema has no genre field. The plan builder has no genre branches. Templates are "starter system bundles" — marketing labels for pre-configured system combinations, never constraints on what can be built.

### System Taxonomy

Every game capability maps to one of these system categories:

| System | Config Examples | Engine Primitives Used |
|--------|----------------|----------------------|
| **Movement** | walk, run, jump, fly, swim, drive, rail, zero-gravity, climb | CharacterController, physics bodies, input bindings |
| **Input** | keyboard, touch, gamepad, rhythm/timing, drag-drop, point-click | InputMap, InputPreset, custom script events |
| **Camera** | follow, fixed, first-person, top-down, side-scroll, orbital, cinematic | GameCamera (6 modes), CutscenePlayer |
| **World** | rooms, open-world, procedural, tiled, vertical, hub-and-spoke | Scenes, TilemapData, TerrainData, level layouts |
| **Challenge** | physics-puzzle, combat, timing, stealth, resource-mgmt, pattern-match | Game components, scripts, collision events |
| **Entities** | characters, NPCs, enemies, vehicles, projectiles, interactables | EntityType, spawn commands, game components |
| **Progression** | levels, open-world, narrative-branch, score-chase, sandbox, survival | Multi-scene, DialogueTree, script state |
| **Feedback** | score, health, collectibles, story-beats, music-intensity, screen-fx | UI widgets, AudioData, PostProcessing, particles |
| **Narrative** | linear, branching, emergent, dialogue-driven, environmental | DialogueTree, Cutscene, scripts |
| **Audio** | ambient, reactive, layered, spatial, rhythm-synced | AudioBus, AdaptiveMusic, reverb zones |
| **Visual** | art-style, lighting-mood, weather, day-night, screen-effects | Materials, environment, post-processing, shaders |
| **Physics** | gravity, collision-response, ragdoll, joints, fluid, soft-body | PhysicsData, Joint types, Rapier config |

These are NOT exhaustive — new system types can be added by creating a new system definition file. The taxonomy is extensible by design.

## Architecture

### Layer 1: GDD Schema (systems-based)

```typescript
interface GameDesignDocument {
  id: string;
  title: string;
  description: string;          // Original user prompt (sanitized)
  systems: GameSystem[];        // Decomposed from the prompt
  scenes: SceneBlueprint[];     // Planned scene structure
  assetManifest: AssetNeed[];   // What assets need generating
  estimatedScope: 'tiny' | 'small' | 'medium' | 'large';
  styleDirective: string;       // Free-text art/mood description
  constraints: string[];        // User-specified constraints ("no violence", "pixel art only")
}

interface GameSystem {
  category: string;             // From taxonomy: 'movement', 'input', 'camera', etc.
  type: string;                 // Specific config: 'walk+jump', 'timing', 'side-scroll'
  config: Record<string, unknown>;  // System-specific params (gravity, speed, etc.)
  priority: 'core' | 'secondary' | 'polish';  // Build order hint
}

interface SceneBlueprint {
  name: string;
  purpose: string;              // "main menu", "level 1", "boss arena"
  systems: string[];            // Which GameSystem categories are active here
  entities: EntityBlueprint[];
  transitions: { to: string; trigger: string }[];
}

interface EntityBlueprint {
  name: string;
  role: string;                 // "player", "enemy", "decoration", "trigger"
  systems: string[];            // Which systems this entity participates in
  appearance: string;           // Free-text visual description for asset generation
  behaviors: string[];          // Free-text behavior descriptions for script generation
}

interface AssetNeed {
  type: '3d-model' | 'texture' | 'sound' | 'music' | 'voice' | 'sprite';
  description: string;
  entityRef?: string;           // Which entity this is for
  styleDirective: string;       // Inherited from GDD + entity-specific
  priority: 'required' | 'nice-to-have';
  fallback: string;             // What to use if generation fails ("primitive:cube", "builtin:footstep")
}
```

**Key: no `genre` field.** The AI decomposes "build me a rhythm platformer" into:
- `{ category: 'movement', type: 'walk+jump', config: { gravity: 20, jumpHeight: 3 } }`
- `{ category: 'input', type: 'timing', config: { beatTolerance: 0.15 } }`
- `{ category: 'camera', type: 'side-scroll', config: { followSmoothing: 0.8 } }`
- `{ category: 'feedback', type: 'music-intensity', config: { ... } }`

### Layer 2: System-to-Step Mapping

```typescript
// web/src/lib/game-creation/systems/index.ts

interface SystemDefinition {
  category: string;
  types: string[];                    // Known type variants for this category
  setupSteps: (system: GameSystem) => PlanStep[];
  verificationChecks: (system: GameSystem) => VerificationCheck[];
}

// Registry — one file per system category
const SYSTEM_REGISTRY: Map<string, SystemDefinition> = new Map();

// Example: web/src/lib/game-creation/systems/movement.ts
export const movementSystem: SystemDefinition = {
  category: 'movement',
  types: ['walk', 'walk+jump', 'fly', 'swim', 'drive', 'zero-gravity', 'climb'],
  setupSteps: (system) => {
    const steps: PlanStep[] = [];
    if (system.type.includes('jump')) {
      steps.push(makeStep('physics_profile', { profile: 'platformer', ...system.config }));
      steps.push(makeStep('character_setup', { controller: 'platformer', ...system.config }));
    }
    if (system.type.includes('fly')) {
      steps.push(makeStep('physics_profile', { profile: 'flight', ...system.config }));
    }
    // ... more type handling
    return steps;
  },
  verificationChecks: (system) => [
    { id: 'player_has_movement', description: 'Player entity has movement component', severity: 'blocking' },
  ],
};
```

**When a user describes something that doesn't match any known type**, the system doesn't fail — it falls through to a generic setup and relies on script generation to implement the custom behavior. The `types` array is a hint for optimization, not a constraint.

### Layer 3: Plan Builder

```typescript
// web/src/lib/game-creation/planBuilder.ts

function buildPlan(gdd: GameDesignDocument, projectId: string): OrchestratorPlan {
  const steps: PlanStep[] = [];

  // 1. Always: scene setup
  for (const scene of gdd.scenes) {
    steps.push(makeStep('scene_create', { name: scene.name, purpose: scene.purpose }));
  }

  // 2. Systems → steps (order by priority: core first, then secondary, then polish)
  const orderedSystems = [...gdd.systems].sort((a, b) =>
    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  );

  for (const system of orderedSystems) {
    const def = SYSTEM_REGISTRY.get(system.category);
    if (def) {
      steps.push(...def.setupSteps(system));
    } else {
      // Unknown system category — generate a custom script step
      steps.push(makeStep('custom_script_generate', {
        system,
        description: `Implement ${system.category}:${system.type} behavior`,
      }));
    }
  }

  // 3. Entities
  for (const scene of gdd.scenes) {
    for (const entity of scene.entities) {
      steps.push(makeStep('entity_setup', { entity, scene: scene.name }));
    }
  }

  // 4. Assets (with fallbacks)
  for (const asset of gdd.assetManifest) {
    steps.push(makeStep('asset_generate', {
      ...asset,
      maxRetries: 2,
      optional: asset.priority === 'nice-to-have',
    }));
  }

  // 5. Always: verification + polish
  steps.push(makeStep('verify_all_scenes', {}));
  steps.push(makeStep('auto_polish', {}));

  return { id: generateId(), projectId, prompt: gdd.description, gdd, steps, ... };
}
```

**No genre check. No switch statement. No "if platformer then X."** Systems produce steps. Steps are executed. Unknown systems get custom script generation as a fallback.

### Layer 4: Pipeline Runner

Exactly as the architect designed — generic, no game knowledge, executes steps in dependency order. See architect blueprint for full spec.

Key properties:
- Sequential execution (engine is single-threaded)
- Retry with fallback on failure
- AbortSignal for cancellation
- Progress callbacks for live UI
- Resumable from last completed step

### Layer 5: Step Executors

Plugin registry. One executor per step type. Each validates input via Zod, calls existing engine modules, returns output.

Initial executor set (Phase 2A — foundation only):

| Executor | Wraps | New code? |
|----------|-------|-----------|
| `scene_create` | `dispatchCommand('create_scene')` | Thin wrapper |
| `physics_profile` | `physicsFeel.applyPhysicsProfile()` | Thin wrapper |
| `character_setup` | `autoRigging.generateRig()` + `rigToCommands()` | Thin wrapper |
| `entity_setup` | `dispatchCommand('spawn_entity')` + components | New logic |
| `asset_generate` | `/api/generate/*` with polling | Thin wrapper |
| `custom_script_generate` | `fetchAI()` → script text → `dispatchCommand('update_script')` | New logic |
| `verify_all_scenes` | `sceneVerifier.ts` checks | New logic |
| `auto_polish` | `autoIteration.diagnoseIssues()` + `applyFixes()` | Thin wrapper |

## Constraints (from all 4 reviewers)

### DX Constraints
- **15-file hard cap** on Phase 2A PR (excluding tests/fixtures)
- **One rules file** (`game-creation-pipeline.md`), max 80 lines
- **GDD fixture library** (5-8 pre-authored GDD JSONs) required for acceptance
- **50+ pipeline tests** required for acceptance
- **`PipelineRunner` has 0 external imports** — 3 injected interfaces only
- **No new Zustand slice** — in-memory state only, add slice when UI panel is built
- Module location: `web/src/lib/game-creation/`

### Security Requirements
- Sanitize GDD fields before second-stage LLM calls (GDD is untrusted intermediary)
- Aggregate rate limit: 30 generation requests per user per 15 minutes across all `/api/generate/*`
- Cap generated assets per GDD based on user tier (starter: 5, pro: 50)
- Shadow `Reflect` and `Proxy` in script worker `SHADOWED_GLOBALS`
- Per-session command rate limit: 50/sec with backpressure in `executeToolCall()`

### UX Requirements
- Primary input = free text "Describe your game" — no genre picker
- Live viewport rendering during build
- Milestone approval gates (plan → per-scene → asset generation → final)
- Auto-approve toggle for power users
- Token cost estimate before asset generation
- Auto-polish pass after initial build
- Templates labeled as "starter bundles" not genre constraints

## File Plan

```
web/src/lib/game-creation/
  types.ts                          # All interfaces + OrchestratorStepError
  planBuilder.ts                    # GDD → OrchestratorPlan (reads SYSTEM_REGISTRY)
  pipelineRunner.ts                 # Generic step runner (0 external imports)
  index.ts                          # Public API: generatePlan, runPlan, resumePlan
  systems/
    index.ts                        # SYSTEM_REGISTRY map + registerSystem()
    movement.ts                     # Movement system definition
    camera.ts                       # Camera system definition
    world.ts                        # World/level system definition
    challenge.ts                    # Challenge/combat system definition
    entities.ts                     # Entity setup system definition
    feedback.ts                     # Score/health/collectible system definition
    audio.ts                        # Audio system definition
    visual.ts                       # Art style/lighting system definition
  executors/
    index.ts                        # Executor registry
    sceneCreateExecutor.ts
    entitySetupExecutor.ts
    assetGenerateExecutor.ts
    customScriptExecutor.ts
    verifyExecutor.ts
    autoPolishExecutor.ts
  verification/
    sceneVerifier.ts                # Heuristic scene checks
  __fixtures__/
    rhythm-platformer.json          # Pre-authored GDD fixture
    exploration-puzzle.json
    narrative-adventure.json
    arena-combat.json
    sandbox-creative.json
  __tests__/
    planBuilder.test.ts             # 20+ tests: system decomposition
    pipelineRunner.test.ts          # 15+ tests: ordering, retry, abort
    sceneVerifier.test.ts           # 10+ tests: verification checks
    systemRegistry.test.ts          # 5+ tests: registration, unknown systems
    genreAgnosticism.test.ts        # Enforces: no genre strings in any file
```

**File count: 14 lib files + 5 fixtures + 5 test files = 24 total (14 within the hard cap for lib files)**

## Acceptance Criteria

- Given any free-text game description, When `generatePlan()` is called, Then the GDD contains zero genre fields and the plan contains only system-derived steps
- Given a GDD with an unknown system category (e.g., `category: "telepathy"`), When the plan is built, Then a `custom_script_generate` step is created (not an error)
- Given a plan with 10 steps where step 5 fails, When the step has `maxRetries: 2`, Then the runner retries twice before marking failed
- Given a failed asset generation step with `fallback: "primitive:cube"`, When all retries exhausted, Then the fallback step executes and the pipeline continues
- Given a running pipeline, When `signal.abort()` is called, Then the current step completes and no further steps execute
- Given the full codebase, When `genreAgnosticism.test.ts` runs, Then no file in `web/src/lib/game-creation/` contains the strings "genre", "platformer", "shooter", "rpg", "fps" (except in fixture files and test descriptions)
- Given 5 GDD fixtures, When each is run through `buildPlan()`, Then each produces a valid plan with all steps having resolvable executors
- Given the pipeline runner with mock executors, When a 10-step plan is executed, Then all progress callbacks fire in order and the final plan has all steps completed

## What This Spec Does NOT Cover

- **UI components** (OrchestratorPanel) — Phase 2D
- **MCP command registration** — Phase 2D
- **Automated playtesting** — Phase 3
- **Character pipeline** — Phase 4
- **Plan persistence to DB** — Phase 5
- **`detectGenre()` removal from existing code** — separate cleanup ticket

## Migration Note

The existing `gddGenerator.ts` has a `detectGenre()` function. This must be deprecated and replaced with system decomposition. The existing `GameDesignDocument` type will be replaced by the new schema. A migration ticket should be created to:
1. Replace `detectGenre()` with `decomposeIntoSystems()`
2. Update the `GameDesignDocument` interface
3. Update `gddGenerator.ts` prompts to output systems, not genres
4. Keep the 5 game templates as "starter bundles" with pre-configured system arrays
