import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { TOOLTIP_DICTIONARY } from '../tooltipDictionary';
import { ENGINE_CAMERA_DEFAULTS } from '@/lib/game/gameCameraPayload';

/**
 * Classify every JSX `term` attribute in a TSX source. A string literal in any
 * spelling (`term="x"`, `term={"x"}`, `term={'x'}`, a template with no
 * substitutions) resolves to its value. `term={term}` inside a function
 * declaration is that component passing its own prop through, reported by the
 * component's name. Anything else is unresolved, so the caller fails on it
 * instead of skipping it.
 */
function scanTermAttributes(text: string) {
  const sf = ts.createSourceFile('scan.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const terms: string[] = [];
  const passThrough: string[] = [];
  const unresolved: string[] = [];

  const enclosingFunctionName = (node: ts.Node): string | undefined => {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
      if (ts.isFunctionDeclaration(n)) return n.name?.text;
    }
    return undefined;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'term') {
      const init = node.initializer;
      const expr = init && ts.isJsxExpression(init) ? init.expression : init;
      const owner = enclosingFunctionName(node);
      if (expr && (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr))) {
        terms.push(expr.text);
      } else if (expr && ts.isIdentifier(expr) && expr.text === 'term' && owner) {
        passThrough.push(owner);
      } else {
        unresolved.push(node.getText(sf));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { terms, passThrough, unresolved };
}

describe('scanTermAttributes', () => {
  // The scanner is the gate below, so prove it can see each spelling and can
  // report a site it does not understand (lessons-learned #11).
  it('resolves every literal spelling and names what it cannot resolve', () => {
    const scan = scanTermAttributes(
      [
        'function Row({ term }: { term: string }) { return <InfoTooltip term={term} />; }',
        'export function P() {',
        '  const k = "c";',
        '  return (<>',
        '    <InfoTooltip term="a" />',
        "    <InfoTooltip term={'b'} />",
        '    <InfoTooltip term={"c"} />',
        '    <InfoTooltip term={`d`} />',
        '    <InfoTooltip term={k} />',
        '    <InfoTooltip term={`x${k}`} />',
        '  </>);',
        '}',
      ].join('\n'),
    );
    expect(scan.terms).toEqual(['a', 'b', 'c', 'd']);
    expect(scan.passThrough).toEqual(['Row']);
    expect(scan.unresolved).toEqual(['term={k}', 'term={`x${k}`}']);
  });
});

describe('TOOLTIP_DICTIONARY', () => {
  /**
   * `InfoTooltip` returns null for a term the dictionary lacks, so a panel can
   * reference a dozen terms and render no help at all with nothing failing.
   * `GameCameraInspector` did exactly that (review-board finding on #10295):
   * every one of its twelve `term="gameCamera…"` props was unknown. Scanning
   * the source rather than listing the terms here means a term added to the
   * panel without a definition fails on its own, with no test to remember.
   */
  it('defines every term GameCameraInspector references', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', '..', 'components', 'editor', 'GameCameraInspector.tsx'),
      'utf8',
    );
    const scan = scanTermAttributes(source);

    // A text regex for `term="…"` alone missed `term={"…"}`: two sites
    // rewritten that way dropped out of the scan while a `>= 10` floor stayed
    // satisfied, and their undefined terms went unchecked (review-board round
    // 3 on #10295). Reading the JSX tree classifies every attribute, so a form
    // the scan cannot resolve is named here instead of skipped.
    expect(scan.unresolved, 'term= attributes whose value is not a string literal').toEqual([]);
    // The one non-literal site: NumberParamRow handing its own prop to
    // InfoTooltip. Its values are the literal `term=` on each row.
    expect(scan.passThrough).toEqual(['NumberParamRow']);
    // Cross-check against the raw text, so a `term=` the tree walk did not
    // classify (a new attribute shape, a parse that lost part of the file)
    // fails rather than shrinking the scan.
    const rawSites = source.match(/\bterm=/g)?.length ?? 0;
    expect(scan.terms.length + scan.passThrough.length).toBe(rawSites);
    // Exact, not a floor: the panel has twelve (?) icons. A floor below the
    // real count lets sites fall out of the scan with the test still green.
    expect(scan.terms).toHaveLength(12);

    const missing = [...new Set(scan.terms)].filter((term) => !TOOLTIP_DICTIONARY[term]);
    expect(missing, 'terms the panel shows a (?) for that have no definition').toEqual([]);
  });

  /**
   * The engine places a first-person camera at `target.translation + Y *
   * eye_height` (`update_first_person` in `game_camera.rs`): above the
   * target's ORIGIN. The default player is a capsule centred on its origin
   * (`Capsule3d::new(0.25, 1.0)` spawned at y = 0.75), so "above the feet"
   * placed the eye 0.75 lower in the reader's head than in the game. The guide
   * (`docs/features/game-cameras.md`) already says "above the entity origin"
   * (review-board round 3 on #10295).
   */
  it('measures first-person eye height from the target origin, not the feet', () => {
    const tooltip = TOOLTIP_DICTIONARY['gameCameraFPHeight']!;
    expect(tooltip).toMatch(/\borigin\b/);
    expect(tooltip).not.toMatch(/above the \w+'s feet/i);
    expect(tooltip).toContain(String(ENGINE_CAMERA_DEFAULTS.firstPersonHeight));
  });

  /**
   * The first draft of this tooltip said a blank Target ID makes the camera
   * "follow whichever object is selected". Nothing does that: the engine
   * resolves a missing target to none and skips every follow arm
   * (`game_camera.rs`), `cameraModeNeedsTarget` lists five of six modes as
   * inert without one, and `cameraSetupExecutor` already warns "it will not
   * move". The inspector placeholder and the docs say the same thing now, and
   * this pins the tooltip's half (review-board round 4 on #10295).
   */
  it('does not promise that a blank camera target follows the selection', () => {
    const tooltip = TOOLTIP_DICTIONARY['gameCameraTarget']!;
    expect(tooltip).not.toMatch(/selected|selection/i);
    expect(tooltip).toMatch(/will not move/);
  });

  /**
   * One vocabulary across the guide, this tooltip and the inspector
   * placeholder: every mode but Fixed TRACKS its target, and "follow" is
   * reserved for the three modes that ease toward it and have Smoothing. The
   * target tooltip said "the object the camera follows" while the guide said
   * First Person and Orbital "do not follow" — both true under different
   * meanings, contradictory side by side (review-board ux finding on #10295).
   */
  it('describes the camera target as tracked, not followed', () => {
    const tooltip = TOOLTIP_DICTIONARY['gameCameraTarget']!;
    expect(tooltip).toMatch(/\btracks\b/);
    expect(tooltip).not.toMatch(/follow/i);
  });

  it('should be a non-empty record', () => {
    const keys = Object.keys(TOOLTIP_DICTIONARY);
    expect(keys.length).toBeGreaterThan(50);
  });

  it('should have non-empty string values', () => {
    for (const [key, value] of Object.entries(TOOLTIP_DICTIONARY)) {
      expect(typeof value, `${key} should be a string`).toBe('string');
      expect(value.length, `${key} should not be empty`).toBeGreaterThan(0);
    }
  });

  it('should include transform tooltips', () => {
    expect(TOOLTIP_DICTIONARY['position']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['rotation']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['scale']).toBeDefined();
  });

  it('should include material tooltips', () => {
    expect(TOOLTIP_DICTIONARY['metallic']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['roughness']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['baseColor']).toBeDefined();
  });

  it('should include physics tooltips', () => {
    expect(TOOLTIP_DICTIONARY['restitution']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['friction']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['bodyType']).toBeDefined();
  });

  it('should include audio tooltips', () => {
    expect(TOOLTIP_DICTIONARY['audioVolume']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['audioSpatial']).toBeDefined();
  });

  it('should include game component tooltips', () => {
    expect(TOOLTIP_DICTIONARY['characterController']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['health']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['collectible']).toBeDefined();
  });

  it('should include lighting tooltips', () => {
    expect(TOOLTIP_DICTIONARY['intensity']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['range']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['lightShadows']).toBeDefined();
  });

  /**
   * A tooltip is read in a hover, at the size of a hover. `gcJumpHeight` had
   * grown to a 43-word two-sentence paragraph explaining the 2D/3D divergence —
   * more text than the panel it annotates, which is where a reader stops reading
   * tooltips at all (PF-1228). The ceiling is deliberately loose: it exists to
   * catch the next paragraph, not to police wording. Longest entry today is 29
   * words, so a regrowth past 30 is a real change, not drift.
   */
  it('should keep every tooltip short enough to read in a hover', () => {
    const LIMIT = 30;
    const tooLong = Object.entries(TOOLTIP_DICTIONARY)
      .map(([key, value]) => [key, value.trim().split(/\s+/).length] as const)
      .filter(([, words]) => words > LIMIT);
    expect(
      tooLong,
      `tooltips over ${LIMIT} words — move the detail into the panel or the docs`,
    ).toEqual([]);
  });

  it('tooltip values should be user-friendly (no raw code)', () => {
    for (const [key, value] of Object.entries(TOOLTIP_DICTIONARY)) {
      // Tooltips should not contain code-like constructs
      expect(value, `${key} should not contain code`).not.toMatch(/function\s*\(/);
      expect(value, `${key} should not contain code`).not.toMatch(/=>/);
    }
  });
});
