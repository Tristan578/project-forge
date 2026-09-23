import { describe, it, expect } from 'vitest';
import {
  buildStoreComponent,
  buildStoreComponentWithReport,
  normalizeGameComponentWithReport,
  gameComponentFields,
  ENGINE_COMPONENT_TYPES,
  ENGINE_PROP_RANGES,
  ENGINE_PROP_MAXIMA,
  toStoreComponentType,
} from '../gameComponentWire';
import {
  describeCorrection,
  withCorrectionSummary,
  correctionMatchesValue,
  currentAdjustments,
  isGameComponentFieldCorrection,
  readCorrections,
  nextComponentAdjustments,
  withComponentAdjustments,
  componentAdjustmentsOf,
  pruneEntityAdjustments,
  type CorrectionReason,
  type GameComponentFieldCorrection,
  type GameComponentAdjustments,
  type PointsCorrection,
  type ValueCorrection,
} from '../gameComponentCorrections';
import type { GameComponentData } from '@/stores/slices/types';

/**
 * PF-1148: the wire layer reports each field whose applied value differs from
 * the one the caller supplied — and ONLY those. Every positive case below names
 * the exact record; every negative case asserts the report is empty, because a
 * false "we adjusted this" is the failure the issue calls worse than silence.
 */

function report(name: string, props: Record<string, unknown>) {
  const built = buildStoreComponentWithReport(name, props);
  if (built === null) throw new Error(`${name} did not build`);
  return built;
}

const route = (n: number): [number, number, number][] =>
  Array.from({ length: n }, (_, i) => [i, 0, 0] as [number, number, number]);

/** As `route`, with the same count and different points — what an undo can put back. */
const otherRoute = (n: number): [number, number, number][] =>
  Array.from({ length: n }, (_, i) => [i, 5, 0] as [number, number, number]);

describe('buildStoreComponentWithReport — what IS a correction', () => {
  it('reports a clamped speed with the number asked for and the number used', () => {
    expect(report('moving_platform', { speed: 99999 }).corrections).toEqual([
      { component: 'movingPlatform', field: 'speed', requested: 99999, applied: 1000, reason: 'clamped' },
    ]);
  });

  it('reports a value raised to the minimum', () => {
    expect(report('spawner', { intervalSecs: 0 }).corrections).toEqual([
      { component: 'spawner', field: 'intervalSecs', requested: 0, applied: 0.1, reason: 'clamped' },
    ]);
  });

  it.each(
    Object.entries(ENGINE_PROP_RANGES).flatMap(([engineType, fields]) =>
      Object.entries(fields).map(([key, range]) => [engineType, key, range.max] as const)),
  )('%s.%s over its maximum is one clamped correction', (engineType, key, max) => {
    // The dialogue trigger's range is keyed by its ENGINE field name; the store
    // spells it `triggerRadius`, and the report speaks the store's vocabulary.
    const field = engineType === 'dialogue_trigger' ? 'triggerRadius' : key;
    expect(report(engineType, { [field]: max + 1 }).corrections).toEqual([
      {
        component: toStoreComponentType(engineType),
        field,
        requested: max + 1,
        applied: max,
        reason: 'clamped',
      },
    ]);
  });

  it.each(
    Object.entries(ENGINE_PROP_MAXIMA).flatMap(([engineType, fields]) =>
      Object.entries(fields).map(([key, max]) => [engineType, key, max] as const)),
  )('%s.%s rounds a fraction and clamps past its maximum', (engineType, key, max) => {
    const component = toStoreComponentType(engineType);
    expect(report(engineType, { [key]: 2.6 }).corrections).toEqual([
      { component, field: key, requested: 2.6, applied: 3, reason: 'rounded' },
    ]);
    expect(report(engineType, { [key]: -5 }).corrections).toEqual([
      { component, field: key, requested: -5, applied: 0, reason: 'clamped' },
    ]);
    expect(report(engineType, { [key]: max + 10 }).corrections).toEqual([
      { component, field: key, requested: max + 10, applied: max, reason: 'clamped' },
    ]);
  });

  it('reports a 300-point route as truncated to the engine cap, in counts, carrying the route it kept', () => {
    const built = report('moving_platform', { waypoints: route(300) });
    expect(built.corrections).toEqual([
      {
        component: 'movingPlatform',
        field: 'waypoints',
        requested: 300,
        applied: 64,
        reason: 'truncated',
        unit: 'points',
        appliedPoints: route(64),
      },
    ]);
    if (built.component.type !== 'movingPlatform') throw new Error('expected a movingPlatform');
    const kept = built.component.movingPlatform.waypoints;
    expect(kept).toEqual(route(64));
    // A copy, not the component's own arrays: an in-place edit of the stored
    // route must not drag the record along with it and match itself.
    const [cut] = built.corrections;
    expect(cut.appliedPoints).not.toBe(kept);
    expect(cut.appliedPoints?.[0]).not.toBe(kept[0]);
  });

  it('reports malformed points that were left out without reaching the cap as dropped', () => {
    expect(report('moving_platform', {
      waypoints: [[0, 0, 0], 'nope', [1, 2], [4, 5, 6], [7, 8, 9]],
    }).corrections).toEqual([
      {
        component: 'movingPlatform',
        field: 'waypoints',
        requested: 5,
        applied: 3,
        reason: 'dropped',
        unit: 'points',
        appliedPoints: [[0, 0, 0], [4, 5, 6], [7, 8, 9]],
      },
    ]);
  });

  it('calls junk interleaved with a full route "dropped", not "truncated" — nothing past the cap was cut', () => {
    // 64 real points and 64 junk entries: every real point is kept, so saying
    // the route was cut short would be false.
    const interleaved: unknown[] = [];
    for (const point of route(64)) interleaved.push('junk', point);
    expect(report('moving_platform', { waypoints: interleaved }).corrections).toEqual([
      {
        component: 'movingPlatform',
        field: 'waypoints',
        requested: 128,
        applied: 64,
        reason: 'dropped',
        unit: 'points',
        appliedPoints: route(64),
      },
    ]);
  });

  it('reports a route with fewer than two usable points as replaced by the default route', () => {
    // The default route itself, which is what the platform now follows.
    const defaultRoute = [[0, 0, 0], [0, 3, 0]];
    expect(report('moving_platform', { waypoints: [[1, 2, 3], 'junk'] }).corrections).toEqual([
      {
        component: 'movingPlatform',
        field: 'waypoints',
        // Every entry given, usable or not…
        requested: 2,
        applied: 2,
        reason: 'invalid-replaced',
        unit: 'points',
        appliedPoints: defaultRoute,
        // …and how many of them were usable, which neither count above says.
        usable: 1,
      },
    ]);
    const notAList = report('moving_platform', { waypoints: 'not a list' }).corrections;
    expect(notAList).toEqual([
      {
        component: 'movingPlatform',
        field: 'waypoints',
        requested: 'not a list',
        applied: 2,
        reason: 'invalid-replaced',
        unit: 'points',
        appliedPoints: defaultRoute,
      },
    ]);
    // Not a list, so there are no entries to count — the key is absent, not
    // `undefined` (which `toEqual` would read as absent too).
    expect(Object.hasOwn(notAList[0], 'usable')).toBe(false);
  });

  it.each([
    ['an empty list', [], 0, 0],
    ['one usable point', [[1, 2, 3]], 1, 1],
    ['one entry that is not a point', ['junk'], 1, 0],
    ['two entries, one usable', [[1, 2, 3], 'junk'], 2, 1],
    ['three entries, none usable', ['a', [1, 2], [0, Number.NaN, 0]], 3, 0],
  ] as const)('counts the usable entries of a refused route: %s', (_label, waypoints, given, usable) => {
    const [refused] = report('moving_platform', { waypoints }).corrections;
    expect(refused).toMatchObject({ reason: 'invalid-replaced', requested: given, applied: 2, unit: 'points', usable });
  });

  it('carries no usable count on a route it kept', () => {
    // Truncated and dropped routes already say what they kept: `applied`.
    const records = [
      ...report('moving_platform', { waypoints: route(300) }).corrections,
      ...report('moving_platform', { waypoints: [[0, 0, 0], 'nope', [4, 5, 6]] }).corrections,
    ];
    expect(records.map((r) => r.reason)).toEqual(['truncated', 'dropped']);
    for (const record of records) expect(Object.hasOwn(record, 'usable'), record.reason).toBe(false);
  });

  it('reports a non-number, an f32 overflow and a null as replaced by the default', () => {
    expect(report('moving_platform', { speed: 'fast' }).corrections).toEqual([
      { component: 'movingPlatform', field: 'speed', requested: 'fast', applied: 2, reason: 'invalid-replaced' },
    ]);
    // Finite to JS, infinite to the engine's `as f32` — dropped, not clamped.
    expect(report('moving_platform', { speed: 1e300 }).corrections).toEqual([
      { component: 'movingPlatform', field: 'speed', requested: 1e300, applied: 2, reason: 'invalid-replaced' },
    ]);
    expect(report('moving_platform', { speed: null }).corrections).toEqual([
      { component: 'movingPlatform', field: 'speed', requested: null, applied: 2, reason: 'invalid-replaced' },
    ]);
  });

  it('describes a value JSON cannot carry instead of echoing it', () => {
    expect(report('moving_platform', { speed: Number.NaN }).corrections).toEqual([
      {
        component: 'movingPlatform',
        field: 'speed',
        requested: { description: 'NaN' },
        applied: 2,
        reason: 'invalid-replaced',
      },
    ]);
  });

  it('reports an unknown enum string and a wrongly-typed boolean', () => {
    expect(report('moving_platform', { loopMode: 'bounce' }).corrections).toEqual([
      { component: 'movingPlatform', field: 'loopMode', requested: 'bounce', applied: 'pingPong', reason: 'invalid-replaced' },
    ]);
    expect(report('character_controller', { canDoubleJump: 'yes' }).corrections).toEqual([
      { component: 'characterController', field: 'canDoubleJump', requested: 'yes', applied: false, reason: 'invalid-replaced' },
    ]);
  });

  it('summarizes an over-long string by its length rather than echoing it', () => {
    const long = 'x'.repeat(300);
    expect(report('trigger_zone', { eventName: long }).corrections).toEqual([
      {
        component: 'triggerZone',
        field: 'eventName',
        requested: { description: 'a 300-character text' },
        applied: 'trigger',
        reason: 'invalid-replaced',
      },
    ]);
    expect(report('follower', { targetEntityId: long }).corrections).toEqual([
      {
        component: 'follower',
        field: 'targetEntityId',
        requested: { description: 'a 300-character text' },
        applied: null,
        reason: 'invalid-replaced',
      },
    ]);
  });

  it('reports a malformed vector with the default it fell back to', () => {
    expect(report('health', { respawnPoint: [1, Number.NaN, 3] }).corrections).toEqual([
      {
        component: 'health',
        field: 'respawnPoint',
        requested: { description: '[1, NaN, 3]' },
        applied: [0, 1, 0],
        reason: 'invalid-replaced',
      },
    ]);
  });

  it('reports the health aliases under the store field they set', () => {
    expect(report('health', { maxHealth: 5_000_000 }).corrections).toEqual([
      { component: 'health', field: 'maxHp', requested: 5_000_000, applied: 1_000_000, reason: 'clamped' },
    ]);
  });

  it('records every supplied field, corrected or not, and nothing else', () => {
    expect([...report('moving_platform', { speed: 3, loopMode: 'bounce' }).supplied].sort())
      .toEqual(['loopMode', 'speed']);
  });
});

describe('buildStoreComponentWithReport — what is NOT a correction', () => {
  it('reports nothing for values already in range', () => {
    const built = report('moving_platform', {
      speed: 6,
      waypoints: [[1, 1, 1], [2, 2, 2]],
      pauseDuration: 2,
      loopMode: 'once',
    });
    expect(built.corrections).toEqual([]);
    // Content, not just emptiness: the in-range values really were applied.
    expect(built.component).toEqual({
      type: 'movingPlatform',
      movingPlatform: { speed: 6, waypoints: [[1, 1, 1], [2, 2, 2]], pauseDuration: 2, loopMode: 'once' },
    });
  });

  it('reports nothing for a bag with no keys, which is all defaults', () => {
    for (const name of ENGINE_COMPONENT_TYPES) {
      const built = report(name, {});
      expect(built.corrections, name).toEqual([]);
      expect(built.supplied, name).toEqual([]);
      expect(built.component, name).toEqual(buildStoreComponent(name));
    }
  });

  it('reports nothing for a key present with an undefined value', () => {
    expect(report('moving_platform', { speed: undefined }).corrections).toEqual([]);
  });

  it('does not count the current-HP-follows-max fallback as a correction', () => {
    const built = report('health', { maxHp: 50 });
    expect(built.corrections).toEqual([]);
    expect(built.component.type === 'health' && built.component.health.currentHp).toBe(50);
  });

  it('reports max HP once when it is clamped, and not the current HP that follows it', () => {
    const built = report('health', { maxHp: 5_000_000 });
    expect(built.corrections.map((c) => c.field)).toEqual(['maxHp']);
    expect(built.component.type === 'health' && built.component.health.currentHp).toBe(1_000_000);
  });

  it('reports nothing for an explicit null on a nullable field', () => {
    expect(report('win_condition', { targetScore: null, targetEntityId: null }).corrections).toEqual([]);
    expect(report('collectible', { pickupSoundAsset: null }).corrections).toEqual([]);
  });

  it('reports nothing for exactly the bounds and exactly the waypoint cap', () => {
    expect(report('moving_platform', { speed: 1000, waypoints: route(64) }).corrections).toEqual([]);
    expect(report('character_controller', { gravityScale: -10 }).corrections).toEqual([]);
    expect(report('spawner', { maxCount: 1000 }).corrections).toEqual([]);
  });

  it('reports nothing for negative zero, which the clamp turns into zero', () => {
    expect(report('moving_platform', { speed: -0 }).corrections).toEqual([]);
  });

  it('reports nothing when an already-valid component is normalized again', () => {
    for (const name of ENGINE_COMPONENT_TYPES) {
      const once = report(name, {}).component;
      const again = normalizeGameComponentWithReport(once);
      expect(again.corrections, name).toEqual([]);
      expect(again.component, name).toEqual(once);
    }
  });

  it('reports nothing when the result of a correction is normalized again', () => {
    const first = report('moving_platform', { speed: 99999, waypoints: route(300) });
    expect(first.corrections).toHaveLength(2);
    const again = normalizeGameComponentWithReport(first.component);
    expect(again.corrections).toEqual([]);
    expect(again.component).toEqual(first.component);
  });

  it('builds without a report exactly as before', () => {
    // The report is additive: the component the plain builder returns is the
    // one the reporting builder returns.
    const props = { speed: 99999, waypoints: route(300), loopMode: 'bounce' };
    expect(report('moving_platform', props).component).toEqual(buildStoreComponent('moving_platform', props));
  });

  it('returns null for an unknown component, like the plain builder', () => {
    expect(buildStoreComponentWithReport('jetpack', { speed: 1 })).toBeNull();
  });
});

describe('normalizeGameComponentWithReport', () => {
  it('reports a raw inspector value the engine would round', () => {
    const raw: GameComponentData = {
      type: 'collectible',
      collectible: { value: 10.4, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 90 },
    };
    const { component, corrections } = normalizeGameComponentWithReport(raw);
    expect(corrections).toEqual([
      { component: 'collectible', field: 'value', requested: 10.4, applied: 10, reason: 'rounded' },
    ]);
    expect(component.type === 'collectible' && component.collectible.value).toBe(10);
  });
});

describe('describeCorrection', () => {
  const c = (overrides: Partial<ValueCorrection>): GameComponentFieldCorrection => ({
    component: 'movingPlatform',
    field: 'speed',
    requested: 99999,
    applied: 1000,
    reason: 'clamped',
    ...overrides,
  });
  /** A route record: counts in `requested` / `applied`, and the route it kept. */
  const points = (requested: number, applied: number, reason: CorrectionReason): PointsCorrection => ({
    component: 'movingPlatform',
    field: 'waypoints',
    requested,
    applied,
    reason,
    unit: 'points',
    appliedPoints: route(applied),
  });

  it('says what was asked for and what was used, in the author’s terms', () => {
    expect(describeCorrection(c({}))).toBe('Moving Platform speed: you asked for 99999, it was capped at 1000.');
    expect(describeCorrection(c({ component: 'spawner', field: 'intervalSecs', requested: 0, applied: 0.1 })))
      .toBe('Spawner interval: you asked for 0, it was raised to the minimum of 0.1.');
    expect(describeCorrection(c({ component: 'collectible', field: 'value', requested: 10.4, applied: 10, reason: 'rounded' })))
      .toBe('Collectible value: you asked for 10.4, it was rounded to the whole number 10.');
  });

  it('describes list changes in points', () => {
    expect(describeCorrection(points(300, 64, 'truncated')))
      .toBe('Moving Platform waypoints: you gave 300 points; only the first 64 points were kept, the most the engine supports.');
    expect(describeCorrection(points(5, 3, 'dropped')))
      .toBe('Moving Platform waypoints: you gave 5 points; 2 could not be used, so 3 points were kept.');
    expect(describeCorrection(points(1, 2, 'invalid-replaced')))
      .toBe('Moving Platform waypoints: you gave 1 point, but a route needs at least 2 usable points, so the default route (2 points) was used instead.');
    // The route itself is carried for the marker check, never read out: the
    // sentence speaks in counts whatever the points are.
    expect(describeCorrection(points(300, 64, 'truncated'))).not.toMatch(/\[/);
  });

  // Board round 3: `requested` counts every entry given, usable or not, so a
  // refused list of two or more entries read "you gave 2 points, but a route
  // needs at least 2 usable points" — a sentence that contradicts itself. The
  // cases are built by the real wire layer, not by hand, so the sentence is
  // pinned to the record the build actually writes.
  it.each([
    [
      [],
      'you gave 0 points, but a route needs at least 2 usable points, so the default route (2 points) was used instead.',
    ],
    [
      [[1, 2, 3]],
      'you gave 1 point, but a route needs at least 2 usable points, so the default route (2 points) was used instead.',
    ],
    [
      ['junk'],
      'you gave 1 point, but it could not be used, and a route needs at least 2, so the default route (2 points) was used instead.',
    ],
    [
      [[1, 2, 3], 'junk'],
      'you gave 2 points, but only 1 could be used, and a route needs at least 2, so the default route (2 points) was used instead.',
    ],
    [
      [[1, 2, 3], [1, 2], 'junk', [4, 5, Number.NaN]],
      'you gave 4 points, but only 1 could be used, and a route needs at least 2, so the default route (2 points) was used instead.',
    ],
    [
      ['a', [1, 2], [0, Number.NaN, 0]],
      'you gave 3 points, but none of them could be used, and a route needs at least 2, so the default route (2 points) was used instead.',
    ],
  ] as const)('says why the route %j was refused without contradicting its own count', (waypoints, sentence) => {
    const [refused] = report('moving_platform', { waypoints }).corrections;
    expect(describeCorrection(refused)).toBe(`Moving Platform waypoints: ${sentence}`);
  });

  it('says only what a refused-route record without a usable count supports', () => {
    // A record can arrive without the count (a hand-written MCP reply). Two or
    // more entries and still refused means fewer than two were usable — true
    // whatever the count was — and nothing more specific is claimed.
    expect(describeCorrection(points(5, 2, 'invalid-replaced')))
      .toBe('Moving Platform waypoints: you gave 5 points, but fewer than 2 of them could be used, and a route needs at least 2, so the default route (2 points) was used instead.');
    // Fewer than two entries: the short list is the reason on its own.
    expect(describeCorrection(points(1, 2, 'invalid-replaced')))
      .toBe('Moving Platform waypoints: you gave 1 point, but a route needs at least 2 usable points, so the default route (2 points) was used instead.');
  });

  it('quotes text, and describes what it did not echo', () => {
    expect(describeCorrection(c({ field: 'loopMode', requested: 'bounce', applied: 'pingPong', reason: 'invalid-replaced' })))
      .toBe('Moving Platform loop mode: "bounce" is not a value this field accepts, so "pingPong" was used instead.');
    expect(describeCorrection(c({
      component: 'health', field: 'respawnPoint', requested: { description: '[1, NaN, 3]' }, applied: [0, 1, 0], reason: 'invalid-replaced',
    }))).toBe('Health respawn point: [1, NaN, 3] is not a value this field accepts, so [0, 1, 0] was used instead.');
  });

  it('never falls back to a raw camelCase key for a field the builder reports', () => {
    // Every field every component can report must have a label: build each one
    // with every field set to a value no field accepts, then check each sentence.
    for (const name of ENGINE_COMPONENT_TYPES) {
      const fields = Object.keys(gameComponentFields(buildStoreComponent(name)!));
      const junk = Object.fromEntries(fields.map((f) => [f, Symbol('junk')]));
      const built = report(name, junk);
      expect(built.corrections.map((x) => x.field).sort(), name).toEqual([...fields].sort());
      for (const correction of built.corrections) {
        const sentence = describeCorrection(correction);
        expect(sentence, `${name}.${correction.field}`).toMatch(/^[A-Z][A-Za-z ]+ [a-zA-Z -]+: /);
        // `speed` is both a key and a word; `jumpHeight` is only ever a key.
        if (/[A-Z]/.test(correction.field)) {
          expect(sentence, `${name}.${correction.field}`).not.toContain(correction.field);
        }
      }
    }
  });
});

describe('withCorrectionSummary', () => {
  const clamp: GameComponentFieldCorrection = {
    component: 'movingPlatform', field: 'speed', requested: 99999, applied: 1000, reason: 'clamped',
  };

  it('returns the message untouched when nothing was adjusted', () => {
    expect(withCorrectionSummary('Added moving_platform', [])).toBe('Added moving_platform');
  });

  it('names a tagged record’s entity, falling back to its id', () => {
    expect(withCorrectionSummary(
      'Created 2 entities.',
      [{ ...clamp, entityId: 'id-1' }, { ...clamp, entityId: 'id-2' }],
      (id) => (id === 'id-1' ? 'Lift' : undefined),
    )).toBe(
      'Created 2 entities. 2 values were adjusted to fit the engine’s limits: '
      + '"Lift" Moving Platform speed: you asked for 99999, it was capped at 1000. '
      + '"id-2" Moving Platform speed: you asked for 99999, it was capped at 1000.',
    );
  });
});

describe('correctionMatchesValue', () => {
  const clamp: GameComponentFieldCorrection = {
    component: 'spawner', field: 'intervalSecs', requested: 0, applied: 0.1, reason: 'clamped',
  };

  it('matches the applied number at f32 precision, which is how the engine echoes it', () => {
    expect(correctionMatchesValue(clamp, 0.1)).toBe(true);
    expect(correctionMatchesValue(clamp, Math.fround(0.1))).toBe(true);
    expect(correctionMatchesValue(clamp, 0.2)).toBe(false);
    expect(correctionMatchesValue(clamp, '0.1')).toBe(false);
  });

  it('matches a route correction by the points it kept, not by how many there are', () => {
    // The route is reported in counts, and a count-only match let a "truncated"
    // marker survive an undo, a scene load or a collab sync that put back a
    // DIFFERENT 64-point route: the marker kept saying "these are the first 64
    // of the 300 you gave" about points nobody gave.
    const [cut] = report('moving_platform', { waypoints: route(300) }).corrections;
    expect(correctionMatchesValue(cut, route(64))).toBe(true);

    expect(correctionMatchesValue(cut, otherRoute(64))).toBe(false);
    const nudged = route(64);
    nudged[63] = [63, 0, 1];
    expect(correctionMatchesValue(cut, nudged)).toBe(false);
    // A hole where a point should be is not that point.
    const holed = route(64);
    delete (holed as unknown[])[5];
    expect(correctionMatchesValue(cut, holed)).toBe(false);

    expect(correctionMatchesValue(cut, route(63))).toBe(false);
    expect(correctionMatchesValue(cut, route(65))).toBe(false);
    expect(correctionMatchesValue(cut, 'x')).toBe(false);
  });

  it('matches a route at f32 precision, which is how the engine echoes it', () => {
    const fractional = Array.from({ length: 70 }, (_, i) => [i + 0.1, 0.2, 0.3]);
    const [cut] = report('moving_platform', { waypoints: fractional }).corrections;
    const echoed = fractional.slice(0, 64).map((point) => point.map(Math.fround));
    // Non-vacuous: the echo really is a different double from the one applied.
    expect(echoed[0][0]).not.toBe(0.1);
    expect(correctionMatchesValue(cut, echoed)).toBe(true);
    // And f32 precision is not a tolerance that swallows a real difference.
    const moved = echoed.map((point) => [...point]);
    moved[10][2] = 0.31;
    expect(correctionMatchesValue(cut, moved)).toBe(false);
  });

  it('never matches a route correction that does not carry the route it describes', () => {
    // Only a count is not enough to tell this route from another of the same
    // length, so a record without the points cannot vouch for any value.
    const countOnly = {
      component: 'movingPlatform', field: 'waypoints', requested: 300, applied: 64, reason: 'truncated', unit: 'points',
    } as unknown as GameComponentFieldCorrection;
    expect(correctionMatchesValue(countOnly, route(64))).toBe(false);
    // Nor one whose count disagrees with the points it carries.
    const inconsistent = {
      component: 'movingPlatform', field: 'waypoints', requested: 300, applied: 63, reason: 'truncated', unit: 'points',
      appliedPoints: route(64),
    } as unknown as GameComponentFieldCorrection;
    expect(correctionMatchesValue(inconsistent, route(64))).toBe(false);
  });

  it('matches a vector elementwise', () => {
    const vec: GameComponentFieldCorrection = {
      component: 'health', field: 'respawnPoint', requested: { description: 'x' }, applied: [0, 1, 0], reason: 'invalid-replaced',
    };
    expect(correctionMatchesValue(vec, [0, 1, 0])).toBe(true);
    expect(correctionMatchesValue(vec, [0, 2, 0])).toBe(false);
  });
});

describe('readCorrections', () => {
  const good = { component: 'movingPlatform', field: 'speed', requested: 99999, applied: 1000, reason: 'clamped' };

  it('keeps well-formed records and drops anything else', () => {
    expect(readCorrections({
      corrections: [
        good,
        { ...good, entityId: 'e1' },
        { ...good, reason: 'guessed' },
        'x',
        null,
        { ...good, component: 'jetpack' },
        { ...good, entityId: 7 },
        { ...good, requested: { nope: true } },
      ],
    })).toEqual([good, { ...good, entityId: 'e1' }]);
  });

  it('keeps a route record only when it carries the route its count describes', () => {
    const cut = {
      component: 'movingPlatform', field: 'waypoints', requested: 300, applied: 2, reason: 'truncated', unit: 'points',
      appliedPoints: [[0, 0, 0], [1, 0, 0]],
    };
    const holed: unknown[] = [[0, 0, 0], [1, 0, 0]];
    delete holed[1];
    expect(readCorrections({
      corrections: [
        cut,
        // No route at all.
        { ...cut, appliedPoints: undefined },
        // A count the route does not have.
        { ...cut, applied: 3 },
        // A point that is not three numbers.
        { ...cut, appliedPoints: [[0, 0, 0], [1, 0]] },
        { ...cut, appliedPoints: [[0, 0, 0], [1, 'x', 0]] },
        // A hole, which `every` would walk straight past.
        { ...cut, appliedPoints: holed },
        // A route on a record that is not about a route.
        { ...good, appliedPoints: [[0, 0, 0], [1, 0, 0]] },
        // A unit this build does not know.
        { ...cut, unit: 'metres' },
      ],
    })).toEqual([cut]);
  });

  it('keeps a usable count only where the wire layer could have written it', () => {
    const refused = {
      component: 'movingPlatform', field: 'waypoints', requested: 2, applied: 2, reason: 'invalid-replaced', unit: 'points',
      appliedPoints: [[0, 0, 0], [0, 3, 0]], usable: 1,
    };
    const cut = {
      component: 'movingPlatform', field: 'waypoints', requested: 300, applied: 2, reason: 'truncated', unit: 'points',
      appliedPoints: [[0, 0, 0], [1, 0, 0]],
    };
    // Each of these would render a sentence the build never produces.
    const forged = [
      // A refused route has fewer than two usable entries, by definition.
      { ...refused, usable: 2 },
      // More usable entries than were given.
      { ...refused, requested: 0, usable: 1 },
      { ...refused, usable: -1 },
      { ...refused, usable: 0.5 },
      { ...refused, usable: '1' },
      { ...refused, usable: null },
      // Not a list, so there were no entries to count.
      { ...refused, requested: 'not a list', usable: 0 },
      // A kept route already says what it kept.
      { ...cut, usable: 1 },
      { ...cut, reason: 'dropped', usable: 1 },
      // Not a route at all.
      { ...good, usable: 1 },
    ];
    expect(forged.filter((c) => isGameComponentFieldCorrection(c))).toEqual([]);
    // Non-vacuous: the well-formed records beside them are kept, with and
    // without the count (a hand-written reply may leave it out).
    const { usable: _count, ...withoutCount } = refused;
    expect(readCorrections({ corrections: [refused, withoutCount, { ...refused, usable: 0 }, ...forged] }))
      .toEqual([refused, withoutCount, { ...refused, usable: 0 }]);
  });

  it('drops a vector with a hole in it', () => {
    const holed: unknown[] = [0, 1, 0];
    delete holed[1];
    expect(readCorrections({ corrections: [{ ...good, applied: holed }] })).toEqual([]);
  });

  // Board round 4 (PR #10187): the guard checked `component` against the known
  // components but let `field` be any string, and let a route record sit on any
  // field. `fieldLabel` falls back to the raw key, so a hand-written reply of
  // `{ component: 'movingPlatform', field: 'maxHp', … }` rendered "Moving
  // Platform maxHp", a note the wire layer never wrote. The wire layer's
  // `fieldReader` types its field names as `keyof` the component's data, so a
  // real record never names anything else.
  describe('holds a record to what the wire layer can write', () => {
    const cut = {
      component: 'movingPlatform', field: 'waypoints', requested: 300, applied: 2, reason: 'truncated', unit: 'points',
      appliedPoints: [[0, 0, 0], [1, 0, 0]],
    };

    it('keeps a record only on a field its own component has', () => {
      const forged = [
        // Another component's field.
        { ...good, field: 'maxHp' },
        { ...good, component: 'health', field: 'loopMode' },
        // No component's field.
        { ...good, field: 'speeed' },
        { ...good, field: '' },
        // Inherited, not own: `in` would let these through.
        { ...good, field: 'toString' },
        { ...good, field: 'constructor' },
        { ...good, field: '__proto__' },
        { ...good, field: 7 },
      ];
      expect(forged.filter((c) => isGameComponentFieldCorrection(c))).toEqual([]);
      // Non-vacuous: the same record on the field it belongs to is kept.
      expect(readCorrections({ corrections: [good, ...forged] })).toEqual([good]);
    });

    it('keeps a route record only on the route field, and the route field only as a route', () => {
      const forged = [
        // A route on a scalar field of the component that has a route.
        { ...cut, field: 'speed' },
        { ...cut, field: 'pauseDuration' },
        // A route on another component's field.
        { ...cut, component: 'health', field: 'maxHp' },
        { ...cut, component: 'spawner', field: 'spawnOffset' },
        // The route field reported as a plain value. `recordRoute` is the only
        // writer for it, and every record it writes carries the unit.
        { component: 'movingPlatform', field: 'waypoints', requested: 300, applied: 64, reason: 'truncated' },
        { component: 'movingPlatform', field: 'waypoints', requested: 'x', applied: [0, 0, 0], reason: 'invalid-replaced' },
      ];
      expect(forged.filter((c) => isGameComponentFieldCorrection(c))).toEqual([]);
      expect(readCorrections({ corrections: [cut, ...forged] })).toEqual([cut]);
    });

    it('keeps a reason only on the kind of record the wire layer gives it', () => {
      // `truncated` and `dropped` describe entries of a list; `clamped` and
      // `rounded` describe one number. Crossed over, each renders a sentence
      // the build never produces ("you gave 99999; only the first 1000 were
      // kept" about a speed).
      const forged = [
        { ...good, reason: 'truncated' },
        { ...good, reason: 'dropped' },
        { ...cut, reason: 'clamped' },
        { ...cut, reason: 'rounded' },
      ];
      expect(forged.filter((c) => isGameComponentFieldCorrection(c))).toEqual([]);
      expect(readCorrections({ corrections: [good, cut, ...forged] })).toEqual([good, cut]);
    });

    it('keeps every record the wire layer actually writes, directly and after a JSON round trip', () => {
      // The other side of the three cases above: a tighter guard must not
      // refuse a real record. Every field of every component, given a value no
      // field accepts, plus each reason the wire layer can give.
      const written: GameComponentFieldCorrection[] = [];
      for (const name of ENGINE_COMPONENT_TYPES) {
        const fields = Object.keys(gameComponentFields(buildStoreComponent(name)!));
        written.push(...report(name, Object.fromEntries(fields.map((f) => [f, Symbol('junk')]))).corrections);
      }
      written.push(
        ...report('moving_platform', { speed: 99999, waypoints: route(300) }).corrections,
        ...report('moving_platform', { waypoints: [[0, 0, 0], 'junk', [1, 0, 0]] }).corrections,
        ...report('moving_platform', { waypoints: [[1, 2, 3], 'junk'] }).corrections,
        ...report('collectible', { value: 10.4 }).corrections,
      );
      // The sweep reached every reason on the kind of record that carries it.
      const kinds = new Set(written.map((c) => `${c.unit ?? 'value'}:${c.reason}`));
      expect([...kinds].sort()).toEqual([
        'points:dropped', 'points:invalid-replaced', 'points:truncated',
        'value:clamped', 'value:invalid-replaced', 'value:rounded',
      ]);
      expect(written.filter((c) => c.usable !== undefined)).toHaveLength(1);

      expect(readCorrections({ corrections: written })).toEqual(written);
      const relayed = JSON.parse(JSON.stringify({ corrections: written })) as { corrections: unknown[] };
      expect(readCorrections(relayed)).toEqual(relayed.corrections);
    });
  });

  it('reads nothing from a result without its own corrections key', () => {
    expect(readCorrections(undefined)).toEqual([]);
    expect(readCorrections('Added')).toEqual([]);
    expect(readCorrections(Object.create({ corrections: [good] }))).toEqual([]);
    expect(isGameComponentFieldCorrection(good)).toBe(true);
  });
});

describe('the per-field marker map', () => {
  const platform = (speed: number, waypoints = route(2)): GameComponentData => ({
    type: 'movingPlatform',
    movingPlatform: { speed, waypoints, pauseDuration: 0.5, loopMode: 'pingPong' },
  });
  const speedClamp: GameComponentFieldCorrection = {
    component: 'movingPlatform', field: 'speed', requested: 99999, applied: 1000, reason: 'clamped',
  };
  const routeCut: GameComponentFieldCorrection = {
    component: 'movingPlatform',
    field: 'waypoints',
    requested: 300,
    applied: 64,
    reason: 'truncated',
    unit: 'points',
    appliedPoints: route(64),
  };

  it('marks a field with the correction that set it', () => {
    expect(nextComponentAdjustments({
      previous: undefined,
      previousFields: undefined,
      nextFields: gameComponentFields(platform(1000)),
      corrections: [speedClamp],
      supplied: ['speed'],
    })).toEqual({ speed: speedClamp });
  });

  it('refuses a correction whose applied value the field does not hold', () => {
    // A caller handing the store a report for a different write must not
    // produce a marker on a value it does not describe.
    expect(nextComponentAdjustments({
      previous: undefined,
      previousFields: undefined,
      nextFields: gameComponentFields(platform(7)),
      corrections: [speedClamp],
      supplied: [],
    })).toBeUndefined();
  });

  it('keeps an untouched field’s marker while another field is edited', () => {
    expect(nextComponentAdjustments({
      previous: { speed: speedClamp, waypoints: routeCut },
      previousFields: gameComponentFields(platform(1000, route(64))),
      nextFields: { ...gameComponentFields(platform(1000, route(64))), pauseDuration: 2 },
      corrections: [],
      supplied: [],
    })).toEqual({ speed: speedClamp, waypoints: routeCut });
  });

  it('clears a marker when its field is edited without a correction', () => {
    expect(nextComponentAdjustments({
      previous: { speed: speedClamp, waypoints: routeCut },
      previousFields: gameComponentFields(platform(1000, route(64))),
      nextFields: gameComponentFields(platform(500, route(64))),
      corrections: [],
      supplied: [],
    })).toEqual({ waypoints: routeCut });
  });

  it('clears a marker when the caller sets the field explicitly, even to the same value', () => {
    expect(nextComponentAdjustments({
      previous: { speed: speedClamp },
      previousFields: gameComponentFields(platform(1000)),
      nextFields: gameComponentFields(platform(1000)),
      corrections: [],
      supplied: ['speed'],
    })).toBeUndefined();
  });

  it('stores and removes a component’s markers without touching an inherited key', () => {
    let map: GameComponentAdjustments = {};
    map = withComponentAdjustments(map, '__proto__', 'movingPlatform', { speed: speedClamp });
    expect(Object.getPrototypeOf(map)).toBe(Object.prototype);
    expect(componentAdjustmentsOf(map, '__proto__', 'movingPlatform')).toEqual({ speed: speedClamp });
    expect(componentAdjustmentsOf(map, 'constructor', 'movingPlatform')).toBeUndefined();
    map = withComponentAdjustments(map, '__proto__', 'movingPlatform', undefined);
    expect(Object.keys(map)).toEqual([]);
  });

  it('shows only the markers the current value still bears out', () => {
    const markers = { speed: speedClamp, waypoints: routeCut };
    expect(currentAdjustments(markers, platform(1000, route(64)))).toEqual([speedClamp, routeCut]);
    expect(currentAdjustments(markers, platform(2, route(64)))).toEqual([routeCut]);
    expect(currentAdjustments(markers, platform(2, route(3)))).toEqual([]);
    // Same number of points, different points: the route marker is false now.
    expect(currentAdjustments(markers, platform(1000, otherRoute(64)))).toEqual([speedClamp]);
  });

  it('refuses a route correction the written route does not hold, however many points it has', () => {
    expect(nextComponentAdjustments({
      previous: undefined,
      previousFields: undefined,
      nextFields: gameComponentFields(platform(1000, otherRoute(64))),
      corrections: [routeCut],
      supplied: ['waypoints'],
    })).toBeUndefined();
  });

  it('prunes the markers the engine’s latest report no longer bears out', () => {
    let map: GameComponentAdjustments = {};
    map = withComponentAdjustments(map, 'e1', 'movingPlatform', { speed: speedClamp, waypoints: routeCut });
    // Undo restored the speed; the route is still the capped one.
    const pruned = pruneEntityAdjustments(map, 'e1', [platform(2, route(64))]);
    expect(componentAdjustmentsOf(pruned, 'e1', 'movingPlatform')).toEqual({ waypoints: routeCut });
    // The component is gone altogether.
    expect(pruneEntityAdjustments(map, 'e1', [])).toEqual({});
    // Nothing changed: the same map comes back.
    expect(pruneEntityAdjustments(map, 'e1', [platform(1000, route(64))])).toBe(map);
    // Undo put back a different 64-point route; the speed is still the capped one.
    const swapped = pruneEntityAdjustments(map, 'e1', [platform(1000, otherRoute(64))]);
    expect(componentAdjustmentsOf(swapped, 'e1', 'movingPlatform')).toEqual({ speed: speedClamp });
  });
});
