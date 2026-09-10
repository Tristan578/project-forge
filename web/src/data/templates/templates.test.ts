import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATE_REGISTRY, loadTemplate, getTemplateInfo } from './index';
import type { GameTemplate } from './index';

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
