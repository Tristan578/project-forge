/**
 * Every `forge.*` call the product SHOWS or SHIPS must exist.
 *
 * This is the gate for a defect class that had been live for the whole life of
 * the generation pipeline: `customScriptExecutor`'s "## Available APIs" block
 * advertised a `forge.entity` namespace with six transform methods, plus
 * `forge.input.isKeyDown`, `forge.input.isKeyJustPressed`, `forge.ui.setText`
 * and `forge.ui.setVisible`. Ten of its eighteen entries were imaginary. The
 * model dutifully used them, `validateGeneratedScript` only screens for sandbox
 * escapes, `dispatchCommand` returns void, and the script then throws on its
 * first frame inside a Web Worker — so the whole path reported success while
 * generating code that could not run (PF-1114).
 *
 * Nothing about that is a type error, so `tsc` could never see it: the API
 * surface is a template literal (`FORGE_TYPE_DEFINITIONS`) on one side and
 * source text in strings on the other. This test is the only place the two are
 * compared.
 *
 * THREE SOURCES ARE CHECKED, and each must be NON-EMPTY (a walk over zero items
 * reports zero problems and reads as coverage):
 *
 *  1. `SCRIPT_TEMPLATES` — what a human is offered in the Script Editor.
 *  2. `buildBehaviorScript` — what the pipeline attaches to generated entities.
 *  3. `SCRIPT_SYSTEM_PROMPT` — what the LLM is TOLD it may call, which is the
 *     half that was wrong.
 */

import { describe, it, expect } from 'vitest';
import { FORGE_TYPE_DEFINITIONS } from '../forgeTypes';
import { SCRIPT_TEMPLATES, buildBehaviorScript } from '../scriptTemplates';
import { SCRIPT_SYSTEM_PROMPT } from '@/lib/game-creation/executors/customScriptExecutor';
import { BEHAVIOR_VOCAB } from '@/lib/game-creation/behaviorVocabulary';

// ---------------------------------------------------------------------------
// The declared surface
// ---------------------------------------------------------------------------

type MemberKind = 'function' | 'value';

/**
 * Parse `FORGE_TYPE_DEFINITIONS` into `forge.a.b -> kind`.
 *
 * Brace-depth tracking rather than a flat regex, because the file nests
 * (`namespace forge { namespace physics { … } }`) and because several
 * declarations open a brace of their own (`Promise<{ … }>` spread over lines).
 * A namespace is popped when depth returns to the level it was opened at, so a
 * member can never be filed under a namespace that already closed.
 */
function parseDeclaredMembers(dts: string): Map<string, MemberKind> {
  const members = new Map<string, MemberKind>();
  const stack: { name: string; depth: number }[] = [];
  let depth = 0;

  for (const line of dts.split('\n')) {
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;

    const namespaceMatch = line.match(/\bnamespace\s+([A-Za-z_$][\w$]*)\s*\{/);
    if (namespaceMatch) {
      stack.push({ name: namespaceMatch[1], depth });
      depth += opens - closes;
      continue;
    }

    const fnMatch = line.match(/^\s*function\s+([A-Za-z_$][\w$]*)\s*[(<]/);
    const valueMatch = line.match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*:/);
    if (fnMatch || valueMatch) {
      const name = (fnMatch ?? valueMatch)![1];
      const path = [...stack.map(s => s.name), name].join('.');
      members.set(path, fnMatch ? 'function' : 'value');
    }

    depth += opens - closes;
    while (stack.length > 0 && depth <= stack[stack.length - 1].depth) {
      stack.pop();
    }
  }

  return members;
}

const DECLARED = parseDeclaredMembers(FORGE_TYPE_DEFINITIONS);

// ---------------------------------------------------------------------------
// The used surface
// ---------------------------------------------------------------------------

interface Reference {
  /** e.g. `forge.input.isPressed` */
  path: string;
  /** True when the very next non-space character is `(`. */
  called: boolean;
}

/**
 * Every `forge.<a>[.<b>]` mention in a body of text, with whether it is CALLED.
 *
 * The call/property distinction is not pedantry: `forge.time.delta` is a
 * number and `forge.input.isPressed` is a function, and a script that calls the
 * first or reads the second is broken in a way no other check here would see.
 */
function referencesIn(text: string): Reference[] {
  const found: Reference[] = [];
  const pattern = /\bforge\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g;
  for (const match of text.matchAll(pattern)) {
    const path = match[2] ? `forge.${match[1]}.${match[2]}` : `forge.${match[1]}`;
    const rest = text.slice(match.index + match[0].length);
    found.push({ path, called: /^\s*\(/.test(rest) });
  }
  return found;
}

/** Every source string the product ships or shows, labelled for the failure message. */
function collectSources(): { label: string; text: string }[] {
  const sources: { label: string; text: string }[] = [];

  for (const template of SCRIPT_TEMPLATES) {
    sources.push({ label: `SCRIPT_TEMPLATES["${template.id}"]`, text: template.source });
  }

  for (const behavior of BEHAVIOR_VOCAB) {
    // A behaviour planned as an engine component has no script, by design.
    // `null` is not a gap here — `behaviorScripts.test.ts` pins which entries
    // are expected to produce source and which are not.
    for (const projectType of ['2d', '3d'] as const) {
      const source = buildBehaviorScript(behavior, {
        targetEntityId: 'target-entity-id',
        projectType,
      });
      if (source === null) continue;
      sources.push({ label: `buildBehaviorScript("${behavior}", ${projectType})`, text: source });
    }
  }

  sources.push({ label: 'customScriptExecutor SCRIPT_SYSTEM_PROMPT', text: SCRIPT_SYSTEM_PROMPT });

  return sources;
}

// ---------------------------------------------------------------------------

describe('forge API conformance', () => {
  describe('the declared surface parses', () => {
    // If the parser is wrong, every conformance assertion below passes
    // vacuously against a set that happens to contain whatever it looked for.
    it('finds a large, plausible member set', () => {
      expect(DECLARED.size).toBeGreaterThan(100);
    });

    it('finds top-level members, namespaced members and value members', () => {
      expect(DECLARED.get('forge.getTransform')).toBe('function');
      expect(DECLARED.get('forge.translate')).toBe('function');
      expect(DECLARED.get('forge.input.isPressed')).toBe('function');
      expect(DECLARED.get('forge.physics.distanceTo')).toBe('function');
      expect(DECLARED.get('forge.ui.updateText')).toBe('function');
      expect(DECLARED.get('forge.time.delta')).toBe('value');
    });

    it('does not invent the namespace the prompt used to advertise', () => {
      // The whole reason this file exists. If `forge.entity` ever appears in
      // forgeTypes.ts the executor prompt may name it — until then it must not.
      const invented = [...DECLARED.keys()].filter(path => path.startsWith('forge.entity.'));
      expect(invented).toEqual([]);
    });
  });

  describe('every shipped and advertised call exists', () => {
    const sources = collectSources();

    it('has something to check in each source category', () => {
      expect(sources.filter(s => s.label.startsWith('SCRIPT_TEMPLATES')).length).toBeGreaterThan(0);
      expect(sources.filter(s => s.label.startsWith('buildBehaviorScript')).length).toBeGreaterThan(0);
      expect(sources.filter(s => s.label.includes('SCRIPT_SYSTEM_PROMPT')).length).toBe(1);
    });

    it('resolves every forge.* reference against forgeTypes.ts', () => {
      const unknown: string[] = [];
      let checked = 0;

      for (const source of sources) {
        for (const reference of referencesIn(source.text)) {
          checked += 1;
          if (!DECLARED.has(reference.path)) {
            unknown.push(`${source.label}: ${reference.path} is not declared in forgeTypes.ts`);
          }
        }
      }

      // A source set that produced no references would report "no problems".
      expect(checked).toBeGreaterThan(50);
      expect(unknown).toEqual([]);
    });

    it('calls functions and reads values, never the other way round', () => {
      const misuse: string[] = [];

      for (const source of sources) {
        for (const reference of referencesIn(source.text)) {
          const kind = DECLARED.get(reference.path);
          if (kind === undefined) continue; // reported by the test above
          if (kind === 'function' && !reference.called) {
            // Passing a function reference around is legitimate; only flag the
            // shapes that read as a value access in these sources.
            continue;
          }
          if (kind === 'value' && reference.called) {
            misuse.push(`${source.label}: ${reference.path} is a value, not a function`);
          }
        }
      }

      expect(misuse).toEqual([]);
    });
  });
});
