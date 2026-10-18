/**
 * Tests for the shared, versioned game-brief schema and validator
 * (idea.FR-1.OP-01 and idea.FR-1.OP-02, #10174).
 *
 * One contract for manual and AI briefs: `validateBrief` is what the manual
 * editor runs on every edit, and the cross-field checks it reports are the
 * SAME ones the decomposer refines the model's output with. These tests pin
 * the contract from the manual side; `decomposer.test.ts` pins the AI side.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OrchestratorGDD } from '../types';
import { buildPlan } from '../planBuilder';
import {
  BRIEF_ISSUE_CODES,
  BRIEF_LIMITS,
  BRIEF_SCHEMA_VERSION,
  BUILD_BLOCKING_BRIEF_ISSUE_CODES,
  validateBrief,
  zBriefContent,
  zGameBrief,
} from '../briefSchema';
import type { BriefIssue, BriefIssueCode, GameBrief, OpenDecision } from '../briefSchema';
import { COMPLETION_MODES } from '@/lib/playMode/completionMode';

// ---------------------------------------------------------------------------
// Fixture access
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.resolve(__dirname, '../__fixtures__');
const INVALID_DIR = path.join(FIXTURES_DIR, 'invalid');

function readJson(dir: string, file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
}

function listJson(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => entry.name)
    .sort();
}

/** The valid domain fixtures named by #9805 and #9921: one per mode, plus revision 2. */
const IDEA_SCORE3_VALID: Record<string, string> = {
  win: 'idea-score3-v1-win.json',
  endless: 'idea-score3-v1-endless.json',
  sandbox: 'idea-score3-v1-sandbox.json',
  narrative: 'idea-score3-v1-narrative.json',
};
const IDEA_SCORE3_REV2 = 'idea-score3-v1-win-rev2.json';

function errorsOf(issues: readonly BriefIssue[]): BriefIssue[] {
  return issues.filter(issue => issue.severity === 'error');
}

function codesOf(issues: readonly BriefIssue[]): BriefIssueCode[] {
  return issues.map(issue => issue.code);
}

/** `{ code, path }` pairs, sorted, so an assertion is about WHAT was reported and WHERE. */
function located(issues: readonly BriefIssue[]): Array<{ code: BriefIssueCode; path: Array<string | number> }> {
  return issues
    .map(issue => ({ code: issue.code, path: issue.path }))
    .sort((a, b) => `${a.code}:${a.path.join('.')}`.localeCompare(`${b.code}:${b.path.join('.')}`));
}

/** A valid brief to mutate in the unit tests below. */
function validBrief(): GameBrief {
  const result = validateBrief(readJson(FIXTURES_DIR, IDEA_SCORE3_VALID.win));
  if (!result.brief) throw new Error('the win fixture must validate');
  return structuredClone(result.brief);
}

// ---------------------------------------------------------------------------
// The valid fixture family (AC1)
// ---------------------------------------------------------------------------

describe('idea-score3-v1 valid fixtures (idea.FR-1.OP-01)', () => {
  it('covers every completion mode with one fixture each', () => {
    expect(Object.keys(IDEA_SCORE3_VALID).sort()).toEqual([...COMPLETION_MODES].sort());
  });

  it.each([...Object.values(IDEA_SCORE3_VALID), IDEA_SCORE3_REV2])(
    'reports zero error issues and returns the input unchanged: %s',
    file => {
      const input = readJson(FIXTURES_DIR, file);
      const snapshot = structuredClone(input);

      const result = validateBrief(input);

      expect(errorsOf(result.issues)).toEqual([]);
      expect(result.issues).toEqual([]);
      expect(result.brief).toStrictEqual(input);
      // Validation reads; it never writes into the caller's object.
      expect(input).toStrictEqual(snapshot);
    },
  );

  it.each(Object.entries(IDEA_SCORE3_VALID))(
    'the %s fixture states that mode on the brief',
    (mode, file) => {
      const result = validateBrief(readJson(FIXTURES_DIR, file));
      expect(result.brief?.completionMode).toBe(mode);
    },
  );

  it('revision 2 differs from the win brief only in its asset requirement', () => {
    const win = readJson(FIXTURES_DIR, IDEA_SCORE3_VALID.win) as GameBrief;
    const rev2 = readJson(FIXTURES_DIR, IDEA_SCORE3_REV2) as GameBrief;

    expect(rev2.assetManifest).not.toStrictEqual(win.assetManifest);
    expect({ ...rev2, assetManifest: win.assetManifest }).toStrictEqual(win);
  });

  it('carries the five requirements: movement, interaction, one nice-to-have asset, a mode, and ids to trace them by', () => {
    for (const file of Object.values(IDEA_SCORE3_VALID)) {
      const brief = validateBrief(readJson(FIXTURES_DIR, file)).brief;
      if (!brief) throw new Error(`${file} must validate`);

      expect(brief.systems.some(s => s.category === 'movement')).toBe(true);
      expect(brief.systems.some(s => s.category === 'input')).toBe(true);
      expect(brief.scenes.some(s => s.entities.some(e => e.role === 'interactable'))).toBe(true);
      // Exactly one asset, and it is optional on purpose: every asset_generate
      // step fails today, and only a nice-to-have asset is skipped rather
      // than failing the whole plan.
      expect(brief.assetManifest).toHaveLength(1);
      expect(brief.assetManifest[0].priority).toBe('nice-to-have');
      expect(brief.completionMode).toBeDefined();

      // Brief-local ids are the addressing keys #9806 later consumes as
      // requirement ids, so the domain fixture carries one on every item.
      for (const system of brief.systems) expect(system.id).toEqual(expect.any(String));
      for (const scene of brief.scenes) {
        expect(scene.id).toEqual(expect.any(String));
        for (const entity of scene.entities) expect(entity.id).toEqual(expect.any(String));
      }
      for (const asset of brief.assetManifest) expect(asset.id).toEqual(expect.any(String));
    }
  });

  it('is a plan-buildable GDD, and only the win brief gets a win condition (idea.FR-1.OP-04)', () => {
    for (const [mode, file] of Object.entries(IDEA_SCORE3_VALID)) {
      const brief = validateBrief(readJson(FIXTURES_DIR, file)).brief;
      if (!brief) throw new Error(`${file} must validate`);

      // The compile-time half of "one contract": a validated brief IS an
      // OrchestratorGDD, so the manual path feeds the same plan builder the
      // AI path does, with no conversion in between.
      const gdd: OrchestratorGDD = brief;
      const plan = buildPlan(gdd, 'proj-brief', 'pro', 1_000_000);

      const winConditions = plan.steps.filter(
        step => step.executor === 'game_component' && step.input.type === 'winCondition',
      );
      // The #9805 boundary scenario: a sandbox brief compiles without an
      // artificial win condition. Endless and narrative say "no goal" too.
      expect(winConditions.length, `${mode} fixture`).toBe(mode === 'win' ? 1 : 0);
    }
  });
});

// ---------------------------------------------------------------------------
// Every top-level fixture (AC2)
// ---------------------------------------------------------------------------

describe('every top-level fixture through validateBrief', () => {
  const fixtureFiles = listJson(FIXTURES_DIR);

  /**
   * The pre-move `superRefine` in `decomposer.ts` (2218e9be1), restated: a
   * movement system with no `player` entity in any scene is rejected. The
   * verdict `validateBrief` reaches must match this for every fixture.
   */
  function preMoveMovementVerdict(gdd: OrchestratorGDD): boolean {
    if (!gdd.systems.some(s => s.category === 'movement')) return false;
    return !gdd.scenes.some(scene => scene.entities.some(entity => entity.role === 'player'));
  }

  /**
   * Reviewed expectation table: every issue code a fixture reports, other
   * than the movement verdict checked separately above. A fixture that is
   * not listed here fails, and an entry with no fixture fails too, so the
   * table and the directory cannot drift apart.
   */
  const EXPECTED_OTHER_CODES: Record<string, BriefIssueCode[]> = {
    '2d-sprite-game.json': [],
    'adversarial-prompt.json': [],
    'arena-combat.json': [],
    'cozy-farming.json': [],
    'exploration-puzzle.json': [],
    'idea-score3-v1-endless.json': [],
    'idea-score3-v1-narrative.json': [],
    'idea-score3-v1-sandbox.json': [],
    'idea-score3-v1-win-rev2.json': [],
    'idea-score3-v1-win.json': [],
    // Its "CitySquare" music track names a scene, not an entity. The plan
    // builder has always let that through; the validator now says so.
    'narrative-adventure.json': ['ENTITY_REF_MISSING'],
    'rhythm-platformer.json': [],
    'sandbox-creative.json': [],
    'single-system.json': [],
    'twenty-systems.json': [],
    'vague-prompt.json': [],
    'zero-movement.json': [],
  };

  it('reads the whole corpus and the table covers exactly that corpus', () => {
    // The twelve pre-existing fixtures plus the five idea-score3-v1 briefs.
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(17);
    expect(Object.keys(EXPECTED_OTHER_CODES).sort()).toEqual(fixtureFiles);
  });

  it.each(fixtureFiles)('matches the pre-move movement verdict and the reviewed table: %s', file => {
    const input = readJson(FIXTURES_DIR, file);

    const result = validateBrief(input);

    // Every fixture is structurally a brief: the legacy ones have no
    // `briefVersion`, which reads as version 1.
    expect(result.brief).not.toBeNull();
    const codes = codesOf(result.issues);
    expect(codes.includes('MOVEMENT_WITHOUT_PLAYER')).toBe(
      preMoveMovementVerdict(input as OrchestratorGDD),
    );
    expect(codes.filter(code => code !== 'MOVEMENT_WITHOUT_PLAYER')).toEqual(
      EXPECTED_OTHER_CODES[file],
    );
  });
});

// ---------------------------------------------------------------------------
// The invalid fixtures (AC3)
// ---------------------------------------------------------------------------

describe('invalid idea-score3-v1 fixtures (idea.FR-1 failure case)', () => {
  it('keeps the invalid variants out of the top-level sweep', () => {
    expect(listJson(INVALID_DIR)).toEqual([
      'idea-score3-v1-contradictory.json',
      'idea-score3-v1-cyclic.json',
      'idea-score3-v1-invalid.json',
    ]);
  });

  it.each(listJson(INVALID_DIR))('reports at least one error without throwing: %s', file => {
    const result = validateBrief(readJson(INVALID_DIR, file));
    expect(errorsOf(result.issues).length).toBeGreaterThan(0);
  });

  it('reports one error per problem, each on its exact field', () => {
    const result = validateBrief(readJson(INVALID_DIR, 'idea-score3-v1-invalid.json'));

    // The shape is fine, so the brief is returned alongside its problems:
    // an editor has to be able to hold a brief while the person fixes it.
    expect(result.brief).not.toBeNull();
    expect(located(errorsOf(result.issues))).toEqual([
      // movement -> camera -> movement: the walk leaves movement for camera
      // and meets movement again on camera's `dependsOn`, so the edge that
      // CLOSES the cycle is systems[1] (camera) .dependsOn[0] (movement).
      { code: 'DEPENDENCY_CYCLE', path: ['systems', 1, 'dependsOn', 0] },
      // the SECOND "Yard" is the duplicate; the first keeps its name
      { code: 'DUPLICATE_SCENE_NAME', path: ['scenes', 1, 'name'] },
      // the same path the pre-move superRefine used
      { code: 'MOVEMENT_WITHOUT_PLAYER', path: ['scenes'] },
    ]);
    for (const issue of result.issues) {
      expect(issue.severity).toBe('error');
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });

  it('reports the cycle buildPlan throws on, through the same detector', () => {
    const input = readJson(INVALID_DIR, 'idea-score3-v1-cyclic.json');
    const result = validateBrief(input);

    // The closing edge: camera (systems[2]) depending on movement.
    expect(located(result.issues)).toEqual([
      { code: 'DEPENDENCY_CYCLE', path: ['systems', 2, 'dependsOn', 0] },
    ]);
    expect(result.issues[0].message).toContain('movement -> camera -> movement');

    // The plan builder refuses the same brief, naming the same path.
    expect(() => buildPlan(input as OrchestratorGDD, 'proj', 'pro', 1_000_000)).toThrow(
      'Cyclic system dependency detected: movement -> camera -> movement',
    );
  });

  it('reports a sandbox brief whose progression system would plan a goal', () => {
    const input = readJson(INVALID_DIR, 'idea-score3-v1-contradictory.json');
    const result = validateBrief(input);

    expect(located(result.issues)).toEqual([
      { code: 'COMPLETION_MODE_CONFLICT', path: ['systems', 4] },
    ]);
    expect(result.issues[0].message).toMatch(/sandbox/);

    // Why it is a contradiction and not a matter of taste: built as is, the
    // sandbox gets exactly the artificial win condition the mode rules out.
    const plan = buildPlan(input as OrchestratorGDD, 'proj', 'pro', 1_000_000);
    expect(
      plan.steps.some(step => step.executor === 'game_component' && step.input.type === 'winCondition'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Size caps (AC4)
// ---------------------------------------------------------------------------

describe('size caps', () => {
  it('admits a 100-system design (N1) and the cap is explicit', () => {
    expect(BRIEF_LIMITS.systems).toBeGreaterThanOrEqual(100);

    const brief = validBrief();
    const template = brief.systems[0];
    brief.systems = Array.from({ length: 100 }, (_, i) => ({
      ...template,
      id: `sys-${i}`,
      type: `walk-${i}`,
    }));

    const result = validateBrief(brief);
    expect(result.brief?.systems).toHaveLength(100);
    expect(codesOf(result.issues)).not.toContain('LIMIT_EXCEEDED');
  });

  it('names the field and truncates nothing when there are more systems than the cap', () => {
    const brief = validBrief();
    const template = brief.systems[0];
    const count = BRIEF_LIMITS.systems + 1;
    brief.systems = Array.from({ length: count }, (_, i) => ({ ...template, id: `sys-${i}` }));

    const result = validateBrief(brief);

    expect(result.brief).toBeNull();
    expect(located(result.issues)).toEqual([{ code: 'LIMIT_EXCEEDED', path: ['systems'] }]);
    expect(result.issues[0].message).toContain(String(BRIEF_LIMITS.systems));
    // The input is reported on, never cut down to fit.
    expect(brief.systems).toHaveLength(count);
  });

  it('names the field for an over-length description', () => {
    const brief = validBrief();
    brief.description = 'x'.repeat(BRIEF_LIMITS.description + 1);

    const result = validateBrief(brief);

    expect(result.brief).toBeNull();
    expect(located(result.issues)).toEqual([{ code: 'LIMIT_EXCEEDED', path: ['description'] }]);
    expect(brief.description).toHaveLength(BRIEF_LIMITS.description + 1);
  });

  it('caps the open-decision list', () => {
    const brief = validBrief();
    brief.openDecisions = Array.from({ length: BRIEF_LIMITS.openDecisions + 1 }, (_, i) => ({
      id: `decision-${i}`,
      path: 'systems.0.type',
      question: 'Walk or run?',
      options: ['walk', 'run'],
    }));

    const result = validateBrief(brief);

    expect(result.brief).toBeNull();
    expect(located(result.issues)).toEqual([{ code: 'LIMIT_EXCEEDED', path: ['openDecisions'] }]);
  });

  it.each<[string, (brief: GameBrief) => void, Array<string | number>]>([
    [
      'entitiesPerScene',
      brief => {
        brief.scenes[0].entities = Array.from({ length: BRIEF_LIMITS.entitiesPerScene + 1 }, (_, i) => ({
          ...brief.scenes[0].entities[0],
          id: `ent-${i}`,
          name: `Lantern ${i}`,
        }));
      },
      ['scenes', 0, 'entities'],
    ],
    [
      'transitionsPerScene',
      brief => {
        brief.scenes[0].transitions = Array.from({ length: BRIEF_LIMITS.transitionsPerScene + 1 }, () => ({
          to: 'Yard',
          trigger: 'loop',
        }));
      },
      ['scenes', 0, 'transitions'],
    ],
    ['id, on the brief', brief => { brief.id = 'x'.repeat(BRIEF_LIMITS.id + 1); }, ['id']],
    ['id, on an item', brief => { brief.systems[0].id = 'x'.repeat(BRIEF_LIMITS.id + 1); }, ['systems', 0, 'id']],
    [
      'dependsOn',
      brief => {
        brief.systems[0].dependsOn = Array.from({ length: BRIEF_LIMITS.dependsOn + 1 }, () => 'physics' as const);
      },
      ['systems', 0, 'dependsOn'],
    ],
    [
      'decisionOptions',
      brief => {
        brief.openDecisions = [{
          id: 'd1',
          path: 'systems.0.type',
          question: 'Walk or run?',
          options: Array.from({ length: BRIEF_LIMITS.decisionOptions + 1 }, (_, i) => `option ${i}`),
        }];
      },
      ['openDecisions', 0, 'options'],
    ],
    [
      'decisionPath',
      brief => {
        brief.openDecisions = [{ id: 'd1', path: 'x'.repeat(BRIEF_LIMITS.decisionPath + 1), question: 'Walk or run?', options: ['walk'] }];
      },
      ['openDecisions', 0, 'path'],
    ],
    [
      'decisionText',
      brief => {
        brief.openDecisions = [{ id: 'd1', path: 'systems.0.type', question: 'x'.repeat(BRIEF_LIMITS.decisionText + 1), options: ['walk'] }];
      },
      ['openDecisions', 0, 'question'],
    ],
  ])('names the field for a %s over its cap', (_cap, mutate, path) => {
    const brief = validBrief();
    mutate(brief);

    const result = validateBrief(brief);

    expect(result.brief).toBeNull();
    expect(located(result.issues)).toEqual([{ code: 'LIMIT_EXCEEDED', path }]);
  });

  it('names the field for an oversized dependsOn list, and never throws on one', () => {
    // There are twelve categories, so a list this long is not a design, it is
    // a payload. Before the cap existed a million-entry `dependsOn` on a
    // system that shares its category with another reached the cycle
    // detector, whose edge merge was a spread into `push(...)` — a RangeError
    // thrown from OUTSIDE validateBrief's try/catch, from a function that is
    // documented to never throw. (A million rather than the ~150k that
    // overflows Node's main thread because vitest's worker threads get a
    // bigger stack, ~800k; the test has to be red in both.)
    const brief = validBrief();
    const movement = brief.systems[0];
    const huge = new Array<typeof movement.dependsOn[number]>(1_000_000).fill('physics');
    brief.systems = [movement, { ...movement, id: 'sys-movement-2', type: 'swim', dependsOn: huge }];

    let result: ReturnType<typeof validateBrief> | undefined;
    expect(() => {
      result = validateBrief(brief);
    }).not.toThrow();

    expect(result?.brief).toBeNull();
    expect(located(result?.issues ?? [])).toEqual([
      { code: 'LIMIT_EXCEEDED', path: ['systems', 1, 'dependsOn'] },
    ]);
    expect(result?.issues[0]?.message).toContain(String(BRIEF_LIMITS.dependsOn));
    // The input is reported on, never cut down to fit.
    expect(brief.systems[1].dependsOn).toHaveLength(1_000_000);
  });
});

// ---------------------------------------------------------------------------
// Versioning, shape errors and never-throw
// ---------------------------------------------------------------------------

describe('versioning and shape', () => {
  it('is version 1, and a brief that states no version reads as version 1', () => {
    expect(BRIEF_SCHEMA_VERSION).toBe(1);

    const brief: Partial<GameBrief> = validBrief();
    delete brief.briefVersion;

    const result = validateBrief(brief);
    expect(result.issues).toEqual([]);
    expect(result.brief?.briefVersion).toBe(1);
  });

  it('refuses a newer version with UNSUPPORTED_VERSION rather than guessing at it', () => {
    const brief = validBrief() as Record<string, unknown>;
    brief.briefVersion = 2;

    const result = validateBrief(brief);

    expect(result.brief).toBeNull();
    expect(located(result.issues)).toEqual([{ code: 'UNSUPPORTED_VERSION', path: ['briefVersion'] }]);
  });

  it.each([null, undefined, 'a brief', 42, [], true])('never throws on non-brief input %s', input => {
    const result = validateBrief(input);
    expect(result.brief).toBeNull();
    expect(located(result.issues)).toEqual([{ code: 'SCHEMA', path: [] }]);
  });

  it('answers SCHEMA on the brief itself when reading the value throws', () => {
    // Zod rethrows a throwing getter rather than reporting it as an issue, so
    // "never throws" is only true if validateBrief catches it. Both a getter
    // and a Proxy, because they throw at different points of the read.
    const hostileGetter = {
      ...validBrief(),
      get title(): string {
        throw new Error('hostile getter');
      },
    };
    const hostileProxy = new Proxy(validBrief(), {
      get() {
        throw new Error('hostile proxy');
      },
    });

    for (const input of [hostileGetter, hostileProxy]) {
      let result: ReturnType<typeof validateBrief> | undefined;
      expect(() => {
        result = validateBrief(input);
      }).not.toThrow();
      expect(result?.brief).toBeNull();
      expect(located(result?.issues ?? [])).toEqual([{ code: 'SCHEMA', path: [] }]);
    }
  });

  it('reports a shape error on the exact field', () => {
    const brief = validBrief();
    (brief.scenes[0].entities[0] as { role: string }).role = 'boss';

    const result = validateBrief(brief);

    expect(result.brief).toBeNull();
    expect(located(result.issues)).toEqual([
      { code: 'SCHEMA', path: ['scenes', 0, 'entities', 0, 'role'] },
    ]);
  });

  it('exports the closed list of issue codes, and the validator emits exactly those', () => {
    // One input per producer. Every code the validator can emit must be in
    // the exported list (a UI keys copy by it), and every exported code must
    // have a producer here (a code nothing emits is a code with no meaning).
    const withDanglingTransition = validBrief();
    withDanglingTransition.scenes[0].transitions = [{ to: 'Cellar', trigger: 'trapdoor' }];
    const withGhostRef = validBrief();
    withGhostRef.assetManifest[0].entityRef = 'Ghost';
    const withDecision = validBrief();
    withDecision.openDecisions = [{ id: 'd1', path: 'systems.0.type', question: 'Walk or float?', options: ['walk', 'float'] }];
    const withDuplicateId = validBrief();
    withDuplicateId.systems[1].id = withDuplicateId.systems[0].id;
    const tooManySystems = validBrief();
    tooManySystems.systems = Array.from({ length: BRIEF_LIMITS.systems + 1 }, (_, i) => ({ ...tooManySystems.systems[0], id: `sys-${i}` }));

    const inputs: unknown[] = [
      ...listJson(INVALID_DIR).map(file => readJson(INVALID_DIR, file)),
      'not a brief',
      { ...validBrief(), briefVersion: 2 },
      tooManySystems,
      withDanglingTransition,
      withGhostRef,
      withDecision,
      withDuplicateId,
    ];

    const emitted = new Set<BriefIssueCode>();
    for (const input of inputs) {
      for (const issue of validateBrief(input).issues) emitted.add(issue.code);
    }

    expect(emitted.size).toBeGreaterThan(0);
    for (const code of emitted) expect(BRIEF_ISSUE_CODES).toContain(code);
    expect([...emitted].sort()).toEqual([...BRIEF_ISSUE_CODES].sort());
    expect(new Set(BRIEF_ISSUE_CODES).size).toBe(BRIEF_ISSUE_CODES.length);
  });

  it('builds zGameBrief from the leaf schemas zBriefContent uses, not copies of them', () => {
    // Same object references: a change to a leaf reaches both the provider
    // shape and the brief, which is what "one contract" means at the schema
    // level. `title` and friends are pinned by identity, not by behaviour.
    expect(zGameBrief.shape.title).toBe(zBriefContent.shape.title);
    expect(zGameBrief.shape.estimatedScope).toBe(zBriefContent.shape.estimatedScope);
    expect(zGameBrief.shape.styleDirective).toBe(zBriefContent.shape.styleDirective);
    expect(zGameBrief.shape.completionMode).toBe(zBriefContent.shape.completionMode);

    // The objects the brief makes STRICT are copies of the leaf (`.strict()`
    // or `.extend().strict()`) — but a copy that keeps the leaf's FIELDS by
    // reference (Zod clones the `shape` container, not the schemas in it), so
    // each field is still the provider's own schema and a change to one still
    // reaches both sides. Walked over the leaf's keys, and the walk must be
    // non-empty: a zero-key loop would pin nothing.
    expect(zGameBrief.shape.feelDirective).not.toBe(zBriefContent.shape.feelDirective);
    const feelFields = Object.keys(zBriefContent.shape.feelDirective.shape);
    expect(feelFields.length).toBeGreaterThan(0);
    expect(Object.keys(zGameBrief.shape.feelDirective.shape)).toEqual(feelFields);
    for (const field of feelFields) {
      expect(
        (zGameBrief.shape.feelDirective.shape as Record<string, unknown>)[field],
        `feelDirective.${field}`,
      ).toBe((zBriefContent.shape.feelDirective.shape as Record<string, unknown>)[field]);
    }
    const content = zBriefContent.shape;
    const brief = zGameBrief.shape;
    expect(brief.systems.element.shape.category).toBe(content.systems.element.shape.category);
    expect(brief.scenes.element.shape.name).toBe(content.scenes.element.shape.name);
    expect(brief.scenes.element.shape.entities.element.shape.role).toBe(
      content.scenes.element.shape.entities.element.shape.role,
    );
    expect(brief.scenes.element.shape.transitions.element.shape.to).toBe(
      content.scenes.element.shape.transitions.element.shape.to,
    );
    expect(brief.assetManifest.element.shape.fallback).toBe(content.assetManifest.element.shape.fallback);
  });

  it('reports an unknown root field as SCHEMA on that field rather than dropping it', () => {
    // The field an author misspelled. Before the brief was strict,
    // `styleDirectve` validated and the returned brief had silently lost the
    // author's text — a validator that will back persistence (#10176) must
    // not do that (Devin review of 14f543b6). Both halves are reported, the
    // typo as an unknown field and the real field as missing, so the author
    // sees exactly what happened to the data.
    const brief = validBrief() as Record<string, unknown>;
    brief.styleDirectve = brief.styleDirective;
    delete brief.styleDirective;

    let result: ReturnType<typeof validateBrief> | undefined;
    expect(() => {
      result = validateBrief(brief);
    }).not.toThrow();

    expect(result?.brief).toBeNull();
    expect(located(result?.issues ?? [])).toEqual([
      { code: 'SCHEMA', path: ['styleDirective'] },
      { code: 'SCHEMA', path: ['styleDirectve'] },
    ]);
    const unknown = result?.issues.find(issue => issue.path[0] === 'styleDirectve');
    expect(unknown?.message).toContain('"styleDirectve"');
  });

  it.each<[string, (brief: GameBrief) => void, Array<string | number>]>([
    ['system', brief => { (brief.systems[0] as Record<string, unknown>).priorty = 'core'; }, ['systems', 0, 'priorty']],
    ['scene', brief => { (brief.scenes[0] as Record<string, unknown>).purpos = 'The yard'; }, ['scenes', 0, 'purpos']],
    [
      // `behaviors` is the field PF-1111 removed from entities: exactly the
      // key an older hand-written brief would still carry.
      'entity',
      brief => { (brief.scenes[0].entities[0] as Record<string, unknown>).behaviors = ['wander']; },
      ['scenes', 0, 'entities', 0, 'behaviors'],
    ],
    [
      'transition',
      brief => {
        brief.scenes[0].transitions = [
          { to: 'Yard', trigger: 'loop', triger: 'loop' } as GameBrief['scenes'][number]['transitions'][number],
        ];
      },
      ['scenes', 0, 'transitions', 0, 'triger'],
    ],
    ['asset need', brief => { (brief.assetManifest[0] as Record<string, unknown>).styleDirectve = 'warm'; }, ['assetManifest', 0, 'styleDirectve']],
    ['feel directive', brief => { (brief.feelDirective as Record<string, unknown>).paceing = 'slow'; }, ['feelDirective', 'paceing']],
    [
      'open decision',
      brief => {
        brief.openDecisions = [
          { id: 'd1', path: 'systems.0.type', question: 'Walk or run?', options: ['walk'], answr: 'walk' } as OpenDecision,
        ];
      },
      ['openDecisions', 0, 'answr'],
    ],
  ])('reports an unknown field inside a %s as SCHEMA on that field', (_kind, mutate, path) => {
    // Every nested object, not only the root: strictness that stopped at the
    // root would still drop a misspelled field inside a scene. The path is
    // the KEY's path, so an editor can focus the field the author typed.
    const brief = validBrief();
    mutate(brief);

    const result = validateBrief(brief);

    expect(result.brief).toBeNull();
    expect(located(result.issues)).toEqual([{ code: 'SCHEMA', path }]);
    expect(result.issues[0].message).toContain(`"${String(path[path.length - 1])}"`);
  });
});

// ---------------------------------------------------------------------------
// Cross-field checks, one at a time
// ---------------------------------------------------------------------------

describe('cross-field checks', () => {
  it('reports a transition to a scene that does not exist', () => {
    const brief = validBrief();
    brief.scenes[0].transitions = [
      { to: 'Yard', trigger: 'loop' },
      { to: 'Cellar', trigger: 'trapdoor' },
    ];

    const result = validateBrief(brief);

    expect(located(result.issues)).toEqual([
      { code: 'TRANSITION_TARGET_MISSING', path: ['scenes', 0, 'transitions', 1, 'to'] },
    ]);
    expect(result.issues[0].message).toContain('Cellar');
  });

  it('reports an asset entityRef that names no entity, in any scene', () => {
    const brief = validBrief();
    brief.scenes.push({
      ...structuredClone(brief.scenes[0]),
      id: 'scene-shed',
      name: 'Shed',
      entities: [{ id: 'ent-bucket', name: 'Bucket', role: 'decoration', systems: [], appearance: 'primitive:cylinder' }],
    });
    brief.assetManifest = [
      { ...brief.assetManifest[0], id: 'asset-bucket', entityRef: 'Bucket' },
      { ...brief.assetManifest[0], id: 'asset-ghost', entityRef: 'Ghost' },
      { ...brief.assetManifest[0], id: 'asset-free', entityRef: undefined },
    ];

    const result = validateBrief(brief);

    expect(located(result.issues)).toEqual([
      { code: 'ENTITY_REF_MISSING', path: ['assetManifest', 1, 'entityRef'] },
    ]);
    expect(result.issues[0].message).toContain('Ghost');
  });

  it('reports a movement system with no player entity in any scene', () => {
    const brief = validBrief();
    brief.scenes[0].entities = brief.scenes[0].entities.filter(e => e.role !== 'player');

    const result = validateBrief(brief);

    expect(located(result.issues)).toEqual([{ code: 'MOVEMENT_WITHOUT_PLAYER', path: ['scenes'] }]);
    expect(result.issues[0].message).toMatch(/player/);
  });

  it('does not report a missing player when there is no movement system', () => {
    const brief = validBrief();
    brief.systems = brief.systems.filter(s => s.category !== 'movement');
    brief.scenes[0].entities = brief.scenes[0].entities.filter(e => e.role !== 'player');

    expect(validateBrief(brief).issues).toEqual([]);
  });

  it('reports a dependency cycle on the dependsOn entry that CLOSES it, not the first edge', () => {
    // movement -> camera -> world -> movement. The walk starts at movement
    // (array order) and meets movement again on world's `dependsOn`, so the
    // closing edge is world's entry — the last system in the cycle, which a
    // first-edge report (movement's entry) would never name. Pins the choice
    // documented on `cycleEdgePath` (round 1 m3).
    const brief = validBrief();
    const [movement, input, camera, world] = brief.systems;
    brief.systems = [
      { ...movement, dependsOn: ['camera'] },
      input,
      { ...camera, dependsOn: ['world'] },
      { ...world, dependsOn: ['physics', 'movement'] },
    ];

    const result = validateBrief(brief);

    expect(located(result.issues)).toEqual([
      { code: 'DEPENDENCY_CYCLE', path: ['systems', 3, 'dependsOn', 1] },
    ]);
    expect(result.issues[0].message).toContain('movement -> camera -> world -> movement');
  });

  it('reports every later scene that reuses an earlier name, on its name field', () => {
    const brief = validBrief();
    const yard = brief.scenes[0];
    // Fresh ids on the copies and their entities: this case is about the
    // NAME, and reused ids are a separate issue (DUPLICATE_ITEM_ID).
    const copyOf = (suffix: string) => {
      const copy = structuredClone(yard);
      copy.id = `${yard.id}-${suffix}`;
      copy.entities = copy.entities.map(entity => ({ ...entity, id: `${entity.id}-${suffix}` }));
      return copy;
    };
    brief.scenes = [yard, copyOf('2'), copyOf('3')];

    const result = validateBrief(brief);

    expect(located(result.issues)).toEqual([
      { code: 'DUPLICATE_SCENE_NAME', path: ['scenes', 1, 'name'] },
      { code: 'DUPLICATE_SCENE_NAME', path: ['scenes', 2, 'name'] },
    ]);
  });

  it.each([
    ['sandbox', true],
    ['endless', true],
    ['narrative', false],
    ['win', false],
  ] as const)('completion mode %s with a progression system is a conflict: %s', (mode, conflicts) => {
    const brief = validBrief();
    brief.completionMode = mode;
    brief.systems.push({
      id: 'sys-progression',
      category: 'progression',
      type: 'levels',
      config: {},
      priority: 'secondary',
      dependsOn: [],
    });

    const result = validateBrief(brief);

    expect(located(result.issues)).toEqual(
      conflicts ? [{ code: 'COMPLETION_MODE_CONFLICT', path: ['systems', 4] }] : [],
    );
  });

  it('does not report a conflict for a goal-free mode without a progression system', () => {
    const brief = validBrief();
    brief.completionMode = 'sandbox';
    expect(validateBrief(brief).issues).toEqual([]);
  });

  it('reports a goal-free conflict only once progression has something to win with', () => {
    // `systems/progression.ts` plans no win condition for an empty world — it
    // drops every step and warns — so a sandbox brief that declares progression
    // and places nothing is built exactly as the mode asks, and flagging it
    // would send the author to fix a contradiction the build never produces
    // (Devin review of 14f543b6). The invariant asks the SAME predicate the
    // planner does, `progressionPlansWinCondition`, and the plan built from
    // each brief below is the evidence that the two agree.
    const brief = validBrief();
    brief.completionMode = 'sandbox';
    // No movement system (it would need a player) and no asset entityRef (it
    // would need an entity): this case is about the world being EMPTY.
    brief.systems = brief.systems.filter(s => s.category !== 'movement');
    brief.systems.push({
      id: 'sys-progression',
      category: 'progression',
      type: 'levels',
      config: {},
      priority: 'secondary',
      dependsOn: [],
    });
    for (const scene of brief.scenes) scene.entities = [];
    for (const asset of brief.assetManifest) delete asset.entityRef;
    const progressionIndex = brief.systems.length - 1;

    const empty = validateBrief(brief);
    expect(empty.brief).not.toBeNull();
    expect(empty.issues).toEqual([]);
    const emptyPlan = buildPlan(brief, 'proj', 'pro', 1_000_000);
    expect(
      emptyPlan.steps.some(step => step.executor === 'game_component' && step.input.type === 'winCondition'),
    ).toBe(false);

    // One entity anywhere is enough for progression to plan the goal the
    // mode refuses — and so enough for the conflict.
    brief.scenes[0].entities = [
      { id: 'ent-crate', name: 'Crate', role: 'decoration', systems: [], appearance: 'primitive:cube' },
    ];

    const one = validateBrief(brief);
    expect(located(one.issues)).toEqual([
      { code: 'COMPLETION_MODE_CONFLICT', path: ['systems', progressionIndex] },
    ]);
    const onePlan = buildPlan(brief, 'proj', 'pro', 1_000_000);
    expect(
      onePlan.steps.some(step => step.executor === 'game_component' && step.input.type === 'winCondition'),
    ).toBe(true);
  });

  it('reports a later item that reuses an id, on its id field, across every item kind', () => {
    // Item ids are the addressing keys #9806 consumes as requirement ids, so
    // an id resolves to exactly one item: systems, scenes, entities, assets
    // and open decisions share ONE namespace. The later use is the one
    // reported; the first keeps the id (round 1 m7).
    const brief = validBrief();
    brief.systems[1].id = 'sys-movement'; // a second system
    brief.scenes[0].entities[1].id = 'sys-camera'; // an entity reusing a system id
    brief.assetManifest[0].id = 'ent-keeper'; // an asset reusing an entity id
    brief.openDecisions = [{ id: 'scene-yard', path: 'scenes.0', question: 'Bigger?', options: ['yes'] }]; // a decision reusing a scene id

    const result = validateBrief(brief);

    expect(result.brief).not.toBeNull();
    expect(located(errorsOf(result.issues))).toEqual([
      { code: 'DUPLICATE_ITEM_ID', path: ['assetManifest', 0, 'id'] },
      { code: 'DUPLICATE_ITEM_ID', path: ['openDecisions', 0, 'id'] },
      { code: 'DUPLICATE_ITEM_ID', path: ['scenes', 0, 'entities', 1, 'id'] },
      { code: 'DUPLICATE_ITEM_ID', path: ['systems', 1, 'id'] },
    ]);
    const onSystem = result.issues.find(issue => issue.path[0] === 'systems');
    expect(onSystem?.message).toContain('sys-movement');
    expect(onSystem?.message).toContain('systems.0');
  });

  it('does not treat items with no id, or the brief id, as duplicates', () => {
    const anonymous = validBrief();
    for (const system of anonymous.systems) delete system.id;
    for (const scene of anonymous.scenes) {
      delete scene.id;
      for (const entity of scene.entities) delete entity.id;
    }
    for (const asset of anonymous.assetManifest) delete asset.id;
    expect(validateBrief(anonymous).issues).toEqual([]);

    // The brief's own id names the brief, not an item in it.
    const sameAsBrief = validBrief();
    sameAsBrief.systems[0].id = sameAsBrief.id;
    expect(validateBrief(sameAsBrief).issues).toEqual([]);
  });

  it('keeps duplicate item ids out of the AI gate: the provider shape carries no ids', () => {
    expect(BUILD_BLOCKING_BRIEF_ISSUE_CODES).not.toContain('DUPLICATE_ITEM_ID');
    expect('id' in zBriefContent.shape.systems.element.shape).toBe(false);
  });

  it('reports each open decision as a decision issue, never an error', () => {
    const brief = validBrief();
    brief.openDecisions = [
      { id: 'd1', path: 'systems.0.type', question: 'Does the keeper walk or float?', options: ['walk', 'float'] },
      { id: 'd2', path: 'scenes.0.entities', question: 'How many lanterns?', options: ['three', 'seven'] },
    ];

    const result = validateBrief(brief);

    expect(result.brief).not.toBeNull();
    expect(errorsOf(result.issues)).toEqual([]);
    expect(located(result.issues)).toEqual([
      { code: 'OPEN_DECISION', path: ['openDecisions', 0] },
      { code: 'OPEN_DECISION', path: ['openDecisions', 1] },
    ]);
    expect(result.issues.map(issue => issue.severity)).toEqual(['decision', 'decision']);
    expect(result.issues[0].message).toContain('walk or float');
  });
});
