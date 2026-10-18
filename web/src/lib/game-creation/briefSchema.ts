/**
 * The shared, versioned game-brief schema and validator (#10174).
 *
 * One contract for manual and AI briefs (idea.FR-1.OP-01, idea.FR-1.OP-02):
 * a brief that is valid in one path is valid in the other, and every problem
 * is reported on the exact field it belongs to instead of as a thrown error.
 *
 * Two schemas, built from the SAME leaf schemas:
 *
 *   - `zBriefContent` is the provider-facing shape the decomposer hands to the
 *     model as its structured-output schema. It moved here from
 *     `decomposer.ts` field for field, and `decomposerProviderSchema.test.ts`
 *     pins the JSON schema the provider derives from it — a change here is a
 *     change to what the model is told, and must update that snapshot on
 *     purpose (#10180 does so when it adds `openDecisions`).
 *   - `zGameBrief` is the editable brief. It adds the fields the decomposer
 *     fills in afterwards (`id`, `description`, `projectType`), the schema
 *     version, an optional brief-local `id` on every system, scene, entity and
 *     asset need (addressing keys that #9806 consumes as requirement ids), an
 *     optional `openDecisions` list, and explicit size caps. Every object in
 *     it is STRICT: a field the schema does not name is a `SCHEMA` issue on
 *     that field, never a silent drop (see the note above `zBriefSystem`).
 *
 * One set of cross-field checks (`checkBriefInvariants`), reached two ways:
 *
 *   - `validateBrief` runs the shape, then ALL the checks, and returns
 *     `{ brief, issues }` without ever throwing. The manual editor runs it on
 *     every edit.
 *   - `zBriefOutput` is `zBriefContent` refined with the BUILD-BLOCKING subset
 *     of the same checks (`BUILD_BLOCKING_BRIEF_ISSUE_CODES`), raised as Zod
 *     custom issues carrying the issue code in `params`. The decomposer
 *     validates the model's object with it, so a rule that would break the
 *     build is one the model is asked to try again on, and the decomposer's
 *     error names the same code the editor shows. The advisory rules (a
 *     dangling transition, an `entityRef` naming no entity, a progression
 *     system in a goal-free mode) are reported to the editor only: the plan
 *     builder copes with each, and the model is never told about them, so a
 *     retry on one would be a retry spent on nothing.
 *
 * One check is the brief's alone: item ids (`checkItemIds`, reported as
 * `DUPLICATE_ITEM_ID`). The provider shape carries no ids, so there is nothing
 * for the AI gate to see; `validateBrief` runs it after the shared checks.
 *
 * Server-safe on purpose: `decomposer.ts` runs inside `/api/game/decompose`,
 * so nothing here may import from `stores/` (`serverSafeImports.test.ts`).
 * The completion-mode vocabulary comes from `lib/playMode/completionMode`.
 */

import { z } from 'zod';
import { zSystemCategory, zEntityRole } from './types';
import type { SystemCategory } from './types';
import { zBehavior } from './behaviorVocabulary';
import { COMPLETION_MODES } from '@/lib/playMode/completionMode';
import type { CompletionMode } from '@/lib/playMode/completionMode';
import { findSystemDependencyCycle, formatDependencyCycle } from './systemDependencies';
import { progressionPlansWinCondition } from './systems/progressionPrecondition';

// ---------------------------------------------------------------------------
// Version and caps
// ---------------------------------------------------------------------------

/**
 * The brief schema version this build writes and reads. A brief that states
 * a different version is refused with `UNSUPPORTED_VERSION`; one that states
 * none reads as version 1, the version that existed before the field did.
 */
export const BRIEF_SCHEMA_VERSION = 1 as const;

/**
 * Explicit size caps. They admit a 100-system design (N1 in #9805) while
 * bounding the work a user- or AI-supplied brief can ask of the validator,
 * the store and the plan builder (N3). A brief over a cap is reported, never
 * truncated: the caller sees `LIMIT_EXCEEDED` on the field and decides.
 */
export const BRIEF_LIMITS = Object.freeze({
  /** Brief-local ids: the brief's own, and the optional one on each item. */
  id: 128,
  description: 2000,
  systems: 200,
  scenes: 64,
  entitiesPerScene: 128,
  transitionsPerScene: 32,
  /**
   * `dependsOn` entries per system. Twelve categories exist, so a system
   * can meaningfully depend on at most eleven others; the slack is for the
   * list growing. The cap is on the BRIEF only — the provider shape has no
   * cap (a change there changes the model-facing schema) — so the cycle
   * detector still has to cope with an unbounded list from the AI path.
   */
  dependsOn: 16,
  assets: 100,
  constraints: 50,
  openDecisions: 20,
  decisionOptions: 8,
  decisionPath: 200,
  decisionText: 300,
});

// ---------------------------------------------------------------------------
// Leaf schemas — moved from decomposer.ts, unchanged
// ---------------------------------------------------------------------------

// One array schema, so the brief's capped `dependsOn` below is the provider's
// list with a cap, not a second list.
const zDependsOn = z.array(zSystemCategory);

const zGameSystem = z.object({
  category: zSystemCategory,
  type: z.string().min(1).max(100),
  config: z.record(z.string(), z.unknown()),
  priority: z.enum(['core', 'secondary', 'polish']),
  dependsOn: zDependsOn.default([]),
});

const zFeelDirective = z.object({
  mood: z.string().min(1).max(100),
  pacing: z.enum(['slow', 'medium', 'fast']),
  weight: z.enum(['floaty', 'light', 'medium', 'heavy', 'weighty']),
  referenceGames: z.array(z.string().max(100)).max(5).default([]),
  oneLiner: z.string().min(1).max(200),
});

const zEntityBlueprint = z.object({
  name: z.string().min(1).max(100),
  // Shared with `EntityBlueprint['role']` and `physicsRoles.ts` rather than
  // restated: a role this schema accepts but the physics table does not know
  // spawns with no collider and nothing collides with it (PF-1213).
  role: zEntityRole,
  systems: z.array(zSystemCategory),
  // Free text, but `primitive:<shape>` is the form `entity_setup` acts on — it
  // picks the spawned mesh from it. Anything else falls back to the role default.
  // (`behaviors` used to live here too: prose the model spent tokens writing and
  // no stage of the pipeline ever read — PF-1111.)
  appearance: z.string().max(300),
  // SINGULAR and CLOSED (PF-1114). `zBehavior` is a `z.enum` over
  // `BEHAVIOR_VOCAB`, so a verb outside the vocabulary fails validation and the
  // decomposer's retry loop asks the model again — rather than being sanitized
  // into a string that reaches the plan builder and means nothing there.
  // Optional because most entities are scenery, and because every GDD written
  // before the field existed must still parse.
  behavior: zBehavior.optional(),
});

const zSceneBlueprint = z.object({
  name: z.string().min(1).max(100),
  purpose: z.string().max(200),
  systems: z.array(zSystemCategory),
  entities: z.array(zEntityBlueprint),
  transitions: z.array(z.object({
    to: z.string().min(1),
    trigger: z.string().min(1),
  })),
});

const zAssetNeed = z.object({
  type: z.enum(['3d-model', 'texture', 'sound', 'music', 'voice', 'sprite']),
  description: z.string().min(1).max(300),
  entityRef: z.string().optional(),
  styleDirective: z.string().max(300),
  priority: z.enum(['required', 'nice-to-have']),
  fallback: z.string().regex(/^(primitive|builtin):[a-z][a-z0-9_-]{0,63}$/),
});

// ---------------------------------------------------------------------------
// The provider-facing shape
// ---------------------------------------------------------------------------

/**
 * The plain object shape the decomposer hands to the provider as the
 * structured-output schema. Kept separate from `zBriefOutput` below because
 * the cross-field refinement that one carries is not expressible in JSON
 * Schema — the provider would silently drop it. Splitting the two makes the
 * split deliberate: the provider enforces the shape, we enforce the invariants.
 *
 * Field for field the shape that lived in `decomposer.ts` before #10174.
 */
export const zBriefContent = z.object({
  title: z.string().min(1).max(200),
  systems: z.array(zGameSystem).min(1),
  scenes: z.array(zSceneBlueprint).min(1),
  assetManifest: z.array(zAssetNeed),
  estimatedScope: z.enum(['small', 'medium', 'large']),
  styleDirective: z.string().max(500),
  feelDirective: zFeelDirective,
  constraints: z.array(z.string().max(200)),
  // How the game is "complete" (idea.FR-1.OP-04, #9998). CLOSED to the shared
  // `COMPLETION_MODES` — the list the manual picker offers and the
  // `set_completion_mode` tool validates against — so an unknown mode fails
  // validation and the retry loop asks again instead of guessing. Optional:
  // omitted means the legacy `win`, which keeps every older brief valid.
  completionMode: z.enum(COMPLETION_MODES).optional(),
});

export type BriefContent = z.infer<typeof zBriefContent>;

// ---------------------------------------------------------------------------
// The editable brief
// ---------------------------------------------------------------------------

const zItemId = z.string().min(1).max(BRIEF_LIMITS.id);

/**
 * Every object in the brief is STRICT — the root and each nested object:
 * systems, scenes, entities, transitions, asset needs, the feel directive and
 * open decisions. A key the schema does not name is reported as a `SCHEMA`
 * issue on that key (`fromZodIssue` turns Zod's one `unrecognized_keys` issue
 * into one issue per key, on the key's own path), never silently dropped.
 *
 * Zod's default object STRIPS unknown keys. That is right for the provider
 * path and wrong for the brief, which is why the two differ here:
 *
 *   - The model is told `additionalProperties: false` on every object, so a
 *     stray key in its output is provider noise; stripping it is free, and a
 *     retry spent on it would be a retry spent on nothing. The shared leaves
 *     stay as they are, and the provider schema stays byte-identical
 *     (`decomposerProviderSchema.test.ts`).
 *   - A brief a person wrote, and #10176 will persist, is author data. With
 *     stripping, `styleDirectve` validated and the returned brief had lost
 *     the field with nothing to say so — a validator that backs persistence
 *     must not do that.
 *
 * So strictness is applied to the brief's composition only: on the `.extend`
 * copies below, and on a strict copy of each leaf the brief reuses whole
 * (`zBriefTransition`, `zBriefFeelDirective`). `.strict()` clones the leaf's
 * `shape` container but keeps every field schema in it by reference, so the
 * FIELDS are still the provider's own — `briefSchema.test.ts` pins that
 * identity field by field.
 */
const zBriefSystem = zGameSystem.extend({
  id: zItemId.optional(),
  dependsOn: zDependsOn.max(BRIEF_LIMITS.dependsOn).default([]),
}).strict();

const zBriefEntity = zEntityBlueprint.extend({ id: zItemId.optional() }).strict();

// The leaf's own element, made strict: the brief adds no field to a transition.
const zBriefTransition = zSceneBlueprint.shape.transitions.element.strict();

const zBriefScene = zSceneBlueprint.extend({
  id: zItemId.optional(),
  entities: z.array(zBriefEntity).max(BRIEF_LIMITS.entitiesPerScene),
  transitions: z.array(zBriefTransition).max(BRIEF_LIMITS.transitionsPerScene),
}).strict();

const zBriefAsset = zAssetNeed.extend({ id: zItemId.optional() }).strict();

// Reused whole, so a strict copy rather than an extension.
const zBriefFeelDirective = zBriefContent.shape.feelDirective.strict();

/**
 * A choice the author of the brief could not make: the AI flags it rather
 * than silently picking (#10180 adds it to the provider shape), and the
 * editor shows it as a `decision` issue until it is resolved or dismissed
 * (#10175). `path` names the part of the brief the question is about, in
 * dotted form such as `systems.0.type`.
 *
 * Strict like the rest of the brief. Brief-only today; when #10180 puts it in
 * the provider shape, give that shape a stripping copy (the leaf rule above)
 * rather than loosening this one.
 */
export const zOpenDecision = z.object({
  id: zItemId,
  path: z.string().min(1).max(BRIEF_LIMITS.decisionPath),
  question: z.string().min(1).max(BRIEF_LIMITS.decisionText),
  options: z
    .array(z.string().min(1).max(BRIEF_LIMITS.decisionText))
    .min(1)
    .max(BRIEF_LIMITS.decisionOptions),
}).strict();

export type OpenDecision = z.infer<typeof zOpenDecision>;

/**
 * The editable, versioned brief. Built from the same leaf schemas as
 * `zBriefContent` (by reference, pinned in `briefSchema.test.ts`), plus the
 * fields the content shape leaves to the decomposer and the caps above.
 * Strict at the root too: an unknown top-level field is a `SCHEMA` issue.
 *
 * Structurally an `OrchestratorGDD`, so a validated brief feeds `buildPlan`
 * with no conversion in between.
 */
export const zGameBrief = z.object({
  briefVersion: z.literal(BRIEF_SCHEMA_VERSION).default(BRIEF_SCHEMA_VERSION),
  id: zItemId,
  title: zBriefContent.shape.title,
  description: z.string().max(BRIEF_LIMITS.description),
  projectType: z.enum(['2d', '3d']),
  systems: z.array(zBriefSystem).min(1).max(BRIEF_LIMITS.systems),
  scenes: z.array(zBriefScene).min(1).max(BRIEF_LIMITS.scenes),
  assetManifest: z.array(zBriefAsset).max(BRIEF_LIMITS.assets),
  estimatedScope: zBriefContent.shape.estimatedScope,
  styleDirective: zBriefContent.shape.styleDirective,
  feelDirective: zBriefFeelDirective,
  constraints: zBriefContent.shape.constraints.max(BRIEF_LIMITS.constraints),
  completionMode: zBriefContent.shape.completionMode,
  openDecisions: z.array(zOpenDecision).max(BRIEF_LIMITS.openDecisions).optional(),
}).strict();

export type GameBrief = z.infer<typeof zGameBrief>;

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

/**
 * Every code `validateBrief` can report. A runtime list, not only a type, so
 * a test can iterate it and a UI can key copy by it. Stable: a consumer may
 * branch on these, so a code is never renamed, only added.
 */
export const BRIEF_ISSUE_CODES = [
  /** The value does not match the schema (wrong type, unknown enum value, missing field). */
  'SCHEMA',
  /**
   * A string or list is longer than its cap: one of the `BRIEF_LIMITS` caps
   * on the brief, or a leaf cap shared with the provider shape (`title` 200,
   * `referenceGames` 5, the free-text fields' lengths). Every Zod `too_big`
   * maps here.
   */
  'LIMIT_EXCEEDED',
  /** `briefVersion` is one this build does not read. */
  'UNSUPPORTED_VERSION',
  /** A movement system is declared and no entity in any scene has role `player`. */
  'MOVEMENT_WITHOUT_PLAYER',
  /** Two scenes share a name; the plan addresses scenes by name. */
  'DUPLICATE_SCENE_NAME',
  /** A transition's `to` names no scene in the brief. */
  'TRANSITION_TARGET_MISSING',
  /** An asset's `entityRef` names no entity in any scene. */
  'ENTITY_REF_MISSING',
  /** The systems' `dependsOn` graph has a cycle, so they cannot be ordered. */
  'DEPENDENCY_CYCLE',
  /**
   * The completion mode rules out a goal and a declared progression system
   * plans one anyway. Advisory: the plan builder honours the declaration in
   * every mode, so this is the editor's to resolve.
   */
  'COMPLETION_MODE_CONFLICT',
  /**
   * Two items share a brief-local `id`. Ids are the addressing keys #9806
   * consumes as requirement ids, so one id must name exactly one item across
   * systems, scenes, entities, asset needs and open decisions. Brief only:
   * the provider shape carries no ids, so the decomposer never meets it.
   */
  'DUPLICATE_ITEM_ID',
  /** An `openDecisions` entry, reported so it stays visible until resolved. */
  'OPEN_DECISION',
] as const;

export type BriefIssueCode = (typeof BRIEF_ISSUE_CODES)[number];

/**
 * The codes that BREAK A BUILD, and so the only ones the decomposer asks the
 * model to try again on (`zBriefOutput`). Each is a rule `buildPlan` cannot
 * absorb: no player to move (the character_setup step is dropped and the
 * game has nothing to control — the one rule the prompt states), a
 * `dependsOn` cycle (`buildPlan` throws), two scenes with one name
 * (`buildPlan` keys scenes by name, so the second silently replaces the
 * first). Every other error code is advisory: `validateBrief` reports it for
 * the editor, and the AI path accepts the brief (`DUPLICATE_ITEM_ID` could
 * not be here at all — the provider shape has no ids). Widening this list
 * costs the model a retry on a rule it is never told, with a generic hint —
 * see `decomposer.test.ts`, which pins both sides.
 */
export const BUILD_BLOCKING_BRIEF_ISSUE_CODES = [
  'MOVEMENT_WITHOUT_PLAYER',
  'DEPENDENCY_CYCLE',
  'DUPLICATE_SCENE_NAME',
] as const satisfies readonly BriefIssueCode[];

const BUILD_BLOCKING: ReadonlySet<BriefIssueCode> = new Set<BriefIssueCode>(BUILD_BLOCKING_BRIEF_ISSUE_CODES);

export type BriefIssuePath = Array<string | number>;

export interface BriefIssue {
  /** The field the issue is about, as path segments from the brief root; `[]` is the brief itself. */
  path: BriefIssuePath;
  code: BriefIssueCode;
  message: string;
  /** `error` blocks a build; `decision` is a question the author still has to answer. */
  severity: 'error' | 'decision';
}

export interface BriefValidation {
  /**
   * The parsed brief when the SHAPE is valid, including when cross-field
   * checks reported errors — an editor has to be able to hold a brief while
   * the person fixes it. `null` only when the shape itself failed.
   */
  brief: GameBrief | null;
  issues: BriefIssue[];
}

function isBriefIssueCode(value: unknown): value is BriefIssueCode {
  return typeof value === 'string' && (BRIEF_ISSUE_CODES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Cross-field invariants — shared by validateBrief and the decomposer
// ---------------------------------------------------------------------------

/** The fields the invariants read. `BriefContent` and `GameBrief` both satisfy it. */
export interface BriefInvariantInput {
  readonly systems: ReadonlyArray<{
    readonly category: SystemCategory;
    readonly type: string;
    readonly dependsOn: readonly SystemCategory[];
  }>;
  readonly scenes: ReadonlyArray<{
    readonly name: string;
    readonly entities: ReadonlyArray<{ readonly name: string; readonly role: string }>;
    readonly transitions: ReadonlyArray<{ readonly to: string }>;
  }>;
  readonly assetManifest: ReadonlyArray<{ readonly entityRef?: string | undefined }>;
  readonly completionMode?: CompletionMode | undefined;
}

/**
 * Modes that rule out a final goal. The progression system is the only
 * definition that plans a win condition (`systems/progression.ts`), and it
 * does so exactly when `progressionPlansWinCondition` says so — when the
 * world has anything in it. So a brief in one of these modes that also
 * declares progression gets exactly the artificial win the mode exists to
 * refuse, and the conflict is reported only under that same predicate: an
 * empty sandbox with a progression system builds without a goal, and is not
 * a contradiction. `narrative` is not here: it ends through authored
 * progression, which is that system's job.
 *
 * The plan builder does NOT refuse the pairing: a progression system the
 * brief declares is planned in every mode (`planBuilder.ts`, Phase 3b — the
 * builder honours a declaration rather than second-guessing it), which is
 * why the conflict is reported to the editor as the author's call and is
 * not in `BUILD_BLOCKING_BRIEF_ISSUE_CODES`; the decomposer accepts it.
 */
const GOAL_FREE_MODES: ReadonlySet<CompletionMode> = new Set<CompletionMode>(['sandbox', 'endless']);

function error(path: BriefIssuePath, code: BriefIssueCode, message: string): BriefIssue {
  return { path, code, message, severity: 'error' };
}

/**
 * The cross-field checks no JSON Schema can express, run on a brief or on
 * the content shape the model returns. Pure, and indexed loops throughout: a
 * callback form skips an array hole, and a skipped scene is a skipped check.
 *
 * Order is fixed so issue lists are stable across runs: movement, scene
 * names, transitions, asset refs, dependency cycle, mode conflict.
 */
export function checkBriefInvariants(brief: BriefInvariantInput): BriefIssue[] {
  const issues: BriefIssue[] = [];
  const { systems, scenes, assetManifest } = brief;

  // A movement system needs something to move. `role` and `category` are each
  // valid in isolation, so nothing below this point can tell that the design is
  // internally nonsense: the plan builder drops the character_setup step and
  // warns, and the user gets a game where the thing they asked to move does not
  // exist (PF-1113).
  let hasMovement = false;
  for (let i = 0; i < systems.length; i += 1) {
    if (systems[i]?.category === 'movement') {
      hasMovement = true;
      break;
    }
  }
  if (hasMovement) {
    let hasPlayer = false;
    for (let i = 0; i < scenes.length && !hasPlayer; i += 1) {
      const entities = scenes[i]?.entities ?? [];
      for (let j = 0; j < entities.length; j += 1) {
        if (entities[j]?.role === 'player') {
          hasPlayer = true;
          break;
        }
      }
    }
    if (!hasPlayer) {
      issues.push(error(
        ['scenes'],
        'MOVEMENT_WITHOUT_PLAYER',
        'a movement system was declared but no entity in any scene has role "player" — add a player entity or drop the movement system',
      ));
    }
  }

  // Scene names are how the plan addresses scenes (`buildPlan` keys its step
  // ids by name), so a second scene with the same name silently replaces the
  // first. The later scene is the one reported: the first keeps its name.
  const firstSceneIndexByName = new Map<string, number>();
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    if (!scene) continue;
    const first = firstSceneIndexByName.get(scene.name);
    if (first !== undefined) {
      issues.push(error(
        ['scenes', i, 'name'],
        'DUPLICATE_SCENE_NAME',
        `scene "${scene.name}" has the same name as scene ${first} — every scene needs its own name`,
      ));
    } else {
      firstSceneIndexByName.set(scene.name, i);
    }
  }

  for (let i = 0; i < scenes.length; i += 1) {
    const transitions = scenes[i]?.transitions ?? [];
    for (let j = 0; j < transitions.length; j += 1) {
      const transition = transitions[j];
      if (!transition || firstSceneIndexByName.has(transition.to)) continue;
      issues.push(error(
        ['scenes', i, 'transitions', j, 'to'],
        'TRANSITION_TARGET_MISSING',
        `transition to "${transition.to}" names a scene the brief does not have`,
      ));
    }
  }

  const entityNames = new Set<string>();
  // Every entity in every scene, in declaration order: the list `planBuilder`
  // (Phase 2) hands each system definition as `ctx.entities`, so the
  // progression precondition below is asked the question the planner asks.
  const worldEntities: Array<{ readonly name: string; readonly role: string }> = [];
  for (let i = 0; i < scenes.length; i += 1) {
    const entities = scenes[i]?.entities ?? [];
    for (let j = 0; j < entities.length; j += 1) {
      const entity = entities[j];
      if (!entity) continue;
      entityNames.add(entity.name);
      worldEntities.push(entity);
    }
  }
  for (let i = 0; i < assetManifest.length; i += 1) {
    const asset = assetManifest[i];
    if (!asset || asset.entityRef === undefined || entityNames.has(asset.entityRef)) continue;
    issues.push(error(
      ['assetManifest', i, 'entityRef'],
      'ENTITY_REF_MISSING',
      `asset entityRef "${asset.entityRef}" names no entity in any scene`,
    ));
  }

  // The SAME detector `buildPlan` throws on (`systemDependencies.ts`), so the
  // two cannot disagree about what a cycle is. Reported on the `dependsOn`
  // entry that closes the cycle (the path's LAST edge — see `cycleEdgePath`),
  // so an editor can focus it.
  const cycle = findSystemDependencyCycle(systems);
  if (cycle) {
    issues.push(error(
      cycleEdgePath(systems, cycle),
      'DEPENDENCY_CYCLE',
      `system dependencies form a cycle: ${formatDependencyCycle(cycle)} — no order can satisfy them`,
    ));
  }

  // Only where progression would actually plan the goal (`systems/progression.ts`
  // drops every step for an empty world — the SAME predicate, so the two
  // cannot drift): a goal-free brief with no entities builds without a win
  // condition however many progression systems it declares.
  const mode = brief.completionMode;
  if (mode !== undefined && GOAL_FREE_MODES.has(mode) && progressionPlansWinCondition(worldEntities)) {
    for (let i = 0; i < systems.length; i += 1) {
      const system = systems[i];
      if (!system || system.category !== 'progression') continue;
      issues.push(error(
        ['systems', i],
        'COMPLETION_MODE_CONFLICT',
        `completionMode "${mode}" means the game has no final goal, but this progression system ("${system.type}") plans a win condition — remove the system or choose a mode with a goal`,
      ));
    }
  }

  return issues;
}

/**
 * The `dependsOn` entry that CLOSES `cycle`: its last edge, from the last
 * distinct node back to the first. `findSystemDependencyCycle` returns the
 * path as the walk found it, and the walk stops on the edge that leads back
 * to a category already on its stack — so the last edge is the one that
 * turned a chain into a loop, and the one an editor should focus. The first
 * edge (`cycle[0] -> cycle[1]`) would name the system the walk happened to
 * start from, which for a long cycle is a different system entirely
 * (`briefSchema.test.ts` pins the difference on a three-node cycle). For a
 * self-dependency the two coincide.
 */
function cycleEdgePath(
  systems: BriefInvariantInput['systems'],
  cycle: readonly SystemCategory[],
): BriefIssuePath {
  const from = cycle[cycle.length - 2];
  const to = cycle[cycle.length - 1];
  if (from === undefined || to === undefined) return ['systems'];
  for (let i = 0; i < systems.length; i += 1) {
    const system = systems[i];
    if (!system || system.category !== from) continue;
    const j = system.dependsOn.indexOf(to);
    if (j >= 0) return ['systems', i, 'dependsOn', j];
  }
  return ['systems'];
}

// ---------------------------------------------------------------------------
// Brief-only checks — fields the provider shape does not have
// ---------------------------------------------------------------------------

/**
 * Every brief-local `id` names exactly one item. Systems, scenes, entities,
 * asset needs and open decisions share ONE namespace, because #9806 consumes
 * the ids as requirement ids and a requirement that names two items names
 * neither. Walked in document order — systems, then each scene and its
 * entities, then asset needs, then open decisions — and the LATER use is the
 * one reported, so the first keeps its id (the choice `DUPLICATE_SCENE_NAME`
 * makes too). An item with no id is not in the namespace, and the brief's own
 * `id` names the brief, not an item in it.
 *
 * `validateBrief` only, and not a candidate for `BUILD_BLOCKING_BRIEF_ISSUE_CODES`:
 * `zBriefContent` carries no ids, so the decomposer's `zBriefOutput` has
 * nothing to check here.
 */
function checkItemIds(brief: GameBrief): BriefIssue[] {
  const issues: BriefIssue[] = [];
  const firstUseOf = new Map<string, BriefIssuePath>();

  const claim = (id: string | undefined, item: BriefIssuePath): void => {
    if (id === undefined) return;
    const first = firstUseOf.get(id);
    if (first === undefined) {
      firstUseOf.set(id, item);
      return;
    }
    issues.push(error(
      [...item, 'id'],
      'DUPLICATE_ITEM_ID',
      `id "${id}" is already used by ${fieldLabel(first)} — every item id must name exactly one item`,
    ));
  };

  const { systems, scenes, assetManifest } = brief;
  for (let i = 0; i < systems.length; i += 1) claim(systems[i]?.id, ['systems', i]);
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    if (!scene) continue;
    claim(scene.id, ['scenes', i]);
    for (let j = 0; j < scene.entities.length; j += 1) {
      claim(scene.entities[j]?.id, ['scenes', i, 'entities', j]);
    }
  }
  for (let i = 0; i < assetManifest.length; i += 1) claim(assetManifest[i]?.id, ['assetManifest', i]);
  const decisions = brief.openDecisions ?? [];
  for (let i = 0; i < decisions.length; i += 1) claim(decisions[i]?.id, ['openDecisions', i]);

  return issues;
}

// ---------------------------------------------------------------------------
// The decomposer's refined shape
// ---------------------------------------------------------------------------

/** The `params` key a Zod custom issue raised by `zBriefOutput` carries its `BriefIssueCode` under. */
export const BRIEF_CODE_PARAM = 'briefCode';

/**
 * `zBriefContent` plus the BUILD-BLOCKING shared invariants, for the
 * decomposer's local re-validation of the model's object. The provider
 * enforced the shape; this adds what JSON Schema cannot say and the plan
 * builder cannot absorb. Each such failure becomes a Zod custom issue at the
 * same path `validateBrief` would report, with the code in `params` so the
 * decomposer's error can name it. The advisory codes are computed and
 * dropped here, so the two paths share one check and differ only in the
 * filter (`BUILD_BLOCKING_BRIEF_ISSUE_CODES`).
 */
export const zBriefOutput = zBriefContent.superRefine((content, ctx) => {
  const issues = checkBriefInvariants(content);
  for (let i = 0; i < issues.length; i += 1) {
    const issue = issues[i];
    if (!issue || !BUILD_BLOCKING.has(issue.code)) continue;
    ctx.addIssue({
      code: 'custom',
      path: [...issue.path],
      message: issue.message,
      params: { [BRIEF_CODE_PARAM]: issue.code },
    });
  }
});

export type BriefOutput = z.infer<typeof zBriefOutput>;

/** The `BriefIssueCode` a Zod issue from `zBriefOutput` carries, if it is one. */
export function briefCodeOf(issue: {
  readonly code: string;
  readonly params?: Record<string, unknown> | undefined;
}): BriefIssueCode | undefined {
  if (issue.code !== 'custom') return undefined;
  const code = issue.params?.[BRIEF_CODE_PARAM];
  return isBriefIssueCode(code) ? code : undefined;
}

// ---------------------------------------------------------------------------
// validateBrief
// ---------------------------------------------------------------------------

function toPath(path: readonly PropertyKey[]): BriefIssuePath {
  const segments: BriefIssuePath = [];
  for (let i = 0; i < path.length; i += 1) {
    const segment = path[i];
    if (typeof segment === 'string' || typeof segment === 'number') segments.push(segment);
  }
  return segments;
}

function fieldLabel(path: BriefIssuePath): string {
  return path.length === 0 ? 'the brief' : path.join('.');
}

/**
 * A Zod shape issue as `BriefIssue`s with stable codes. One in, one out —
 * except `unrecognized_keys`, which Zod raises ONCE per object naming every
 * unknown key on it, and which comes out as one `SCHEMA` issue PER key, on
 * that key's own path (`['scenes', 0, 'purpos']`, not `['scenes', 0]`), so an
 * editor can focus the field the author actually typed.
 */
function fromZodIssue(issue: z.core.$ZodIssue): BriefIssue[] {
  const path = toPath(issue.path);
  if (issue.code === 'unrecognized_keys') {
    const issues: BriefIssue[] = [];
    for (let i = 0; i < issue.keys.length; i += 1) {
      const key = issue.keys[i];
      if (key === undefined) continue;
      const keyPath = [...path, key];
      issues.push(error(
        keyPath,
        'SCHEMA',
        `${fieldLabel(keyPath)}: the brief has no field "${key}" here — remove it or fix its spelling`,
      ));
    }
    return issues;
  }
  if (path[0] === 'briefVersion') {
    return [error(
      path,
      'UNSUPPORTED_VERSION',
      `briefVersion must be ${BRIEF_SCHEMA_VERSION}; this build cannot read any other version`,
    )];
  }
  if (issue.code === 'too_big') {
    const unit = issue.origin === 'array' ? 'items' : 'characters';
    return [error(
      path,
      'LIMIT_EXCEEDED',
      `${fieldLabel(path)} is over the limit of ${String(issue.maximum)} ${unit}`,
    )];
  }
  return [error(path, 'SCHEMA', `${fieldLabel(path)}: ${issue.message}`)];
}

/**
 * Validate anything as a game brief. Never throws.
 *
 * Shape first: a value that is not a brief gets `SCHEMA`, `LIMIT_EXCEEDED` or
 * `UNSUPPORTED_VERSION` issues on the exact fields and `brief: null`. Then
 * the cross-field invariants, reported alongside the parsed brief so an
 * editor can keep it; then the brief-only id check; and each `openDecisions`
 * entry as a `decision` issue.
 */
export function validateBrief(input: unknown): BriefValidation {
  // One try/catch over the whole read, not only the shape parse: the cycle
  // detector once threw a RangeError on an oversized `dependsOn` from
  // OUTSIDE the catch, and "never throws" has to hold for every step.
  try {
    const parsed = zGameBrief.safeParse(input);

    if (!parsed.success) {
      const issues: BriefIssue[] = [];
      for (let i = 0; i < parsed.error.issues.length; i += 1) {
        const issue = parsed.error.issues[i];
        if (!issue) continue;
        // Indexed, not `push(...spread)`: an `unrecognized_keys` issue carries
        // one entry per unknown key, and the key count is the caller's.
        const converted = fromZodIssue(issue);
        for (let j = 0; j < converted.length; j += 1) {
          const item = converted[j];
          if (item) issues.push(item);
        }
      }
      return { brief: null, issues };
    }

    const brief = parsed.data;
    const issues = checkBriefInvariants(brief);

    // The shared checks never see ids; this one is the brief's alone.
    const idIssues = checkItemIds(brief);
    for (let i = 0; i < idIssues.length; i += 1) {
      const issue = idIssues[i];
      if (issue) issues.push(issue);
    }

    const decisions = brief.openDecisions ?? [];
    for (let i = 0; i < decisions.length; i += 1) {
      const decision = decisions[i];
      if (!decision) continue;
      issues.push({
        path: ['openDecisions', i],
        code: 'OPEN_DECISION',
        severity: 'decision',
        message: `open decision about ${decision.path}: ${decision.question}`,
      });
    }

    return { brief, issues };
  } catch {
    // Reading the value threw (a hostile getter, say), or a check did. Still
    // an answer, not an exception.
    return { brief: null, issues: [error([], 'SCHEMA', 'the brief could not be read')] };
  }
}
