/**
 * The parameterized behaviour templates the generation pipeline attaches
 * (PF-1114).
 *
 * `forgeApiConformance.test.ts` proves every `forge.*` call in these sources
 * exists. This file guards the things that are TRUE OF THE ENGINE rather than
 * of the API surface, each of which fails silently in production:
 *
 *  1. **Enemies and NPCs are fixed sensor bodies.** `physicsRoles.ts` sets
 *     `bodyType: 'fixed'`, `isSensor: true` for both, precisely because
 *     `system_follower` writes their Transform directly. Rapier ignores
 *     applyForce / applyImpulse / setVelocity on a fixed body, and
 *     `dispatchCommand` returns void, so a behaviour script that reaches for
 *     them is an entity that never moves and never reports why.
 *  2. **The target id is embedded as a source literal.** An id carrying a quote
 *     would close that literal and turn engine data into executable text, so
 *     `buildBehaviorScript` refuses ids outside `[A-Za-z0-9_-]` rather than
 *     escaping them.
 *  3. **2D and 3D use different ground planes.** x/z in 3D, x/y in 2D. A
 *     hardcoded z gives a 2D game whose enemies flee into the screen.
 */

import { describe, it, expect } from 'vitest';
import { SCRIPT_TEMPLATES, buildBehaviorScript } from '../scriptTemplates';
import {
  BEHAVIOR_PLANS,
  BEHAVIOR_VOCAB,
} from '@/lib/game-creation/behaviorVocabulary';

const TARGET = 'a1b2c3d4-0000-4000-8000-abcdefabcdef';

/** The behaviours whose plan says they are backed by a script. */
const SCRIPTED = BEHAVIOR_VOCAB.filter(
  b => BEHAVIOR_PLANS[b].substrate === 'behavior_script',
);

describe('buildBehaviorScript', () => {
  it('has scripted behaviours to check at all', () => {
    // Without this the loops below would iterate nothing and report success
    // while the script substrate had quietly been removed.
    expect(SCRIPTED.length).toBeGreaterThan(0);
  });

  it('returns source for exactly the behaviours planned as scripts', () => {
    for (const behavior of BEHAVIOR_VOCAB) {
      const source = buildBehaviorScript(behavior, { targetEntityId: TARGET, projectType: '3d' });
      const expected = BEHAVIOR_PLANS[behavior].substrate === 'behavior_script';
      expect({ behavior, hasSource: source !== null }).toEqual({ behavior, hasSource: expected });
    }
  });

  it('produces a script the runtime will actually invoke', () => {
    for (const behavior of SCRIPTED) {
      const source = buildBehaviorScript(behavior, { targetEntityId: TARGET, projectType: '3d' })!;
      // The sandbox calls onStart/onUpdate/onDestroy. A source defining none of
      // them compiles, attaches, and does nothing forever.
      expect(source).toMatch(/\bfunction\s+(onStart|onUpdate)\b/);
      expect(source).toContain('entityId');
    }
  });

  it('never moves an entity with forge.physics — enemies are FIXED sensor bodies', () => {
    const silentNoOps = ['applyForce', 'applyImpulse', 'setVelocity'];
    for (const behavior of SCRIPTED) {
      for (const projectType of ['2d', '3d'] as const) {
        const source = buildBehaviorScript(behavior, { targetEntityId: TARGET, projectType })!;
        for (const call of silentNoOps) {
          expect({ behavior, projectType, call, used: source.includes(`forge.physics.${call}`) })
            .toEqual({ behavior, projectType, call, used: false });
        }
        // And it must actually move something, or the assertion above is
        // satisfied by a script that does nothing.
        expect(source).toMatch(/forge\.(translate|setPosition)\(/);
      }
    }
  });

  it('uses the 3D ground plane in 3D and the 2D one in 2D', () => {
    for (const behavior of SCRIPTED) {
      const three = buildBehaviorScript(behavior, { targetEntityId: TARGET, projectType: '3d' })!;
      const two = buildBehaviorScript(behavior, { targetEntityId: TARGET, projectType: '2d' })!;
      expect(three).toContain('const LATERAL = 2;');
      expect(two).toContain('const LATERAL = 1;');
    }
  });

  it('binds to the engine id it was given', () => {
    for (const behavior of SCRIPTED) {
      const source = buildBehaviorScript(behavior, { targetEntityId: TARGET, projectType: '3d' })!;
      expect(source).toContain(`const TARGET_ID = "${TARGET}";`);
    }
  });

  it('refuses an id it cannot embed safely rather than escaping it', () => {
    const hostile = [
      '"; forge.destroy(entityId); //',
      'id with spaces',
      'id\nwith-newline',
      '',
      'x'.repeat(65),
    ];
    for (const behavior of SCRIPTED) {
      for (const id of hostile) {
        expect({ behavior, id, source: buildBehaviorScript(behavior, { targetEntityId: id, projectType: '3d' }) })
          .toEqual({ behavior, id, source: null });
      }
      expect(buildBehaviorScript(behavior, { targetEntityId: null, projectType: '3d' })).toBeNull();
    }
  });

  it('contains none of the patterns the script sandbox forbids', () => {
    // The same list `customScriptExecutor.validateGeneratedScript` screens LLM
    // output against. These sources are hand-written, so this is the only place
    // that check can happen — restated rather than imported because the
    // executor's copy is deliberately private to it.
    const forbidden = [
      /\beval\b/,
      /\bFunction\b\s*\(/,
      /\bfetch\b/,
      /\bXMLHttpRequest\b/,
      /\bWebSocket\b/,
      /\bimportScripts\b/,
      /\bReflect\b/,
      /\bProxy\b/,
      /\bglobalThis\b/,
      /\b__proto__\b/,
      /constructor\.constructor/,
    ];
    for (const behavior of SCRIPTED) {
      const source = buildBehaviorScript(behavior, { targetEntityId: TARGET, projectType: '3d' })!;
      for (const pattern of forbidden) {
        expect({ behavior, pattern: pattern.source, hit: pattern.test(source) })
          .toEqual({ behavior, pattern: pattern.source, hit: false });
      }
    }
  });

  it('does not disturb the editor template list', () => {
    // The Script Editor and Script Explorer enumerate SCRIPT_TEMPLATES, and its
    // length is pinned in scriptTemplates.test.ts. Behaviour sources are built,
    // not listed, so adding one must never change that array.
    expect(SCRIPT_TEMPLATES).toHaveLength(10);
    expect(SCRIPT_TEMPLATES.some(t => t.id === 'flee')).toBe(false);
  });
});
