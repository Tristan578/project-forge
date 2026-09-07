/**
 * Every input action the product USES must be an action that EXISTS.
 *
 * This is `forgeApiConformance`'s sibling, for the half it structurally cannot
 * see. That gate resolves `forge.input.isPressed` against `forgeTypes.ts` and is
 * satisfied — the method is real. What it cannot check is the STRING, and the
 * string is the whole binding: `isPressed('move_left')` is a correct call to a
 * real method that returns false forever if nothing defines `move_left`.
 *
 * WHAT THAT COST. Every movement script the product shipped or generated used
 * `move_left`, `move_right`, `move_forward` or `move_backward`, and no genre
 * preset defined any of them:
 *
 *   fps         move_forward (AXIS), move_right (AXIS), jump, sprint, crouch,
 *               interact, fire, aim
 *   platformer  move_horizontal (axis), jump, crouch, attack, special
 *   topdown     move_vertical, move_horizontal (axes), fire
 *   racing      throttle, brake, steer, nitro, reset
 *
 * `move_left` and `move_backward` were in none of them. Worse, an axis reports
 * `pressed` whenever it is non-zero, so under `fps` — the 3D shooter and the
 * explorer — `isPressed('move_forward')` was true when EITHER W or S was held,
 * and `isPressed('move_left')` was never true at all. The player could not walk
 * left, and walking backwards read as walking forwards. Both AI prompts taught
 * those four names as "Default actions", so generated games were born with it.
 *
 * The names are checked against `DEFAULT_INPUT_ACTIONS`, which mirrors
 * `InputMap::default()` in `engine/src/core/input.rs` — the vocabulary every
 * scene now starts with, and the one a script may assume when its scene has
 * declared nothing of its own. A scene that declares its own actions may use
 * any names it likes; those are checked against what it declares.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SCRIPT_TEMPLATES, buildBehaviorScript } from '../scriptTemplates';
import { SCRIPT_SYSTEM_PROMPT } from '@/lib/game-creation/executors/customScriptExecutor';
import { BEHAVIOR_VOCAB } from '@/lib/game-creation/behaviorVocabulary';
import { TEMPLATE_REGISTRY } from '@/data/templates';

/**
 * The actions `InputMap::default()` binds, mirrored from the Rust.
 *
 * Mirrored rather than imported because the engine is WASM and this is a unit
 * test — so `the mirror matches the engine` below reads the Rust source and
 * fails if the two drift, which is the only thing making this list trustworthy.
 */
const DEFAULT_INPUT_ACTIONS = [
  'move_horizontal',
  'move_vertical',
  'move_left',
  'move_right',
  'move_up',
  'move_down',
  'move_forward',
  'move_backward',
  'jump',
  'interact',
  'pause',
  'action_primary',
  'action_secondary',
] as const;

const ENGINE_INPUT_RS = path.join(
  process.cwd(), '..', 'engine', 'src', 'core', 'input.rs',
);

/** Every `forge.input.<method>('name')` in a body of text. */
function actionsUsedIn(text: string): string[] {
  const found: string[] = [];
  const pattern =
    /\bforge\.input\.(?:isPressed|justPressed|justReleased|getAxis)\s*\(\s*['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(pattern)) found.push(match[1]);
  return found;
}

/** Source strings the product ships or teaches, labelled for the failure. */
async function collectSources(): Promise<{ label: string; text: string }[]> {
  const sources: { label: string; text: string }[] = [];

  for (const template of SCRIPT_TEMPLATES) {
    sources.push({ label: `SCRIPT_TEMPLATES["${template.id}"]`, text: template.source });
  }

  for (const behavior of BEHAVIOR_VOCAB) {
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
  sources.push({
    label: 'api/chat/route.ts SYSTEM_PROMPT',
    text: readFileSync(path.join(process.cwd(), 'src', 'app', 'api', 'chat', 'route.ts'), 'utf8'),
  });

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

const SOURCES = await collectSources();

describe('input action conformance', () => {
  /**
   * The mirror above is only worth anything if it matches. Reading the Rust and
   * asserting every name appears in it is what turns `DEFAULT_INPUT_ACTIONS`
   * from a list somebody typed into a statement about the engine.
   */
  it('mirrors the actions InputMap::default() actually binds', () => {
    const rust = readFileSync(ENGINE_INPUT_RS, 'utf8');
    const start = rust.indexOf('impl Default for InputMap');
    expect(start, 'InputMap has no Default impl').toBeGreaterThan(-1);
    // To the next top-level `impl`, whichever it is — naming a specific one
    // makes this silently slice to nothing the day that block is reordered,
    // and a walk over nothing reports no drift.
    const nextImpl = rust.indexOf('\nimpl ', start + 1);
    const defaultImpl = rust.slice(start, nextImpl === -1 ? undefined : nextImpl);
    expect(defaultImpl.length).toBeGreaterThan(200);

    const bound = [...defaultImpl.matchAll(/actions\.insert\("([a-z_]+)"/g)].map(m => m[1]);
    expect([...bound].sort()).toEqual([...DEFAULT_INPUT_ACTIONS].sort());
  });

  it('has something to check in every source category', () => {
    expect(SOURCES.filter(s => s.label.startsWith('SCRIPT_TEMPLATES')).length).toBeGreaterThan(0);
    expect(SOURCES.filter(s => s.label.startsWith('TEMPLATE_REGISTRY')).length).toBeGreaterThan(0);
    expect(SOURCES.filter(s => s.label.includes('SYSTEM_PROMPT')).length).toBe(2);
  });

  /**
   * The gate. A walk that inspected nothing would report nothing, so the count
   * of names actually examined is asserted too.
   */
  it('uses only action names the default vocabulary defines', () => {
    const unknown: string[] = [];
    let checked = 0;

    for (const source of SOURCES) {
      for (const action of actionsUsedIn(source.text)) {
        checked += 1;
        if (!DEFAULT_INPUT_ACTIONS.includes(action as typeof DEFAULT_INPUT_ACTIONS[number])) {
          unknown.push(`${source.label}: '${action}' is not a default input action`);
        }
      }
    }

    expect(checked).toBeGreaterThan(20);
    expect(unknown).toEqual([]);
  });

  /**
   * The prompts must teach names that exist, and must teach them at all — a
   * model told nothing about input invents `'ArrowLeft'`, which is a key code
   * rather than an action and matches no binding.
   */
  it('teaches the models only real action names', () => {
    for (const label of ['customScriptExecutor SCRIPT_SYSTEM_PROMPT', 'api/chat/route.ts SYSTEM_PROMPT']) {
      const source = SOURCES.find(s => s.label === label);
      expect(source, label).toBeDefined();
      const named = DEFAULT_INPUT_ACTIONS.filter(a => source!.text.includes(a));
      expect(named.length, `${label} names no real action`).toBeGreaterThan(3);
    }
  });
});
