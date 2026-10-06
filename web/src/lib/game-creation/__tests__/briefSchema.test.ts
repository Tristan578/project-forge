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
  validateBrief,
  zBriefContent,
  zGameBrief,
} from '../briefSchema';
import type { BriefIssue, BriefIssueCode, GameBrief } from '../briefSchema';
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
      // movement -> camera -> movement, closed by systems[0].dependsOn[0]
      { code: 'DEPENDENCY_CYCLE', path: ['systems', 0, 'dependsOn', 0] },
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

    expect(located(result.issues)).toEqual([
      { code: 'DEPENDENCY_CYCLE', path: ['systems', 0, 'dependsOn', 0] },
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

  it('reports a shape error on the exact field', () => {
    const brief = validBrief();
    (brief.scenes[0].entities[0] as { role: string }).role = 'boss';

    const result = validateBrief(brief);

    expect(result.brief).toBeNull();
    expect(located(result.issues)).toEqual([
      { code: 'SCHEMA', path: ['scenes', 0, 'entities', 0, 'role'] },
    ]);
  });

  it('exports the closed list of issue codes, and every code is one of them', () => {
    expect(BRIEF_ISSUE_CODES).toContain('LIMIT_EXCEEDED');
    expect(new Set(BRIEF_ISSUE_CODES).size).toBe(BRIEF_ISSUE_CODES.length);
  });

  it('builds zGameBrief from the leaf schemas zBriefContent uses, not copies of them', () => {
    // Same object references: a change to a leaf reaches both the provider
    // shape and the brief, which is what "one contract" means at the schema
    // level. `title` and friends are pinned by identity, not by behaviour.
    expect(zGameBrief.shape.title).toBe(zBriefContent.shape.title);
    expect(zGameBrief.shape.feelDirective).toBe(zBriefContent.shape.feelDirective);
    expect(zGameBrief.shape.estimatedScope).toBe(zBriefContent.shape.estimatedScope);
    expect(zGameBrief.shape.styleDirective).toBe(zBriefContent.shape.styleDirective);
    expect(zGameBrief.shape.completionMode).toBe(zBriefContent.shape.completionMode);
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

  it('reports every later scene that reuses an earlier name, on its name field', () => {
    const brief = validBrief();
    const yard = brief.scenes[0];
    brief.scenes = [yard, { ...structuredClone(yard), id: 'scene-2' }, { ...structuredClone(yard), id: 'scene-3' }];

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
