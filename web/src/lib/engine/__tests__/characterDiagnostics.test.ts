import { describe, it, expect } from 'vitest';
import { parseSkippedCharacters, describeSkippedCharacters } from '../characterDiagnostics';

describe('parseSkippedCharacters', () => {
  it('reads the engine payload', () => {
    expect(parseSkippedCharacters({ skippedWithoutCollider: ['e1', 'e2'] })).toEqual(['e1', 'e2']);
  });

  it('distinguishes "nothing was skipped" from "unreadable"', () => {
    // The engine writes the resource on EVERY 3D Edit->Play transition, so an
    // empty list is a real answer: every character got its controller. Folding
    // it into null would make the recovery emission indistinguishable from a
    // broken payload.
    expect(parseSkippedCharacters({ skippedWithoutCollider: [] })).toEqual([]);
    expect(parseSkippedCharacters({})).toBeNull();
    expect(parseSkippedCharacters(null)).toBeNull();
    expect(parseSkippedCharacters('CHARACTER_CONTROLLER_DIAGNOSTICS')).toBeNull();
    expect(parseSkippedCharacters({ skippedWithoutCollider: 'e1' })).toBeNull();
  });

  it('refuses a list carrying anything that is not a usable id', () => {
    expect(parseSkippedCharacters({ skippedWithoutCollider: ['e1', 7] })).toBeNull();
    expect(parseSkippedCharacters({ skippedWithoutCollider: ['e1', null] })).toBeNull();
    // An empty id names no entity and would be shown to the user as a blank.
    expect(parseSkippedCharacters({ skippedWithoutCollider: [''] })).toBeNull();
  });

  it('refuses a list with a hole', () => {
    // The hole IS the input under test: a callback validator (`.every`) never
    // invokes its predicate for the missing slot and reports itself satisfied,
    // so only an indexed read sees this. `no-sparse-arrays` is not enabled in
    // this config, so there is no lint directive to add here.
    const holed = ['e1', , 'e2'] as unknown as unknown[];
    expect(parseSkippedCharacters({ skippedWithoutCollider: holed })).toBeNull();
    // And the shape the same array takes after a JSON round trip.
    expect(parseSkippedCharacters(JSON.parse(JSON.stringify({ skippedWithoutCollider: holed })))).toBeNull();
  });

  it('does not read an id off the prototype chain', () => {
    // `skippedWithoutCollider` is read straight off an engine payload; a bare
    // property read on a crafted object would resolve inherited members.
    const payload = Object.create({ skippedWithoutCollider: ['inherited'] }) as object;
    expect(parseSkippedCharacters(payload)).toBeNull();
  });
});

describe('describeSkippedCharacters', () => {
  const names: Record<string, string> = { e1: 'Player', e2: 'Enemy', e3: 'Guard', e4: 'Slime' };
  const nameOf = (id: string) => names[id];

  it('names one character and tells the player what to do', () => {
    expect(describeSkippedCharacters(['e1'], nameOf)).toBe(
      'Player has no physics, so it falls through the floor and walks through walls. ' +
        'Select it and tick Physics > Enabled in the Inspector, then press Play again.',
    );
  });

  it('agrees with itself in the plural', () => {
    expect(describeSkippedCharacters(['e1', 'e2'], nameOf)).toBe(
      'Player and Enemy have no physics, so they fall through the floor and walk through walls. ' +
        'Select each one and tick Physics > Enabled in the Inspector, then press Play again.',
    );
  });

  it('joins the last name with a conjunction, not a comma', () => {
    // "Player, Enemy, Guard have no physics" is a fragment, and this string is
    // a sentence a player reads under time pressure, not a log line.
    expect(describeSkippedCharacters(['e1', 'e2', 'e3'], nameOf)).toContain(
      'Player, Enemy and Guard have no physics',
    );
  });

  it('collapses a long list rather than filling the toast with ids', () => {
    const message = describeSkippedCharacters(['e1', 'e2', 'e3', 'e4'], nameOf);
    expect(message).toContain('Player, Enemy, Guard and 1 more have no physics');
    expect(message).not.toContain('Slime');
  });

  it('falls back to the raw id when the scene graph has no name for it', () => {
    // Naming the wrong entity is worse than naming none: the id at least
    // matches what the engine logged.
    expect(describeSkippedCharacters(['ghost'], nameOf)).toContain('ghost has no physics');
    expect(describeSkippedCharacters(['e5'], () => '')).toContain('e5 has no physics');
  });
});
