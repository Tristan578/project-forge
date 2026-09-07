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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FORGE_TYPE_DEFINITIONS } from '../forgeTypes';
import { SCRIPT_TEMPLATES, buildBehaviorScript } from '../scriptTemplates';
import { SCRIPT_SYSTEM_PROMPT } from '@/lib/game-creation/executors/customScriptExecutor';
import { BEHAVIOR_VOCAB } from '@/lib/game-creation/behaviorVocabulary';
import { TEMPLATE_REGISTRY } from '@/data/templates';

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

/**
 * The namespace paths, derived from the members inside them.
 *
 * Prose names a namespace on its own — "use forge.state for cross-script
 * communication" — and that is a correct sentence about a real namespace, not
 * an undeclared member. Deriving these from `DECLARED` rather than listing them
 * keeps the exemption honest: `forge.state` resolves only because
 * `forge.state.get` was actually found, so a namespace that loses all its
 * members stops being exempt.
 *
 * A namespace that is CALLED is still an error, which is why this is checked
 * against `reference.called` at the use site rather than folded into DECLARED.
 */
const NAMESPACES = new Set(
  [...DECLARED.keys()]
    .map(path => path.slice(0, path.lastIndexOf('.')))
    .filter(prefix => prefix.includes('.')),
);

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

  // THE SECOND PROMPT. `/api/chat`'s `SYSTEM_PROMPT` has its own "Scripting API
  // (forge.*)" section — a separate list, maintained separately, telling a
  // separate model what it may call. It was outside this gate and had gone
  // stale in exactly the way the executor prompt had: it offered
  // `forge.physics.setVelocity`, a method with no engine arm behind it.
  //
  // Read as TEXT rather than imported. The check is textual either way, and
  // importing a Next.js route handler would pull its whole server dependency
  // tree — Clerk, the DB client, the docs loader — into a unit test to look at
  // one string.
  const routePath = path.join(process.cwd(), 'src', 'app', 'api', 'chat', 'route.ts');
  const routeText = readFileSync(routePath, 'utf8');
  sources.push({ label: 'api/chat/route.ts SYSTEM_PROMPT', text: routeText });

  // THE REFERENCE TABLE. `docs/reference/script-api.md` is not narrative prose
  // about scripting — it is a row-per-method table, which is the same claim
  // `forgeTypes.ts` makes, written twice. It had five rows for methods with no
  // engine arm, including two on a namespace (`forge.skeleton`) that has never
  // had them at all.
  const docPath = path.join(process.cwd(), '..', 'docs', 'reference', 'script-api.md');
  sources.push({ label: 'docs/reference/script-api.md', text: readFileSync(docPath, 'utf8') });

  return sources;
}

/**
 * The FOURTH source, and the one with the most code in it: the starter games in
 * the Template Gallery.
 *
 * These were outside the gate while it claimed to cover "every `forge.*` call
 * the product SHOWS or SHIPS" — and they are the most literally shipped of the
 * four. A template is instantiated as a whole project and its scripts run on
 * the first frame of Play, so a name that does not exist is not a degraded
 * feature: the controller throws and the game does not move.
 *
 * Read through `TEMPLATE_REGISTRY` rather than by importing each module, so a
 * template added later is covered without editing this file. The registry's
 * loaders are dynamic imports, which is why this half is async.
 */
async function collectTemplateSources(): Promise<{ label: string; text: string }[]> {
  const sources: { label: string; text: string }[] = [];

  for (const entry of TEMPLATE_REGISTRY) {
    const template = await entry.load();
    for (const [entityId, script] of Object.entries(template.scripts ?? {})) {
      sources.push({
        label: `TEMPLATE_REGISTRY["${entry.id}"].scripts["${entityId}"]`,
        text: script.source,
      });
    }
  }

  return sources;
}

const TEMPLATE_SOURCES = await collectTemplateSources();

/**
 * EVERY 2D STARTER GAME IS BROKEN AS SHIPPED. This is the measurement, not a
 * concession.
 *
 * Bringing the Template Gallery under the gate found that all six 2D templates
 * were written against an API that has never existed. The decisive one is
 * `forge.onUpdate(callback)`: the real contract is a bare top-level
 * `function onUpdate(dt)` which `scriptWorker` picks up with
 * `typeof onUpdate === 'function'`. There is no `forge.onUpdate`, so it is
 * `undefined`, so every one of these scripts throws a TypeError on its first
 * statement and no 2D template does anything at all in Play. The rest —
 * `forge.transform.*` (no such namespace), `forge.input.isKeyDown` (the real
 * one is `isPressed`, and it takes a bound ACTION, not a raw key), and
 * `forge.scene.getComponent` / `forge.material.*` / `forge.camera.screenToWorld`
 * (no equivalent exists anywhere) — is the same mistake repeated.
 *
 * NOT WAIVED BECAUSE IT IS ACCEPTABLE. Waived because repairing it is not a
 * name substitution: `isKeyDown('ArrowLeft')` needs input bindings each
 * template does not declare, and four of these symbols have no counterpart to
 * substitute in. That is a design change per template, tracked separately, and
 * guessing at it inside a PR about removing phantom methods is how the next
 * defect gets shipped.
 *
 * THE LIST MAY ONLY SHRINK. A symbol not named here fails the gate, so nothing
 * new can be added to a broken template, and `no baseline entry is stale`
 * below fails on any entry that has stopped matching — so a repair cannot be
 * made and then silently forgotten either.
 *
 * Repair is tracked at #9763, which carries the per-template measurement and
 * the three capabilities that would have to exist first.
 */
const TEMPLATE_BASELINE: Record<string, readonly string[]> = {
  '2d-shmup': [
    'forge.input.isKeyDown',
    'forge.onStart',
    'forge.onUpdate',
    'forge.scene.findByType',
    'forge.scene.getComponent',
    'forge.transform.getPosition',
    'forge.transform.setPosition',
  ],
  '2d-puzzle': [
    'forge.camera.screenToWorld',
    'forge.input.getMousePosition',
    'forge.input.isMousePressed',
    'forge.material.setBaseColor',
    'forge.material.setEmissive',
    'forge.onStart',
    'forge.onUpdate',
    'forge.scene.findByType',
    'forge.scene.getComponent',
    'forge.transform.getPosition',
  ],
  '2d-fighter': [
    'forge.input.isKeyDown',
    'forge.input.isKeyPressed',
    'forge.onStart',
    'forge.onUpdate',
    'forge.transform.getPosition',
    'forge.transform.setPosition',
  ],
  '2d-metroidvania': [
    'forge.input.isKeyDown',
    'forge.input.isKeyPressed',
    'forge.onStart',
    'forge.onUpdate',
    'forge.physics.setEnabled',
    'forge.physics2d.setVelocity',
    'forge.physics2d.setVelocityX',
    'forge.scene.getComponent',
    'forge.transform.getPosition',
    'forge.transform.setPosition',
  ],
};

/** The template id a `TEMPLATE_REGISTRY[...]` label refers to. */
function templateIdOf(label: string): string | null {
  if (!label.startsWith('TEMPLATE_REGISTRY["')) return null;
  return label.slice('TEMPLATE_REGISTRY["'.length).split('"')[0];
}

/** Is this unresolved reference one of the known-broken ones for its template? */
function isBaselined(label: string, path: string): boolean {
  const id = templateIdOf(label);
  return id !== null && (TEMPLATE_BASELINE[id]?.includes(path) ?? false);
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

    it('derives namespaces from the members inside them, and only those', () => {
      // If this set were empty the prose exemption above would be inert; if it
      // held a name with no members it would exempt something imaginary.
      expect(NAMESPACES.has('forge.state')).toBe(true);
      expect(NAMESPACES.has('forge.input')).toBe(true);
      expect(NAMESPACES.has('forge.transform')).toBe(false);
      expect(NAMESPACES.has('forge')).toBe(false);
    });

    it('does not invent the namespace the prompt used to advertise', () => {
      // The whole reason this file exists. If `forge.entity` ever appears in
      // forgeTypes.ts the executor prompt may name it — until then it must not.
      const invented = [...DECLARED.keys()].filter(path => path.startsWith('forge.entity.'));
      expect(invented).toEqual([]);
    });
  });

  describe('every shipped and advertised call exists', () => {
    const sources = [...collectSources(), ...TEMPLATE_SOURCES];

    it('has something to check in each source category', () => {
      expect(sources.filter(s => s.label.startsWith('SCRIPT_TEMPLATES')).length).toBeGreaterThan(0);
      expect(sources.filter(s => s.label.startsWith('buildBehaviorScript')).length).toBeGreaterThan(0);
      expect(sources.filter(s => s.label.includes('SCRIPT_SYSTEM_PROMPT')).length).toBe(1);
      expect(sources.filter(s => s.label.startsWith('TEMPLATE_REGISTRY')).length).toBeGreaterThan(0);

      // The route is read off disk, so a moved file would silently contribute
      // nothing — a source that resolves zero references reads as zero problems.
      const route = sources.find(s => s.label.startsWith('api/chat/route.ts'));
      expect(route).toBeDefined();
      expect(referencesIn(route!.text).length).toBeGreaterThan(20);

      const doc = sources.find(s => s.label === 'docs/reference/script-api.md');
      expect(doc).toBeDefined();
      expect(referencesIn(doc!.text).length).toBeGreaterThan(100);
    });

    // A registry entry whose loader resolved to a template with no scripts
    // would contribute nothing and be indistinguishable from one that passed.
    it('reads a script out of every registered template', () => {
      const covered = new Set(
        TEMPLATE_SOURCES.map(s => s.label.slice('TEMPLATE_REGISTRY["'.length).split('"')[0]),
      );
      expect([...covered].sort()).toEqual(TEMPLATE_REGISTRY.map(e => e.id).sort());
    });

    it('resolves every forge.* reference against forgeTypes.ts', () => {
      const unknown: string[] = [];
      let checked = 0;

      for (const source of sources) {
        for (const reference of referencesIn(source.text)) {
          checked += 1;
          if (DECLARED.has(reference.path)) continue;
          // A namespace named on its own in prose. Calling one is still wrong.
          if (!reference.called && NAMESPACES.has(reference.path)) continue;
          if (isBaselined(source.label, reference.path)) continue;
          unknown.push(`${source.label}: ${reference.path} is not declared in forgeTypes.ts`);
        }
      }

      // A source set that produced no references would report "no problems".
      expect(checked).toBeGreaterThan(50);
      expect(unknown).toEqual([]);
    });

    /**
     * Anti-rot, and the half that makes the baseline a debt rather than a
     * permission. An entry that no longer matches anything means the template
     * was repaired — and a baseline nobody prunes is how a list of six broken
     * templates outlives the repair of all six while still reading as
     * "known broken".
     */
    it('has no stale baseline entry', () => {
      const stale: string[] = [];

      for (const [templateId, symbols] of Object.entries(TEMPLATE_BASELINE)) {
        const templateText = TEMPLATE_SOURCES
          .filter(s => templateIdOf(s.label) === templateId)
          .map(s => s.text)
          .join('\n');

        if (templateText === '') {
          stale.push(`${templateId}: baselined but no such template is registered`);
          continue;
        }

        const referenced = new Set(referencesIn(templateText).map(r => r.path));
        for (const symbol of symbols) {
          if (!referenced.has(symbol)) {
            stale.push(`${templateId}: ${symbol} is no longer referenced — delete the entry`);
          } else if (DECLARED.has(symbol)) {
            stale.push(`${templateId}: ${symbol} is declared now — delete the entry`);
          }
        }
      }

      expect(stale).toEqual([]);
    });

    /**
     * The count is pinned so the debt cannot grow quietly. A new broken symbol
     * in an already-broken template would otherwise only need a one-line
     * addition above, which is the path of least resistance and exactly what
     * this is here to make visible.
     */
    it('baselines exactly the six 2D templates and no more', () => {
      expect(Object.keys(TEMPLATE_BASELINE).sort()).toEqual([
        '2d-fighter',
        '2d-metroidvania',
        '2d-puzzle',
        '2d-shmup',
      ]);
      const total = Object.values(TEMPLATE_BASELINE).reduce((n, list) => n + list.length, 0);
      expect(total).toBe(33);
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
