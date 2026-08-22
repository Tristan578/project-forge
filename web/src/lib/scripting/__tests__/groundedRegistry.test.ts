// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  setCharacterGrounded,
  isCharacterGrounded,
  getGroundedStates,
  clearGroundedStates,
} from '../groundedRegistry';

describe('groundedRegistry', () => {
  beforeEach(() => {
    clearGroundedStates();
  });

  it('answers false for a character it has never heard of', () => {
    // The engine only emits CHANGES, so "no entry" is the normal state for
    // every entity that is not a kinematic character. Guessing `true` would
    // let a script jump off thin air on frame one.
    expect(isCharacterGrounded('player')).toBe(false);
  });

  it('records and reads back a ground contact', () => {
    setCharacterGrounded('player', true);
    expect(isCharacterGrounded('player')).toBe(true);
    setCharacterGrounded('player', false);
    expect(isCharacterGrounded('player')).toBe(false);
  });

  it('keeps characters independent', () => {
    setCharacterGrounded('player', true);
    setCharacterGrounded('enemy', false);
    expect(isCharacterGrounded('player')).toBe(true);
    expect(isCharacterGrounded('enemy')).toBe(false);
  });

  it('snapshots every known character for the worker wire', () => {
    setCharacterGrounded('player', true);
    setCharacterGrounded('enemy', false);
    expect(getGroundedStates()).toEqual({ player: true, enemy: false });
  });

  it('hands out a copy, so a later change cannot mutate an already-sent frame', () => {
    setCharacterGrounded('player', true);
    const sent = getGroundedStates();
    setCharacterGrounded('player', false);
    expect(sent).toEqual({ player: true });
  });

  it('clears on stop so a restarted game does not inherit stale contact', () => {
    setCharacterGrounded('player', true);
    clearGroundedStates();
    expect(isCharacterGrounded('player')).toBe(false);
    expect(getGroundedStates()).toEqual({});
  });

  /**
   * The entity id reaches this module straight off the engine wire. A plain
   * object keyed by it would answer `isCharacterGrounded('constructor')` with
   * an inherited function — truthy — so a script could stand on a prototype.
   */
  it('does not resolve prototype keys as ground', () => {
    expect(isCharacterGrounded('constructor')).toBe(false);
    expect(isCharacterGrounded('__proto__')).toBe(false);
    expect(isCharacterGrounded('toString')).toBe(false);
  });

  it('carries a prototype-named entity through the snapshot as real data', () => {
    setCharacterGrounded('__proto__', true);
    expect(isCharacterGrounded('__proto__')).toBe(true);
    expect(Object.hasOwn(getGroundedStates(), '__proto__')).toBe(true);
  });
});
