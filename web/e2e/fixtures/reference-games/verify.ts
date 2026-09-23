/**
 * Holds each reference game to its expected-state record (#10159).
 *
 * Node-only (it hashes with `node:crypto`), so it is imported by the vitest
 * suite and never by the Playwright spec, which needs only the record itself.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { GameComponentData } from '@/stores/slices/types';
import {
  canonicalContent,
  type ExpectedInputAction,
  type ReferenceGame,
  type ReferenceGameExpectedState,
} from './referenceGame';

/** The facts a record states, i.e. everything except its version pins. */
type DerivedFacts = Omit<ReferenceGameExpectedState, 'fixtureId' | 'version' | 'contentDigest'>;

/** `sha256:<hex>` over `canonicalContent(game)`. */
export function contentDigest(game: ReferenceGame): string {
  return `sha256:${createHash('sha256').update(canonicalContent(game)).digest('hex')}`;
}

/** The single entity carrying a component of `type`; throws unless exactly one does. */
function soleEntityWith(game: ReferenceGame, type: GameComponentData['type']): string {
  const ids = game.entities.filter((e) => e.gameComponents.some((c) => c.type === type)).map((e) => e.id);
  if (ids.length !== 1) {
    throw new Error(`expected exactly one entity with a ${type} component, found ${ids.length} (${ids.join(', ')})`);
  }
  return ids[0];
}

function componentOf<T extends GameComponentData['type']>(
  game: ReferenceGame,
  entityId: string,
  type: T,
): Extract<GameComponentData, { type: T }> {
  const entity = game.entities.find((e) => e.id === entityId);
  const component = entity?.gameComponents.find((c) => c.type === type);
  if (!component) throw new Error(`entity "${entityId}" has no ${type} component`);
  return component as Extract<GameComponentData, { type: T }>;
}

/**
 * Re-derive, from the fixture alone, every fact its expected-state record
 * states. Throws with a readable reason when the fixture does not have the
 * shape a reference game needs (one player, one win condition, a damage zone).
 */
export function deriveExpectedState(game: ReferenceGame): Omit<ReferenceGameExpectedState, 'contentDigest'> {
  const entities: ReferenceGameExpectedState['entities'] = {};
  for (const entity of game.entities) {
    entities[entity.id] = {
      name: entity.name,
      entityType: entity.entityType,
      physics: entity.physics ? entity.physics.dimension : null,
      gameComponents: entity.gameComponents.map((c) => c.type).sort(),
    };
  }

  const inputActions: Record<string, ExpectedInputAction> = {};
  for (const binding of game.inputBindings) {
    inputActions[binding.actionName] =
      binding.actionType === 'axis'
        ? { type: 'axis', positive: [...(binding.positiveKeys ?? [])], negative: [...(binding.negativeKeys ?? [])] }
        : { type: 'digital', sources: [...binding.sources] };
  }

  const winEntityId = soleEntityWith(game, 'winCondition');
  if (winEntityId !== game.winConditionEntityId) {
    throw new Error(
      `winConditionEntityId is "${game.winConditionEntityId}" but the win condition is on "${winEntityId}"`,
    );
  }
  const winCondition = componentOf(game, winEntityId, 'winCondition').winCondition;
  const playerEntityId = soleEntityWith(game, 'characterController');
  const health = componentOf(game, playerEntityId, 'health').health;

  const damageZoneEntityIds = game.entities
    .filter((e) => e.gameComponents.some((c) => c.type === 'damageZone'))
    .map((e) => e.id);
  if (damageZoneEntityIds.length === 0) throw new Error('the game has no damage zone, so it has no lose path');
  const oneShots = new Set(damageZoneEntityIds.map((id) => componentOf(game, id, 'damageZone').damageZone.oneShot));
  if (oneShots.size !== 1) throw new Error('damage zones disagree on oneShot; the lose record cannot state one value');

  return {
    fixtureId: game.fixtureId,
    version: game.version,
    entities,
    inputActions,
    win: {
      entityId: winEntityId,
      conditionType: winCondition.conditionType,
      targetEntityId: winCondition.targetEntityId,
      playerEntityId,
      collectibleEntityIds: game.entities
        .filter((e) => e.gameComponents.some((c) => c.type === 'collectible'))
        .map((e) => e.id),
    },
    lose: {
      playerEntityId,
      maxHp: health.maxHp,
      respawnOnDeath: health.respawnOnDeath,
      despawnOnDeath: health.despawnOnDeath,
      respawnPoint: [...health.respawnPoint],
      damageZoneEntityIds,
      oneShot: [...oneShots][0],
    },
  };
}

function factsOf(state: Omit<ReferenceGameExpectedState, 'contentDigest'>): DerivedFacts {
  const { fixtureId: _fixtureId, version: _version, ...facts } = state;
  return facts;
}

/**
 * Every way the record fails to describe the fixture, as readable lines. Empty
 * means the pair is consistent. Each line starts with the field at fault, so a
 * test can pin the REASON a pair was refused and not merely that it was.
 */
export function expectedStateProblems(game: ReferenceGame, expected: ReferenceGameExpectedState): string[] {
  const problems: string[] = [];
  if (expected.fixtureId !== game.fixtureId) {
    problems.push(`fixtureId: fixture is "${game.fixtureId}" but its expected-state record is for "${expected.fixtureId}"`);
  }
  if (expected.version !== game.version) {
    problems.push(`version: fixture is ${game.version} but its expected-state record is for ${expected.version}`);
  }
  const digest = contentDigest(game);
  if (digest !== expected.contentDigest) {
    problems.push(
      `contentDigest: fixture content hashes to ${digest} but the record pins ${expected.contentDigest}. ` +
        'A content change is a new version: bump `version` and update the expected-state record.',
    );
  }
  let derived: DerivedFacts;
  try {
    derived = factsOf(deriveExpectedState(game));
  } catch (error) {
    problems.push(`derived state: ${(error as Error).message}`);
    return problems;
  }
  const { contentDigest: _digest, ...recorded } = expected;
  const stated = factsOf(recorded);
  if (!isDeepStrictEqual(derived, stated)) {
    problems.push(
      `derived state: the record disagrees with the fixture.\n  fixture says: ${JSON.stringify(derived)}\n  record says:  ${JSON.stringify(stated)}`,
    );
  }
  return problems;
}
