import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATE_REGISTRY, loadTemplate, getTemplateInfo } from './index';
import type { GameTemplate } from './index';
import { FORGE_TYPE_DEFINITIONS } from '@/lib/scripting/forgeTypes';

describe('game templates', () => {
  it('registry has 11 templates', () => {
    expect(TEMPLATE_REGISTRY).toHaveLength(11);
  });

  it('all registry entries have required fields', () => {
    for (const entry of TEMPLATE_REGISTRY) {
      expect(entry.id).not.toBe('');
      expect(entry.name).not.toBe('');
      expect(entry.description).not.toBe('');
      expect(entry.category).not.toBe('');
      expect(entry.difficulty).not.toBe('');
      expect(entry.thumbnail).toBeDefined();
      expect(entry.entityCount).toBeGreaterThan(0);
      expect(typeof entry.load).toBe('function');
    }
  });

  it('all template IDs are unique', () => {
    const ids = TEMPLATE_REGISTRY.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getTemplateInfo works', () => {
    const info = getTemplateInfo('platformer');
    expect(info).toBeDefined();
    expect(info?.id).toBe('platformer');

    const missing = getTemplateInfo('nonexistent');
    expect(missing).toBeNull();
  });

  // Load and validate each template
  for (const entry of TEMPLATE_REGISTRY) {
    describe(`template: ${entry.id}`, () => {
      let template: GameTemplate;

      beforeAll(async () => {
        template = await entry.load();
      });

      it('loads successfully', () => {
        expect(template).toBeDefined();
        expect(template.id).toBe(entry.id);
      });

      it('has valid sceneData with entities', () => {
        expect(template.sceneData.formatVersion).toBe(3);
        expect(template.sceneData.entities.length).toBeGreaterThan(5);
        expect(template.sceneData.entities.length).toBeLessThanOrEqual(50);
      });

      it('has reasonable entity count', () => {
        // Entity count in range (actual count depends on Array.from spreads)
        // 2D templates may have fewer entities (min 5 is fine for focused templates like fighter)
        expect(template.sceneData.entities.length).toBeGreaterThan(5);
        expect(template.sceneData.entities.length).toBeLessThan(50);
      });

      it('all entities have required fields', () => {
        for (const entity of template.sceneData.entities) {
          expect(entity.entityId).not.toBe('');
          expect(entity.entityName).not.toBe('');
          expect(entity.entityType).not.toBe('');
          expect(entity.transform).toBeDefined();
          expect(entity.transform.translation).toHaveLength(3);
          expect(entity.transform.rotation).toHaveLength(4);
          expect(entity.transform.scale).toHaveLength(3);
        }
      });

      it('has at least one script', () => {
        expect(Object.keys(template.scripts).length).toBeGreaterThan(0);
      });

      it('all script entity IDs exist in scene', () => {
        const entityIds = new Set(template.sceneData.entities.map(e => e.entityId));
        for (const scriptEntityId of Object.keys(template.scripts)) {
          expect(entityIds.has(scriptEntityId),
            `Script references non-existent entity: ${scriptEntityId}`
          ).toBe(true);
        }
      });

      it('scripts have non-empty source code', () => {
        for (const [entityId, script] of Object.entries(template.scripts)) {
          expect(script.source.length,
            `Empty script on ${entityId}`
          ).toBeGreaterThan(10);
          expect(script.enabled).toBe(true);
        }
      });

      it('has valid environment settings', () => {
        expect(template.sceneData.environment).toBeDefined();
        expect(template.sceneData.ambientLight).toBeDefined();
        expect(template.sceneData.ambientLight.brightness).toBeGreaterThan(0);
      });

      /**
       * A TEMPLATE MUST NOT NAME A GENRE.
       *
       * This asserted the opposite — that every template picked one of four
       * presets. `loadTemplate` then applied it, replacing the scene's action
       * map with that genre's handful of bindings. That is why shipped content
       * could speak nothing else, and why a two-player game had no way to give
       * its second player a key (#9764).
       *
       * A template declares whatever actions it wants in
       * `sceneData.inputBindings`, and gets the full default vocabulary either
       * way. `2d-fighter` is the one that currently declares any.
       */
      it('does not name a genre preset', () => {
        expect('inputPreset' in template).toBe(false);
      });
    });
  }

  /**
   * TEMPLATE BINDINGS ARE ENGINE JSON, AND NOTHING WAS CHECKING THEIR SHAPE.
   *
   * `sceneData.inputBindings` is passed through `buildInputBindings` into the
   * scene JSON and deserialized by Rust as `ActionDef`. The TypeScript that was
   * supposed to keep it honest is `Record<string, InputBinding | unknown>` — a
   * union with `unknown` IS `unknown`, so the constraint was already gone and
   * every shape typechecked.
   *
   * There are two live binding shapes in this codebase and they are easy to
   * confuse, because `audioEvents.ts` converts between them:
   *
   *   engine wire (here)  { name, actionType: { type: 'Digital' },
   *                         sources: [{ type: 'Key', value: 'ArrowLeft' }] }
   *   editor store        { actionName, actionType: 'digital',
   *                         sources: ['ArrowLeft'] }
   *
   * Writing the store shape into a template produces JSON serde cannot read,
   * `load_scene` drops the bindings, and the template is dead in exactly the
   * silent way this branch exists to fix — no type error, no test failure, no
   * console message. Found as an uncommitted edit sitting in the worktree that
   * did precisely that to `2d-fighter`.
   *
   * The type is now `Record<string, EngineActionDef>` and rejects that edit at
   * compile time, so THIS test is not the primary guard. It covers the two
   * things the type cannot: a single `as` cast walking straight past it, and
   * `binding.name` disagreeing with the key it is filed under — which serde
   * accepts happily and which binds the action under a name no script uses.
   *
   * The walk is asserted non-empty (lesson 11): with no template declaring
   * bindings this would inspect nothing and read as "no problems found".
   */
  it('every declared input binding is in the engine wire shape, not the store shape', async () => {
    const templates = await Promise.all(TEMPLATE_REGISTRY.map((e) => e.load()));

    let bindingsInspected = 0;
    for (const template of templates) {
      const bindings = template.sceneData.inputBindings ?? {};
      for (const [actionKey, raw] of Object.entries(bindings)) {
        bindingsInspected += 1;
        const where = `${template.id}.${actionKey}`;
        // Deliberately re-widened: the point is to check the VALUE, not to ask
        // the type what it already promised. `EngineActionDef` is bypassable
        // with one `as`, and it cannot express `binding.name === actionKey`.
        const binding = raw as unknown as Record<string, unknown>;

        // `ActionDef` is `#[serde(rename_all = "camelCase")]` over
        // `name` / `action_type` / `sources` / `dead_zone`. `actionName` is the
        // store's spelling and serde will reject it outright.
        expect(binding, where).toHaveProperty('name');
        expect(binding, where).not.toHaveProperty('actionName');
        expect(binding.name, where).toBe(actionKey);

        // `ActionType` is `#[serde(tag = "type")]`, so it is an OBJECT with a
        // `type` discriminator — never the bare string `'digital'`.
        const actionType = binding.actionType as Record<string, unknown> | undefined;
        expect(typeof actionType, where).toBe('object');
        expect(['Digital', 'Axis'], where).toContain(actionType?.type);

        // `InputSource` is `#[serde(tag = "type", content = "value")]`, so each
        // source is `{ type, value }` — never a bare key-code string.
        const sources = (binding.sources ?? []) as unknown[];
        expect(Array.isArray(sources), where).toBe(true);
        for (const source of sources) {
          const s = source as Record<string, unknown>;
          expect(typeof s, where).toBe('object');
          expect(['Key', 'MouseButton'], where).toContain(s.type);
          expect(typeof s.value, where).toBe('string');
        }
      }
    }

    expect(bindingsInspected).toBeGreaterThan(0);
  });

  it('loadTemplate works for valid ID', async () => {
    const template = await loadTemplate('platformer');
    expect(template).toBeDefined();
    expect(template?.id).toBe('platformer');
  });

  it('loadTemplate returns null for invalid ID', async () => {
    const template = await loadTemplate('invalid_template');
    expect(template).toBeNull();
  });

  // The MCP `load_template` command constrains templateId with an enum, so a
  // template missing from the manifest is not merely undocumented — the schema
  // rejects the call and an AI agent cannot reach it at all. All six 2D
  // templates were unreachable this way until PF-9446.
  it('the MCP load_template enum offers every registered template', async () => {
    const manifest = (await import('@/data/commands.json')) as unknown as {
      default: { commands: Array<{ name: string; parameters: { properties: Record<string, { enum?: string[] }> } }> };
    };
    const command = manifest.default.commands.find((c) => c.name === 'load_template');
    expect(command).toBeDefined();
    expect(command!.parameters.properties.templateId.enum).toEqual(
      TEMPLATE_REGISTRY.map((t) => t.id)
    );
  });
});

/**
 * 2D STARTER OUTCOME TESTS — 2d.FR-2.OP-01 / 2d.FR-2.OP-02 (#9815).
 *
 * This block covers only two of #9815's four operation families, and covers
 * exactly those two:
 *
 *   OP-01  Enumerated shipped 2D starter behavior — the six registered 2D
 *          starters exist and each declares a reachable win/score/progress
 *          outcome, i.e. a way to "complete or intentionally continue its
 *          declared game loop" (the parent's acceptance wording).
 *   OP-02  Template script/input contract validation — every `forge.*` call a
 *          2D starter's scripts make resolves to a symbol that actually exists
 *          in `forgeTypes.ts`, and the loop that reaches the outcome is wired
 *          to input (`forge.input.*`).
 *
 * OP-03 (editable starter mechanics) and OP-04 (blank-project custom game) are
 * NOT covered here — they are separate slices tracked as follow-on work off the
 * parent. This block must not be read as closing #9815.
 *
 * WHY THIS IS NOT A DUPLICATE of `inputActionConformance.test.ts`. That gate
 * proves every `forge.input.<m>('name')` STRING resolves to an action the
 * engine or the scene declares — it is the authority on input-action existence,
 * and this block deliberately does not re-mirror the engine's default action
 * list. What NOTHING checked before this block is whether the METHODS a
 * template's scripts call exist at all: `forge.input.isPressed('x')` and
 * `forge.material.setBaseColor(...)` are both syntactically fine, but the
 * second names a namespace `forgeTypes.ts` has never declared, so the call
 * throws at runtime and the game loop that depends on it never advances. That
 * is the exact class of defect the CLAUDE.md "verify method exists" gotcha
 * warns about, and it is what OP-02's symbol gate below catches.
 */
describe('2d starter outcomes (2d.FR-2.OP-01/OP-02)', () => {
  /** The six 2D starters #9815 owns, and the category each must carry. */
  const TWO_D_STARTERS: ReadonlyArray<{ id: string; category: string }> = [
    { id: '2d-platformer', category: '2d_platformer' },
    { id: '2d-topdown', category: '2d_topdown' },
    { id: '2d-shmup', category: '2d_shmup' },
    { id: '2d-puzzle', category: '2d_puzzle' },
    { id: '2d-fighter', category: '2d_fighter' },
    { id: '2d-metroidvania', category: '2d_metroidvania' },
  ];

  /**
   * OUTCOME EVIDENCE. A 2D starter "completes or intentionally continues its
   * declared game loop" if its scripts contain at least one of:
   *   - an explicit engine win call `forge.game.win()`;
   *   - a win/lose HUD banner keyed 'win' / 'winner' / 'gameover';
   *   - a running score or map-progress readout keyed 'score' / 'map',
   *     shown or updated during play (the continuous-loop case).
   * A template matching none of these ships with no reachable objective and
   * fails OP-01 — that is the assertion, not a check that some text is present.
   */
  const OUTCOME_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
    { label: 'forge.game.win()', re: /forge\.game\.win\s*\(/ },
    { label: "win/lose banner", re: /forge\.ui\.showText\(\s*['"](?:win|winner|gameover)['"]/i },
    { label: 'score/progress readout', re: /forge\.ui\.(?:show|update)Text\(\s*['"](?:score|map)['"]/i },
  ];

  /**
   * The set of dotted `forge.<...>` CALL paths `forgeTypes.ts` actually
   * declares — e.g. `forge.getTransform`, `forge.scene.findByName`,
   * `forge.physics2d.setVelocityX`, `forge.game.win`. Parsed from the shipped
   * `.d.ts` string rather than hand-listed, so it cannot drift from the surface
   * the sandbox really exposes.
   *
   * Only CALL signatures (`function name(`) are recorded. Const members such as
   * `forge.time.delta` are read, never called, so the usage scan below (which
   * matches `forge....(`) never asks about them and they need no entry.
   */
  function buildValidForgeCallPaths(defs: string): Set<string> {
    const valid = new Set<string>();
    const nsStack: string[] = [];
    for (const rawLine of defs.split('\n')) {
      const line = rawLine.trim();
      const nsOpen = line.match(/^(?:declare\s+)?namespace\s+([A-Za-z0-9_]+)\s*\{/);
      if (nsOpen) {
        nsStack.push(nsOpen[1]);
        continue;
      }
      // A bare `}` closes a namespace. Object type literals in this file always
      // close as `}>): void;` / `}): void;` / `} | null`, never as a bare `}`,
      // so this only ever pops a namespace — verified by the self-check test
      // that the parse recovers a known-present nested method.
      if (line === '}') {
        nsStack.pop();
        continue;
      }
      const fn = line.match(/^function\s+([A-Za-z0-9_]+)\s*\(/);
      if (fn && nsStack.length > 0 && nsStack[0] === 'forge') {
        valid.add([...nsStack, fn[1]].join('.'));
      }
    }
    return valid;
  }

  const VALID_FORGE_CALLS = buildValidForgeCallPaths(FORGE_TYPE_DEFINITIONS);

  /** Every `forge.<dotted.path>(` call site in a body of script text. */
  function forgeCallsUsedIn(text: string): string[] {
    const found: string[] = [];
    const pattern = /\bforge\.((?:[A-Za-z0-9_]+\.)*[A-Za-z0-9_]+)\s*\(/g;
    for (const m of text.matchAll(pattern)) found.push('forge.' + m[1]);
    return found;
  }

  /** Every `forge.input.<m>('action')` reference — the input wiring. */
  function inputActionsUsedIn(text: string): string[] {
    const found: string[] = [];
    const pattern =
      /\bforge\.input\.(?:isPressed|justPressed|justReleased|getAxis)\s*\(\s*['"]([^'"]+)['"]/g;
    for (const m of text.matchAll(pattern)) found.push(m[1]);
    return found;
  }

  function combinedScripts(template: GameTemplate): string {
    return Object.values(template.scripts ?? {})
      .map((s) => s.source)
      .join('\n');
  }

  // Load every 2D starter once for the whole block.
  const loaded = new Map<string, GameTemplate>();
  beforeAll(async () => {
    for (const { id } of TWO_D_STARTERS) {
      const entry = TEMPLATE_REGISTRY.find((e) => e.id === id);
      expect(entry, `2D starter ${id} is not in TEMPLATE_REGISTRY`).toBeDefined();
      loaded.set(id, await entry!.load());
    }
  });

  /**
   * The parser is only trustworthy if it recovers symbols we KNOW are declared,
   * across the top level and a nested namespace, and rejects one we know is
   * absent. Without this a broken parse could return an empty set and every
   * OP-02 symbol check below would pass vacuously (lesson 9).
   */
  it('parses the real forge call surface from forgeTypes (parser self-check)', () => {
    expect(VALID_FORGE_CALLS.size).toBeGreaterThan(50);
    expect(VALID_FORGE_CALLS.has('forge.getTransform')).toBe(true);
    expect(VALID_FORGE_CALLS.has('forge.setColor')).toBe(true);
    expect(VALID_FORGE_CALLS.has('forge.scene.findByNameExact')).toBe(true);
    expect(VALID_FORGE_CALLS.has('forge.physics2d.setVelocityX')).toBe(true);
    expect(VALID_FORGE_CALLS.has('forge.game.win')).toBe(true);
    // `onStart` / `onUpdate` are top-level lifecycle globals, NOT members of the
    // `forge` namespace, so `forge.onStart(...)` must be rejected.
    expect(VALID_FORGE_CALLS.has('forge.onStart')).toBe(false);
    // Namespaces that have never existed.
    expect(VALID_FORGE_CALLS.has('forge.material.setBaseColor')).toBe(false);
    expect(VALID_FORGE_CALLS.has('forge.transform.getPosition')).toBe(false);
  });

  // OP-01: every 2D starter is registered under its declared category.
  it('registers all six 2D starters (2d.FR-2.OP-01)', () => {
    for (const { id, category } of TWO_D_STARTERS) {
      const entry = TEMPLATE_REGISTRY.find((e) => e.id === id);
      expect(entry, `missing 2D starter: ${id}`).toBeDefined();
      expect(entry!.category, `${id} category`).toBe(category);
    }
    // The registry must carry exactly six `2d_`-category entries — a seventh
    // (or a sixth removed) is a change to this owned set that must update this
    // list deliberately, not slip through.
    const twoDInRegistry = TEMPLATE_REGISTRY.filter((e) => e.category.startsWith('2d_'));
    expect(twoDInRegistry.map((e) => e.id).sort()).toEqual(
      TWO_D_STARTERS.map((s) => s.id).sort(),
    );
  });

  for (const { id } of TWO_D_STARTERS) {
    describe(`2d starter: ${id}`, () => {
      // OP-01: reachable outcome.
      it('declares a reachable win/score/progress outcome (2d.FR-2.OP-01)', () => {
        const text = combinedScripts(loaded.get(id)!);
        const matched = OUTCOME_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
        expect(
          matched.length,
          `${id} scripts declare no reachable outcome (no win call, no win/lose banner, no score/progress readout)`,
        ).toBeGreaterThan(0);
      });

      // OP-02: every forge.* call the scripts make must exist in forgeTypes.
      it('calls only forge.* symbols that exist in forgeTypes (2d.FR-2.OP-02)', () => {
        const text = combinedScripts(loaded.get(id)!);
        const calls = forgeCallsUsedIn(text);
        expect(calls.length, `${id} makes no forge.* calls at all`).toBeGreaterThan(0);
        const unknown = [...new Set(calls)].filter((c) => !VALID_FORGE_CALLS.has(c));
        expect(
          unknown,
          `${id} scripts call forge symbols that forgeTypes.ts does not declare`,
        ).toEqual([]);
      });

      // OP-02: the loop that reaches the outcome is wired to input. Existence of
      // each named action is enforced by inputActionConformance.test.ts; here we
      // assert the wiring is present at all.
      it('wires its game loop to input actions (2d.FR-2.OP-02)', () => {
        const text = combinedScripts(loaded.get(id)!);
        const actions = inputActionsUsedIn(text);
        expect(
          actions.length,
          `${id} reads no input action — its game loop responds to no control`,
        ).toBeGreaterThan(0);
      });
    });
  }
});
