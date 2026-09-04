import { describe, it, expect } from 'vitest';
import manifest from '../manifest/commands.json';

const EXPECTED_CATEGORIES = [
  'animation', 'asset', 'audio', 'camera', 'compound', 'cutscene', 'dialogue',
  'docs', 'economy', 'editor', 'environment', 'export', 'game_cameras',
  'game_components', 'generation', 'history', 'lighting', 'localization',
  'materials', 'mesh', 'modeling', 'particles', 'performance', 'physics2d',
  'prefab', 'publishing', 'query', 'rendering', 'runtime', 'scene', 'scripting',
  'security', 'shaders', 'skeleton2d', 'sprite', 'sprite_animation', 'templates',
  'terrain', 'tilemap', 'ui', 'world_building',
];

/**
 * The classification criterion for `destructive`, stated once so it can be
 * checked against the data rather than inferred from it.
 *
 * A command is destructive when undoing it would make the user re-AUTHOR
 * content, rather than re-issue the inverse command with the same arguments:
 *
 *   1. it deletes or overwrites authored content — an entity, scene, prefab,
 *      cutscene, dialogue tree, tilemap layer (or the tiles painted into one,
 *      including a resize that discards what falls outside the new bounds),
 *      UI screen or widget, library asset, animation clip, or script source;
 *   2. it wholesale replaces the current scene — `new_scene`, `load_scene`,
 *      `switch_scene`, `load_template`, and the `*_from_description` /
 *      `start_from_idea` scaffolders;
 *   3. it has an irreversible effect outside the editor session —
 *      `publish_game`, `delete_leaderboard`, `delete_asset`.
 *
 * Detaching a COMPONENT from an entity is not destructive under this
 * criterion: re-attaching it is a single command carrying the same parameters.
 * That is the line the DESTRUCTIVE_RULE_EXEMPT entries below sit on.
 *
 * The same criterion is restated at the point of use in
 * `web/src/lib/ai/spawnforgeAgent.ts`; keep the two in sync.
 */
const DESTRUCTIVE_NAME_RULE =
  /^(?:despawn_|delete_|clear_|remove_)|^(?:new_scene|load_scene|load_scene_with_transition|switch_scene|load_template|publish_game|start_from_idea)$|_from_description$/;

/**
 * Commands that match DESTRUCTIVE_NAME_RULE by name but are NOT destructive
 * under the criterion above. Every entry needs a one-line reason.
 */
const DESTRUCTIVE_RULE_EXEMPT: Record<string, string> = {
  clear_selection: 'changes only the editor selection; no scene data is touched',
  remove_audio: 'detaches the audio component; re-attached by one add_audio call',
  remove_background: 'no-op stub — the handler returns an error pointing at generate_sprite',
  remove_bone2d: 'removes one named bone; re-added by one add_bone2d with the same name/parent',
  remove_clip_keyframe: 'removes one keyframe; re-added by one add_clip_keyframe at the same time',
  remove_custom_shader: 'reverts an entity to standard PBR; re-applied by one command',
  remove_custom_shader_slot: 'unregisters a slot; entities fall back to passthrough rendering',
  remove_game_component: 'detaches one game component; re-added by one add_game_component call',
  remove_input_binding: 'removes one named input binding; re-added by one add_input_binding call',
  remove_joint: 'removes one physics joint; re-added by one create_joint call',
  remove_particle: 'detaches the particle component; re-attached by one add_particle call',
  remove_physics2d: 'detaches the 2D physics component; re-attached by one add_physics2d call',
  remove_reverb_zone: 'detaches the reverb zone component; re-attached by one command',
  remove_shader_from_entity: 'restores the default material; re-applied by one command',
  remove_skybox: 'reverts to the clear-color background; re-applied by one set_skybox call',
  remove_texture: 'clears one material texture slot; re-set by one set_texture call',
  remove_ui_binding: 'removes one widget data binding; re-added by one add_ui_binding call',
};

/**
 * Pinned snapshot of the gated set. Mirrored client-side in
 * `web/src/lib/chat/destructiveCommands.ts` (which its own test pins against
 * this manifest) — change both together.
 */
const EXPECTED_DESTRUCTIVE_COMMANDS = [
  'clear_tiles',
  'clear_world',
  'create_scene_from_description',
  'delete_asset',
  'delete_audio_bus',
  'delete_cutscene',
  'delete_entities',
  'delete_leaderboard',
  'delete_library_material',
  'delete_library_script',
  'delete_prefab',
  'delete_scene',
  'delete_ui_screen',
  'despawn_entity',
  'load_scene',
  'load_scene_with_transition',
  'load_template',
  'new_scene',
  'publish_game',
  'remove_animation_clip',
  'remove_dialogue_tree',
  'remove_script',
  'remove_tilemap_layer',
  'remove_ui_widget',
  'resize_tilemap',
  'set_script',
  'setup_game_from_description',
  'start_from_idea',
  'switch_scene',
  'update_library_script',
];

describe('command manifest', () => {
  it('has a version field', () => {
    expect(manifest.version).toBe('1.0');
  });

  it('has at least 20 commands', () => {
    expect(manifest.commands.length).toBeGreaterThanOrEqual(20);
  });

  it('every command has required fields', () => {
    for (const cmd of manifest.commands) {
      expect(cmd.name, `command missing name`).toBeTruthy();
      expect(cmd.description, `${cmd.name} missing description`).toBeTruthy();
      expect(cmd.category, `${cmd.name} missing category`).toBeTruthy();
      expect(cmd.parameters, `${cmd.name} missing parameters`).toBeDefined();
      expect(typeof cmd.tokenCost, `${cmd.name} tokenCost not number`).toBe('number');
      expect(cmd.requiredScope, `${cmd.name} missing requiredScope`).toBeTruthy();
    }
  });

  it('every command has unique name', () => {
    const names = manifest.commands.map((c: { name: string }) => c.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('parameters are valid JSON Schema objects', () => {
    for (const cmd of manifest.commands) {
      const params = cmd.parameters as { type?: string; properties?: Record<string, unknown> };
      expect(params.type, `${cmd.name}: parameters.type should be 'object'`).toBe('object');
      expect(params.properties, `${cmd.name}: parameters.properties missing`).toBeDefined();
    }
  });

  it('categories use valid snake_case format', () => {
    const categoryPattern = /^[a-z][a-z0-9_]*$/;
    for (const cmd of manifest.commands) {
      expect(
        categoryPattern.test(cmd.category),
        `${cmd.name}: category '${cmd.category}' must match [a-z][a-z0-9_]* pattern`,
      ).toBe(true);
    }
  });

  it('category set has not changed unexpectedly (snapshot guard)', () => {
    const actualCategories = [...new Set(
      manifest.commands.map((c: { category: string }) => c.category),
    )].sort();

    expect(
      actualCategories,
      'Manifest category set changed — update EXPECTED_CATEGORIES if intentional',
    ).toEqual(EXPECTED_CATEGORIES);
  });

  it('scene edit commands have zero token cost', () => {
    const sceneEditCmds = manifest.commands.filter(
      (c: { category: string; name: string }) => c.category === 'scene' || c.category === 'editor' || c.category === 'camera' || c.category === 'history'
    );
    for (const cmd of sceneEditCmds) {
      expect(cmd.tokenCost, `${cmd.name} should be free`).toBe(0);
    }
  });

  it('expected commands exist', () => {
    const names = new Set(manifest.commands.map((c: { name: string }) => c.name));
    const expected = [
      'spawn_entity', 'despawn_entity', 'update_transform',
      'update_material', 'undo', 'redo',
      'get_scene_graph', 'get_selection',
    ];
    for (const name of expected) {
      expect(names.has(name), `missing command: ${name}`).toBe(true);
    }
  });

  it('required scopes use valid format', () => {
    const scopePattern = /^[a-z_]+:(read|write|generate|manage)$/;
    for (const cmd of manifest.commands) {
      expect(
        scopePattern.test(cmd.requiredScope),
        `${cmd.name}: invalid scope format '${cmd.requiredScope}'`
      ).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // PF-8860 — the `destructive` flag that drives the chat agent's approval gate
  // -------------------------------------------------------------------------
  describe('destructive flag', () => {
    const flagged = manifest.commands.filter(
      (c) => (c as { destructive?: unknown }).destructive === true,
    );

    it('is present on a non-empty, plausible subset of commands', () => {
      // A gate derived from zero flagged commands gates nothing and would pass
      // every other assertion in this block vacuously.
      expect(flagged.length).toBeGreaterThan(10);
      expect(flagged.length).toBeLessThan(manifest.commands.length / 4);
    });

    it('is an explicit boolean on EVERY command', () => {
      // Absence used to mean "not destructive", which makes a forgotten flag
      // indistinguishable from a deliberate `false` — the safe-by-omission
      // shape that let `remove_script` ship unflagged. Classification is now
      // mandatory: adding a command forces a yes/no answer.
      for (const cmd of manifest.commands) {
        const value = (cmd as { destructive?: unknown }).destructive;
        expect(
          typeof value,
          `${cmd.name}: \`destructive\` must be an explicit true/false`,
        ).toBe('boolean');
      }
    });

    it('flags every command whose name says it removes or replaces content', () => {
      // A RULE, not a name list: any command matching these prefixes is
      // destructive unless it appears in EXEMPT with a stated reason. A new
      // `delete_*`/`remove_*` command therefore fails this test on the PR that
      // adds it, rather than silently defaulting to ungated.
      const candidates = manifest.commands.filter(
        (c) => DESTRUCTIVE_NAME_RULE.test(c.name),
      );
      // The rule must actually match something, or it passes vacuously.
      expect(candidates.length).toBeGreaterThan(20);

      const unaccounted = candidates
        .filter((c) => (c as { destructive?: unknown }).destructive !== true)
        .map((c) => c.name)
        .filter((name) => !(name in DESTRUCTIVE_RULE_EXEMPT));

      expect(
        unaccounted,
        'These commands match the destructive naming rule but are neither '
          + 'flagged `destructive: true` nor listed in DESTRUCTIVE_RULE_EXEMPT '
          + 'with a reason. Flag them, or exempt them and say why.',
      ).toEqual([]);
    });

    it('has no stale DESTRUCTIVE_RULE_EXEMPT entries', () => {
      // An exemption for a command that no longer exists, or that has since
      // been flagged, is dead documentation that hides the next mistake.
      for (const name of Object.keys(DESTRUCTIVE_RULE_EXEMPT)) {
        const cmd = manifest.commands.find((c) => c.name === name);
        expect(cmd, `DESTRUCTIVE_RULE_EXEMPT lists unknown command "${name}"`).toBeDefined();
        expect(
          (cmd as { destructive?: unknown } | undefined)?.destructive,
          `${name} is flagged destructive — remove its EXEMPT entry`,
        ).toBe(false);
      }
    });

    it('matches the pinned flagged set (snapshot guard)', () => {
      expect(
        flagged.map((c) => c.name).sort(),
        'The set of gated commands changed. If intentional, update '
          + 'EXPECTED_DESTRUCTIVE_COMMANDS here AND the mirrored client-side set '
          + 'in web/src/lib/chat/destructiveCommands.ts.',
      ).toEqual([...EXPECTED_DESTRUCTIVE_COMMANDS].sort());
    });

    it('covers the commands that destroy user content', () => {
      const names = new Set(flagged.map((c) => c.name));
      for (const name of [
        'delete_entities', 'despawn_entity', 'delete_scene', 'delete_prefab',
        'new_scene', 'clear_world', 'load_scene', 'switch_scene', 'publish_game',
      ]) {
        expect(names.has(name), `${name} must be flagged destructive`).toBe(true);
      }
    });

    it('leaves ordinary editing commands unflagged', () => {
      const names = new Set(flagged.map((c) => c.name));
      for (const name of ['spawn_entity', 'update_transform', 'set_visibility', 'update_material']) {
        expect(names.has(name), `${name} must NOT be flagged destructive`).toBe(false);
      }
    });
  });

  it.each(manifest.commands)('$name has valid visibility field', (cmd) => {
    expect(
      ['public', 'internal'],
      `Command "${cmd.name}" has visibility "${(cmd as { name: string; visibility?: string }).visibility}" — must be "public" or "internal"`,
    ).toContain((cmd as { name: string; visibility?: string }).visibility);
  });
});
