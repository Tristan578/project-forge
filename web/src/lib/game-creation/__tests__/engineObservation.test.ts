import { afterEach, describe, it, expect } from 'vitest';
import {
  recordEntityObservation,
  readEntityObservation,
  clearEntityObservations,
} from '../engineObservation';

/**
 * The JS side of the confirmed-effect round trip (#9899). The engine answers a
 * `get_entity_details` query on the `QUERY_ENTITY_DETAILS` event; this cache is
 * where that answer lands so `observeEntity` can read the engine's REAL state.
 */

afterEach(() => {
  clearEntityObservations();
});

const DETAILS = {
  entityId: 'crate-1',
  name: 'Crate',
  position: [1, 2, 3],
  rotation: [0, 90, 0],
  scale: [1, 1, 1],
};

describe('engineObservation', () => {
  it('records a QUERY_ENTITY_DETAILS payload and reads back its transform', () => {
    recordEntityObservation(DETAILS);
    expect(readEntityObservation('crate-1')).toEqual({
      entityId: 'crate-1',
      transform: { position: [1, 2, 3], rotation: [0, 90, 0], scale: [1, 1, 1] },
    });
  });

  it('returns undefined for an entity that was never observed', () => {
    // A miss IS the "does not exist yet" answer — the engine emits nothing for
    // an entity it cannot find, so the negative case never records anything.
    expect(readEntityObservation('ghost-1')).toBeUndefined();
  });

  it('keeps the latest observation when an entity is re-queried', () => {
    recordEntityObservation(DETAILS);
    recordEntityObservation({ ...DETAILS, position: [4, 5, 6] });
    expect(readEntityObservation('crate-1')?.transform?.position).toEqual([4, 5, 6]);
  });

  it('records existence with no transform when the payload omits a usable vector', () => {
    // Existence still counts (the entity was found) even if a coordinate is
    // malformed — but a half-parsed transform is dropped rather than compared
    // against a coordinate the engine never sent.
    recordEntityObservation({ entityId: 'crate-1', position: [1, 2], rotation: [0, 0, 0], scale: [1, 1, 1] });
    const observed = readEntityObservation('crate-1');
    expect(observed).toEqual({ entityId: 'crate-1' });
    expect(observed?.transform).toBeUndefined();
  });

  it('drops a payload with no usable entity id rather than caching under undefined', () => {
    recordEntityObservation({ position: [1, 2, 3] });
    recordEntityObservation({ entityId: '' });
    recordEntityObservation(null);
    expect(readEntityObservation('crate-1')).toBeUndefined();
  });

  it('rejects a non-finite coordinate as no transform', () => {
    recordEntityObservation({ entityId: 'crate-1', position: [1, Number.NaN, 3], rotation: [0, 0, 0], scale: [1, 1, 1] });
    expect(readEntityObservation('crate-1')?.transform).toBeUndefined();
  });

  it('clears every observation', () => {
    recordEntityObservation(DETAILS);
    clearEntityObservations();
    expect(readEntityObservation('crate-1')).toBeUndefined();
  });
});
