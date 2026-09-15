/**
 * Confirmed spawn/transform observation cache (#9899, op family ai.FR-1.OP-01).
 *
 * The orchestrator confirms a deferred spawn or transform by QUERYING the real
 * engine after the command applies, rather than trusting that the dispatcher
 * accepted it plus two animation frames (which proves neither existence nor a
 * transform value — see the note on `waitForEngineFrame`). The query is the
 * engine's existing `get_entity_details` command; its answer arrives
 * asynchronously on the `QUERY_ENTITY_DETAILS` event a frame later
 * (engine/src/bridge/query.rs).
 *
 * This module is the JS side of that round trip: the event handler records each
 * answer here keyed by entity id, and `observeEntity` (wired into
 * `ExecutorContext` by the orchestrator) reads the latest one back. The engine
 * emits `QUERY_ENTITY_DETAILS` ONLY when the entity exists, so a cache miss is
 * itself the "does not exist yet" answer — there is no null-transform sentinel
 * to disambiguate, which is exactly why the negative (`timed-out`) case works:
 * a dropped effect simply never records anything to read.
 *
 * The cache is a plain module singleton, not a store slice. It is transient
 * correlation state consumed within one observation window, never rendered and
 * never persisted; putting it in Zustand would add a reducer, a selector and a
 * re-render for data no component reads.
 */

import type { ObservedEntity } from './types';

const observations = new Map<string, ObservedEntity>();

/**
 * The shape the engine puts on the `QUERY_ENTITY_DETAILS` event
 * (`#[serde(rename_all = "camelCase")]` in bridge/query.rs). Only the fields
 * this module reads are named; everything else on the payload is ignored.
 */
interface EntityDetailsPayload {
  entityId?: unknown;
  position?: unknown;
  rotation?: unknown;
  scale?: unknown;
}

function asVec3(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const [x, y, z] = value;
  if (
    typeof x !== 'number' || !Number.isFinite(x)
    || typeof y !== 'number' || !Number.isFinite(y)
    || typeof z !== 'number' || !Number.isFinite(z)
  ) {
    return undefined;
  }
  return [x, y, z];
}

/**
 * Record one `QUERY_ENTITY_DETAILS` answer. A payload with no usable entity id
 * is dropped rather than cached under `undefined`, where a later lookup for a
 * real id could never find it but a lookup for the wrong thing might.
 */
export function recordEntityObservation(payload: unknown): void {
  const data = (payload ?? {}) as EntityDetailsPayload;
  const entityId = data.entityId;
  if (typeof entityId !== 'string' || entityId.length === 0) return;

  const position = asVec3(data.position);
  const rotation = asVec3(data.rotation);
  const scale = asVec3(data.scale);

  observations.set(entityId, {
    entityId,
    // All three or none: a half-parsed transform would let a `satisfied`
    // predicate compare against a coordinate the engine never actually sent.
    ...(position && rotation && scale
      ? { transform: { position, rotation, scale } }
      : {}),
  });
}

/** The most recently observed snapshot for `entityId`, or `undefined`. */
export function readEntityObservation(entityId: string): ObservedEntity | undefined {
  return observations.get(entityId);
}

/**
 * Drop every cached observation. The orchestrator calls this at the start of a
 * pipeline run so a stale snapshot from an earlier run — or an earlier,
 * cancelled operation on the same id — can never satisfy a fresh observation.
 */
export function clearEntityObservations(): void {
  observations.clear();
}
