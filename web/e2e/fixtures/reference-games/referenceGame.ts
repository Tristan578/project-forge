/**
 * Shared shape of the versioned reference games (#10159).
 *
 * A reference game is a small, authored, VERSIONED game with known win and lose
 * mechanics. Every release journey that exercises one exercises the same bytes,
 * so a changed outcome points at a regression rather than at a different test
 * scene. The two games here are the 2D and 3D members of the `qa-score3-v1`
 * fixture set that #9878 names; #9878 adds the third (sandbox) member.
 *
 * Everything in this module is plain data plus pure helpers. It deliberately
 * imports only TYPES from `@/`: the Playwright spec imports it too, and a
 * runtime import from the app bundle would drag editor code into the test
 * runner.
 *
 * Entity ids in a fixture (`'player'`, `'goal'`, ...) are FIXTURE-LOCAL. The
 * engine mints its own ids at spawn time, so any component field that names
 * another entity is written with the fixture id and translated by
 * `resolveEntityRefs` — with the identity map for the winnability suite, and
 * with the spawned ids in the engine spec. One translation, two callers.
 */
import type {
  CompletionMode,
  EntityType,
  GameComponentData,
  InputBinding,
  Physics2dData,
  PhysicsData,
  ProjectType,
  SceneGraph,
  WinConditionType,
} from '@/stores/slices/types';

/** The #9878 fixture set these games belong to. */
export const REFERENCE_GAME_SET = 'qa-score3-v1';

/** Issue #10159's size bound: "about 10 entities or fewer". */
export const MAX_REFERENCE_GAME_ENTITIES = 10;

/** Physics for one entity, tagged by which simulation owns it. */
export type ReferenceEntityPhysics =
  | { dimension: '2d'; data: Physics2dData }
  | { dimension: '3d'; data: PhysicsData };

export interface ReferenceEntity {
  /** Fixture-local id. Stable across versions; never an engine id. */
  id: string;
  /** Display name. Unique within the game, so the engine's graph can be read by name. */
  name: string;
  /** Must be a `spawn_entity` type (`SPAWNABLE_ENTITY_TYPES`). */
  entityType: EntityType;
  position: [number, number, number];
  scale: [number, number, number];
  physics: ReferenceEntityPhysics | null;
  /** Store-shaped components; entity references use fixture ids. */
  gameComponents: GameComponentData[];
}

export interface ReferenceGame {
  set: typeof REFERENCE_GAME_SET;
  /** Which member of the set this is. Equal to `projectType` by construction. */
  member: '2d' | '3d';
  /** `qa-score3-v1/<name>`. Also the `fixtureId` an input trace records against. */
  fixtureId: string;
  /** Bumped on ANY content change, together with the expected-state record. */
  version: number;
  description: string;
  projectType: ProjectType;
  /** The pre-play gate honours this; both games are goal-driven. */
  completionMode: CompletionMode;
  inputBindings: InputBinding[];
  entities: ReferenceEntity[];
  /** Fixture id of the one entity carrying the `winCondition` component. */
  winConditionEntityId: string;
}

/** What the engine must hold for one entity once the game is applied. */
export interface ExpectedEntityState {
  name: string;
  entityType: EntityType;
  physics: '2d' | '3d' | null;
  /** Store component discriminants, sorted. The engine serializes the same names. */
  gameComponents: GameComponentData['type'][];
}

/** One input action as the engine's `InputMap` should hold it. */
export type ExpectedInputAction =
  | { type: 'digital'; sources: string[] }
  | { type: 'axis'; positive: string[]; negative: string[] };

/**
 * The independent oracle for a reference game.
 *
 * Hand-written next to each fixture, never computed from it: the engine spec
 * reads its assertions off THIS record, and `verify.ts` re-derives every field
 * from the fixture so the two cannot drift apart silently.
 */
export interface ReferenceGameExpectedState {
  fixtureId: string;
  /** Must equal the fixture's `version`. */
  version: number;
  /** `sha256:<hex>` over the fixture's content (`canonicalContent`). */
  contentDigest: string;
  /** Keyed by fixture entity id. */
  entities: Record<string, ExpectedEntityState>;
  /** Keyed by action name. */
  inputActions: Record<string, ExpectedInputAction>;
  win: {
    entityId: string;
    conditionType: WinConditionType;
    /** Fixture id of the goal for `reachGoal`, else null. */
    targetEntityId: string | null;
    playerEntityId: string;
    collectibleEntityIds: string[];
  };
  /**
   * There is no first-class lost state in the engine (#10159). "Lose" is the
   * player's HP reaching 0 inside a damage zone, after which `system_health`
   * moves it to `respawnPoint` and refills HP.
   */
  lose: {
    playerEntityId: string;
    maxHp: number;
    respawnOnDeath: boolean;
    despawnOnDeath: boolean;
    respawnPoint: [number, number, number];
    damageZoneEntityIds: string[];
    oneShot: boolean;
  };
}

/** A fixture paired with its expected-state record. */
export interface ReferenceGameEntry {
  game: ReferenceGame;
  expected: ReferenceGameExpectedState;
}

/**
 * Translate every entity reference inside a component from fixture ids to the
 * ids `idFor` returns. Today the only reference-bearing field in use is
 * `winCondition.targetEntityId`. An id `idFor` cannot resolve throws: a
 * reference to an entity that is not in the game is a broken fixture, and
 * passing it through would make the engine hold a dangling goal.
 */
export function resolveEntityRefs(
  component: GameComponentData,
  idFor: (fixtureEntityId: string) => string | undefined,
): GameComponentData {
  if (component.type !== 'winCondition' || component.winCondition.targetEntityId === null) {
    return component;
  }
  const target = component.winCondition.targetEntityId;
  const resolved = idFor(target);
  if (resolved === undefined) {
    throw new Error(`winCondition.targetEntityId "${target}" names no entity in this game`);
  }
  return { type: 'winCondition', winCondition: { ...component.winCondition, targetEntityId: resolved } };
}

/**
 * The inputs `validateWinnability` reads, keyed by fixture entity id — the same
 * shape the store holds after the engine has built the game, minus the runtime
 * ids.
 */
export function toValidatorInput(game: ReferenceGame): {
  sceneGraph: SceneGraph;
  allGameComponents: Record<string, GameComponentData[]>;
} {
  const ids = new Set(game.entities.map((e) => e.id));
  const idFor = (id: string) => (ids.has(id) ? id : undefined);
  const nodes: SceneGraph['nodes'] = {};
  const allGameComponents: Record<string, GameComponentData[]> = {};
  for (const entity of game.entities) {
    nodes[entity.id] = {
      entityId: entity.id,
      name: entity.name,
      parentId: null,
      children: [],
      components: entity.gameComponents.length > 0 ? ['GameComponents'] : [],
      visible: true,
    };
    allGameComponents[entity.id] = entity.gameComponents.map((c) => resolveEntityRefs(c, idFor));
  }
  return {
    sceneGraph: { nodes, rootIds: game.entities.map((e) => e.id), completionMode: game.completionMode },
    allGameComponents,
  };
}

/** A copy of the game with one entity removed (the negative winnability case). */
export function withoutEntity(game: ReferenceGame, entityId: string): ReferenceGame {
  return { ...game, entities: game.entities.filter((e) => e.id !== entityId) };
}

/** Recursively key-sorted JSON, so the digest does not depend on key order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The content a version identifies: everything except `version` itself and the
 * prose `description`. A change here without a version bump is what the
 * expected-state digest exists to catch.
 */
export function canonicalContent(game: ReferenceGame): string {
  const { version: _version, description: _description, ...content } = game;
  return canonicalJson(content);
}
