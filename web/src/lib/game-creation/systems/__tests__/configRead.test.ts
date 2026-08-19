/**
 * Tests for the shared `system.config` readers.
 *
 * These functions are the seam every system definition passes LLM-authored
 * config through, so their failure modes are silent by construction: a name
 * that resolves to nothing plans a step bound to nothing, and `dispatchCommand`
 * returns void, so the design simply does not happen. Three properties are
 * asserted directly rather than assumed:
 *
 *  - a prototype-chain key is not a design decision (`config['constructor']`
 *    resolves to a function through a bare index);
 *  - an array hole is not skipped, because the callback forms that skip holes
 *    report a sparse list as fully processed;
 *  - "absent" and "explicitly false" stay distinguishable, which is the only
 *    thing that makes a default-on behaviour opt-out-able.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  normalize,
  readNameList,
  readPositiveNumber,
  readOptionalBoolean,
  readBoolean,
  indexByName,
  resolveNames,
} from '../configRead';
import type { PlannedEntity } from '../registry';

function planned(entityId: string, name: string): PlannedEntity {
  return {
    entityId,
    scene: 'Level1',
    entity: { name, role: 'decoration', systems: [], appearance: 'primitive:cube' },
  };
}

describe('normalize', () => {
  it('erases the casing and punctuation an LLM varies freely', () => {
    expect(normalize('Slime Pit')).toBe('slimepit');
    expect(normalize('slime-pit')).toBe('slimepit');
    expect(normalize('  SLIME_PIT!  ')).toBe('slimepit');
  });
});

describe('readNameList', () => {
  it('reads a real array', () => {
    expect(readNameList({ hazards: ['Lava', 'Spikes'] }, ['hazards'])).toEqual(['Lava', 'Spikes']);
  });

  it('reads the comma-separated string spelling of the same field', () => {
    expect(readNameList({ hazards: 'Lava, Spikes' }, ['hazards'])).toEqual(['Lava', 'Spikes']);
  });

  it('takes the first key that carries anything, so an empty one does not win', () => {
    expect(readNameList({ hazards: [], traps: ['Spikes'] }, ['hazards', 'traps'])).toEqual([
      'Spikes',
    ]);
  });

  it('SKIPS a hole rather than reporting the list fully read', () => {
    // A hole is what an omitted element becomes, and it degrades into a null on
    // the first JSON round trip. `.filter`/`.map` skip holes silently.
    const sparse = ['Lava'];
    sparse[2] = 'Spikes';

    expect(readNameList({ hazards: sparse }, ['hazards'])).toEqual(['Lava', 'Spikes']);
  });

  it('ignores a non-string member rather than coercing it', () => {
    // `String({})` is "[object Object]", which resolves to nothing and would
    // warn about a name nobody wrote.
    expect(readNameList({ hazards: ['Lava', {}, 7, null] }, ['hazards'])).toEqual(['Lava']);
  });

  it('does not read a key off the prototype chain', () => {
    expect(readNameList({}, ['constructor', 'toString'])).toEqual([]);
  });

  it('answers empty for a missing key', () => {
    expect(readNameList({ other: ['Lava'] }, ['hazards'])).toEqual([]);
  });
});

describe('readPositiveNumber', () => {
  it('reads the first key carrying a positive finite number', () => {
    expect(readPositiveNumber({ speed: 4 }, ['speed'])).toBe(4);
  });

  it('REFUSES zero, a negative, a non-finite and a numeric string', () => {
    expect(readPositiveNumber({ speed: 0 }, ['speed'])).toBeNull();
    expect(readPositiveNumber({ speed: -1 }, ['speed'])).toBeNull();
    expect(readPositiveNumber({ speed: Number.POSITIVE_INFINITY }, ['speed'])).toBeNull();
    expect(readPositiveNumber({ speed: Number.NaN }, ['speed'])).toBeNull();
    expect(readPositiveNumber({ speed: '4' }, ['speed'])).toBeNull();
  });

  it('does not read a key off the prototype chain', () => {
    expect(readPositiveNumber({}, ['constructor'])).toBeNull();
  });
});

describe('readOptionalBoolean', () => {
  it('keeps absent and explicitly false apart', () => {
    // This distinction is the whole reason the function exists: a default-on
    // behaviour cannot be opted out of if `?? false` erases it.
    expect(readOptionalBoolean({}, ['chasePlayer'])).toBeNull();
    expect(readOptionalBoolean({ chasePlayer: false }, ['chasePlayer'])).toBe(false);
    expect(readOptionalBoolean({ chasePlayer: true }, ['chasePlayer'])).toBe(true);
  });

  it('REFUSES a truthy string, which is not a decision', () => {
    expect(readOptionalBoolean({ chasePlayer: 'no' }, ['chasePlayer'])).toBeNull();
    expect(readOptionalBoolean({ chasePlayer: 0 }, ['chasePlayer'])).toBeNull();
  });

  it('does not read a key off the prototype chain', () => {
    expect(readOptionalBoolean({}, ['constructor'])).toBeNull();
  });
});

describe('readBoolean', () => {
  it('collapses absent to false, keeping only a real boolean', () => {
    expect(readBoolean({}, ['oneShot'])).toBe(false);
    expect(readBoolean({ oneShot: 'yes' }, ['oneShot'])).toBe(false);
    expect(readBoolean({ oneShot: true }, ['oneShot'])).toBe(true);
  });
});

describe('indexByName', () => {
  it('lets the first entity win a duplicated name', () => {
    const index = indexByName([planned('id-a', 'Coin'), planned('id-b', 'Coin')]);
    expect(index.get('coin')?.entityId).toBe('id-a');
  });

  it('skips an entity whose name normalizes to nothing', () => {
    expect(indexByName([planned('id-a', '!!!')]).size).toBe(0);
  });
});

describe('resolveNames', () => {
  const entities = [planned('id-lava', 'Lava'), planned('id-spikes', 'Spikes')];

  it('resolves names to planned entities, punctuation and casing aside', () => {
    const warn = vi.fn();
    const resolved = resolveNames(['lava!', 'SPIKES'], entities, warn, n => `missing ${n}`);

    expect(resolved.map(e => e.entityId)).toEqual(['id-lava', 'id-spikes']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('WARNS once per name that resolves to nothing, and plans nothing for it', () => {
    const warn = vi.fn();
    const resolved = resolveNames(['Ghost'], entities, warn, n => `missing ${n}`);

    // A step bound to a name the engine cannot match emits nothing at all, so
    // dropping it loudly is the only outcome anybody can act on.
    expect(resolved).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('missing Ghost');
  });

  it('WARNS with the exclusion reason and drops the entity', () => {
    const warn = vi.fn();
    const resolved = resolveNames(
      ['Lava', 'Spikes'],
      entities,
      warn,
      n => `missing ${n}`,
      (entity, name) => (entity.entityId === 'id-lava' ? `refused ${name}` : null),
    );

    expect(resolved.map(e => e.entityId)).toEqual(['id-spikes']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('refused Lava');
  });

  it('DEDUPES two spellings of the same entity without warning twice', () => {
    const warn = vi.fn();
    const resolved = resolveNames(['Lava', 'lava'], entities, warn, n => `missing ${n}`);

    expect(resolved.map(e => e.entityId)).toEqual(['id-lava']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('SKIPS a hole in the name list rather than warning about undefined', () => {
    const warn = vi.fn();
    const sparse = ['Lava'];
    sparse[2] = 'Spikes';

    const resolved = resolveNames(sparse, entities, warn, n => `missing ${n}`);

    expect(resolved.map(e => e.entityId)).toEqual(['id-lava', 'id-spikes']);
    expect(warn).not.toHaveBeenCalled();
  });
});
