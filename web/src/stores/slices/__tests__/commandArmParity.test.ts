/**
 * @vitest-environment node
 *
 * Every command name a store slice dispatches must be matched by an engine
 * dispatch arm that is actually implemented — or sit on the allowlist below
 * WITH a written reason.
 *
 * Why this pin exists: `dispatchCommand` returns void. A name the engine has
 * never known produces `Err("Unknown command: ...")` deep inside
 * `commands::dispatch`, which nothing reads — no exception, no failed test, no
 * log. PF-1170 found fourteen such names sitting in shipped slices, four of
 * which had a working arm under a different spelling the whole time.
 *
 * An arm that exists but only returns `Not yet implemented` counts as absent
 * here, and that distinction is load-bearing: `engine/src/core/commands/animation.rs`
 * holds nine inline stub arms, so a name-only scan reports the entire
 * animation-clip surface as routed when none of it does anything.
 *
 * A working arm is ALSO not enough. `commands::dispatch` consults `route_domain`
 * first, and an unlisted name returns 255 → `Err("Unknown command: ...")` before
 * any domain module is reached. So an arm the router does not name is dead however
 * correct it is, and this pin requires both. `route_domain` pointing a name at the
 * WRONG domain is a third way to be dead; that one is checked on the Rust side, in
 * `mod.rs`'s `route_domain_parity` module, which can compare indices directly.
 *
 * Modelled on `web/src/lib/cutscene/__tests__/dispatch.test.ts`. Fails closed on
 * an unreadable or unparseable source file rather than passing vacuously.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// __dirname is web/src/stores/slices/__tests__ — five levels below the repo root.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const ENGINE_COMMANDS_DIR = join(REPO_ROOT, 'engine', 'src', 'core', 'commands');
const SLICES_DIR = join(__dirname, '..');
const WEB_SRC_DIR = join(REPO_ROOT, 'web', 'src');

/**
 * Names the store dispatches that no implemented engine arm handles. Each entry
 * MUST carry a reason and a ticket. The staleness checks below fail if an entry
 * becomes implemented or stops being dispatched, so this list cannot rot.
 */
const ALLOWED_UNROUTED: Record<string, string> = {
  // PF-1174: the whole clip-authoring surface is an engine placeholder.
  // `create_animation_clip` matches a stub arm; the other six have no arm at all
  // (the engine's stubs are spelled `add_keyframe`/`remove_keyframe`/`update_keyframe`).
  // Live callers: AnimationClipInspector, TimelinePanel, ProceduralAnimPanel,
  // and animationParticleHandlers. All of it writes Zustand and nothing else.
  create_animation_clip: 'PF-1174 — engine arm is a `Not yet implemented` stub',
  add_clip_keyframe: 'PF-1174 — engine-side clip authoring unimplemented',
  remove_clip_keyframe: 'PF-1174 — engine-side clip authoring unimplemented',
  update_clip_keyframe: 'PF-1174 — engine-side clip authoring unimplemented',
  set_clip_property: 'PF-1174 — engine-side clip authoring unimplemented',
  preview_clip: 'PF-1174 — engine-side clip authoring unimplemented',
  remove_animation_clip: 'PF-1174 — engine-side clip authoring unimplemented',

  // PF-1179: `sprites.rs` implements both against a per-entity `TilesetData`
  // component keyed by `entityId`, but the store keys tilesets by asset id and
  // the only caller has no entity to name. So they are deliberately left out of
  // `route_domain` — routing them would trade a silent no-op for a silent
  // `Missing entityId`. One side has to give first.
  set_tileset: 'PF-1179 — entity-keyed engine arm vs asset-keyed caller',
  remove_tileset: 'PF-1179 — entity-keyed engine arm vs asset-keyed caller',

  // PF-1176 / PF-1177: no arm under any spelling, and no removal infrastructure
  // either — each needs a pending-queue field and an apply system before an arm
  // can do anything. Not a rename, so deliberately not fixed alongside the four
  // renames in PF-1170.
  remove_skeleton_2d: 'PF-1176 — needs pending field + apply system + arm',
};

/**
 * Initial reverse-parity debt captured by PF-1189. These are deliberately a
 * ratchet, not an assertion that the commands should stay caller-less: wiring
 * any one makes its waiver stale and fails the suite until the name is removed.
 */
const UNDISPATCHED_AT_BASELINE = [
  'get_animation_state', 'list_animations', 'get_animation_graph',
  'get_audio', 'update_audio_bus', 'create_audio_bus', 'delete_audio_bus',
  'get_audio_buses', 'set_bus_effects', 'get_reverb_zone',
  'enter_edit_mode', 'exit_edit_mode', 'set_selection_mode', 'select_elements',
  'mesh_operation', 'recalc_normals', 'get_game_components',
  'list_game_component_types', 'mouse_delta', 'get_game_camera', 'get_shader',
  'get_post_processing', 'get_mode', 'get_scene_graph', 'get_selection',
  'get_entity_details', 'get_camera_state', 'get_particle', 'get_physics',
  'apply_force', 'list_joints', 'set_physics2d', 'update_physics2d',
  'toggle_physics2d', 'remove_physics2d', 'set_2d_collider_shape',
  'set_2d_body_type', 'create_2d_joint', 'update_2d_joint', 'remove_2d_joint',
  'apply_force2d', 'apply_impulse2d', 'raycast2d', 'get_physics2d',
  'enable_physics_debug', 'disable_physics_debug', 'apply_impulse', 'raycast',
  'get_joint', 'set_physics_2d_enabled', 'get_physics_2d', 'get_joint_2d',
  'list_joints_2d', 'apply_force_2d', 'apply_impulse_2d', 'get_terrain',
  'instantiate_prefab', 'get_quality_settings', 'list_assets', 'get_script',
  'list_script_templates', 'apply_script_template', 'query_play_state',
  'export_scene_json', 'import_scene_json', 'list_scene_assets', 'get_sprite',
  'get_camera_2d', 'add_bone2d', 'remove_bone2d', 'update_bone2d',
  'create_skeletal_animation2d', 'add_keyframe2d', 'play_skeletal_animation2d',
  'set_skeleton2d_skin', 'create_ik_chain2d', 'get_skeleton2d',
  'set_sorting_layers', 'get_sprite_sheet_state', 'get_sprite_animator_state',
  'paint_tile', 'erase_tile', 'fill_tiles', 'set_grid_2d', 'resize',
  'despawn_entity', 'orbit_camera', 'get_input_bindings', 'get_input_state',
] as const;

const ALLOWED_UNDISPATCHED: Record<string, string> = Object.fromEntries(
  UNDISPATCHED_AT_BASELINE.map((name) => [
    name,
    'PF-1189 — implemented and routed, but no literal production browser dispatch at baseline',
  ]),
);

/** Text of a brace-balanced block starting at `openIndex` (which must be a `{`). */
function blockAt(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(openIndex, i);
  }
  // Unbalanced braces mean the parse is unreliable — say so rather than
  // silently returning a truncated body that would under-report arms.
  throw new Error(`unbalanced braces starting at offset ${openIndex}`);
}

/** `[name, body]` for every `fn <namePattern>(...) { ... }` in `source`. */
function fnBodies(source: string, namePattern: string): Array<[string, string]> {
  const bodies: Array<[string, string]> = [];
  const sig = new RegExp(`fn (${namePattern})\\s*\\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = sig.exec(source)) !== null) {
    const open = source.indexOf('{', sig.lastIndex);
    if (open !== -1) bodies.push([m[1], blockAt(source, open)]);
  }
  return bodies;
}

const NOT_IMPLEMENTED = /is not implemented|Not yet implemented/;

interface EngineArms {
  implemented: Set<string>;
  stubbed: Set<string>;
  /** Names `route_domain` sends to a domain module. Anything else is unreachable. */
  routed: Set<string>;
  /** Arms that exist and are not stubs, but that `route_domain` never names. */
  armedButUnrouted: Set<string>;
  fileCount: number;
  dispatchBodyCount: number;
}

/**
 * Body of a TOP-LEVEL `fn <name>(...)`, i.e. one whose `fn` starts at column 0.
 *
 * `fnBodies` matches the signature anywhere in the file, which is right for
 * scanning handlers but wrong for a named singleton: `mod.rs` mentions
 * `fn route_domain(` twice more inside indented string literals in its own
 * `route_domain_parity` tests, and a whole-file match counts those as real
 * definitions. Anchoring on the newline is exactly what the Rust-side scanner
 * does, and it fails closed — a definition this cannot find reports as absent,
 * never as empty-but-present.
 */
function topLevelFnBody(source: string, name: string): string | undefined {
  const at = source.indexOf(`\nfn ${name}(`);
  if (at === -1) return undefined;
  const open = source.indexOf('{', at);
  return open === -1 ? undefined : blockAt(source, open);
}

/** Every command name listed in `fn route_domain`, whatever domain it maps to. */
function readRoutedNames(): Set<string> {
  const source = readFileSync(join(ENGINE_COMMANDS_DIR, 'mod.rs'), 'utf8');
  // `route_domain` is private, so match on `fn` alone rather than `pub fn`. An
  // anchor written `pub fn route_domain` matches nothing and reads exactly like
  // "the router names no commands" — a scanner failure that looks like a pass.
  const body = topLevelFnBody(source, 'route_domain');
  if (body === undefined) {
    throw new Error('mod.rs has no top-level `fn route_domain(` — the scanner is broken');
  }
  // Comments are stripped first: PF-1181 left explanatory comments in
  // `route_domain` naming the twenty command names it deleted, and a raw scan
  // would read those back as still routed.
  const arms = body
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');
  // What is left is nothing but match arms, so every quoted lower-snake token
  // in it is a command name.
  return new Set([...arms.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]));
}

function readEngineArms(): EngineArms {
  const files = readdirSync(ENGINE_COMMANDS_DIR).filter((f) => f.endsWith('.rs'));
  const sources = files.map((f) => readFileSync(join(ENGINE_COMMANDS_DIR, f), 'utf8'));

  // Handlers whose whole body is a not-implemented error. An arm delegating to
  // one of these is stubbed even though the arm itself looks ordinary.
  const stubHandlers = new Set<string>();
  for (const source of sources) {
    for (const [name, body] of fnBodies(source, '\\w+')) {
      if (NOT_IMPLEMENTED.test(body)) stubHandlers.add(name);
    }
  }

  const implemented = new Set<string>();
  const stubbed = new Set<string>();
  let dispatchBodyCount = 0;

  for (const source of sources) {
    // Scoped to `dispatch` bodies: a whole-file scan matches quoted payload
    // VALUES ("mask", "high", "toggle") as if they were command names.
    for (const [, body] of fnBodies(source, 'dispatch')) {
      dispatchBodyCount++;
      for (const arm of body.matchAll(/"([a-z0-9_]+)"\s*(?:=>|\|)/g)) {
        const window = body.slice(arm.index ?? 0, (arm.index ?? 0) + 200);
        // Two stub shapes: delegated to a stub handler, or written inline in the
        // arm itself (`=> Some(Err("Not yet implemented: x".to_string()))`).
        const handler = window.match(/\bhandle_\w+/)?.[0];
        const inlineStub = NOT_IMPLEMENTED.test(window.split('\n')[0]);
        if (inlineStub || (handler !== undefined && stubHandlers.has(handler))) {
          stubbed.add(arm[1]);
        } else {
          implemented.add(arm[1]);
        }
      }
    }
  }
  // An `a | b => handler` group where the handler is a stub marks every name in
  // the group; a name reached both ways is not implemented.
  for (const name of stubbed) implemented.delete(name);

  // An arm the router never names cannot run, so it does not count as
  // implemented. Tracked separately so the checks below can prove this
  // subtraction is really happening rather than being vacuous.
  const routed = readRoutedNames();
  const armedButUnrouted = new Set([...implemented].filter((name) => !routed.has(name)));
  for (const name of armedButUnrouted) implemented.delete(name);

  return {
    implemented,
    stubbed,
    routed,
    armedButUnrouted,
    fileCount: files.length,
    dispatchBodyCount,
  };
}

interface StoreDispatches {
  /** Command name -> the slice file that dispatches it. */
  names: Map<string, string>;
  /** Files holding a dispatch whose command name this scanner cannot read. */
  unreadable: string[];
  fileCount: number;
}

function readStoreDispatches(): StoreDispatches {
  const names = new Map<string, string>();
  const unreadable: string[] = [];
  const files = readdirSync(SLICES_DIR).filter((f) => f.endsWith('.ts'));

  for (const file of files) {
    const source = readFileSync(join(SLICES_DIR, file), 'utf8');
    // A dispatch built from a variable is invisible to a literal scan, so the pin
    // would silently stop covering it. Report rather than under-report.
    const allCalls = source.match(/dispatchCommand\(/g)?.length ?? 0;
    const literalCalls = source.match(/dispatchCommand\(\s*'/g)?.length ?? 0;
    if (literalCalls !== allCalls) {
      unreadable.push(`${file} (${allCalls - literalCalls} non-literal)`);
    }

    for (const m of source.matchAll(/dispatchCommand\(\s*'([a-z0-9_]+)'/g)) {
      if (!names.has(m[1])) names.set(m[1], file);
    }
  }
  return { names, unreadable, fileCount: files.length };
}

function productionSources(dir: string): string[] {
  const sources: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') sources.push(...productionSources(full));
    } else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) {
      sources.push(readFileSync(full, 'utf8'));
    }
  }
  return sources;
}

/** Commands passed at a literal browser dispatch call site outside tests. */
function readBrowserDispatches(): Set<string> {
  const names = new Set<string>();
  for (const source of productionSources(WEB_SRC_DIR)) {
    for (const match of source.matchAll(
      /\b(?:dispatchCommand|engineDispatch|dispatch)\(\s*['"]([a-z0-9_]+)['"]/g,
    )) {
      names.add(match[1]);
    }
  }
  return names;
}

describe('store command names have engine dispatch arms', () => {
  const arms = readEngineArms();
  const store = readStoreDispatches();
  const storeDispatches = store.names;
  const browserDispatches = readBrowserDispatches();

  describe('the parsers actually parsed something', () => {
    it('read the engine command modules', () => {
      expect(arms.fileCount).toBeGreaterThan(5);
      expect(arms.dispatchBodyCount).toBeGreaterThan(5);
      expect(arms.implemented.size).toBeGreaterThan(200);
    });

    it('found the engine stub arms', () => {
      // If this collapses to zero the stub detection has broken and every stub
      // would be scored as implemented — the exact blind spot PF-1170 hit.
      expect(arms.stubbed.size).toBeGreaterThan(20);
    });

    it('read the router', () => {
      // A collapsed parse here would subtract every arm and turn the parity
      // check into noise; an over-wide one would subtract nothing and restore
      // the blind spot this scan exists to close.
      expect(arms.routed.size).toBeGreaterThan(200);
    });

    it('actually subtracts arms the router does not name', () => {
      // Proves the routed intersection is doing work. If the engine ever routes
      // every arm this drops to zero and the assertion should be relaxed
      // deliberately — not left passing on a scan that stopped subtracting.
      expect(arms.armedButUnrouted.size).toBeGreaterThan(0);
      expect(arms.armedButUnrouted.has('set_tileset')).toBe(true);
      expect(arms.implemented.has('set_tileset')).toBe(false);
    });

    it('read the store slices', () => {
      expect(store.fileCount).toBeGreaterThan(10);
      expect(storeDispatches.size).toBeGreaterThan(100);
    });

    it('can read the command name of every dispatch call', () => {
      expect(
        store.unreadable,
        'This pin only sees string-literal command names. Either inline the name at ' +
          'the dispatch site or teach this scanner about the new shape — a dispatch it ' +
          'cannot read is a dispatch it silently stops covering.',
      ).toEqual([]);
    });

    it.each([
      'spawn_entity',
      'play_audio',
      'set_game_camera',
      'play_animation',
      'update_physics',
      'remove_sprite',
      'update_camera_2d',
      'set_reverb_zone',
      'create_skeleton2d',
      // Routed by PF-1178 after sitting implemented-but-unreachable.
      'set_tilemap_data',
      'remove_tilemap_data',
      'set_animation_state_machine',
      'remove_animation_state_machine',
    ])('scores %s as implemented', (name) => {
      expect(arms.implemented.has(name)).toBe(true);
    });

    it.each(['create_animation_clip', 'play_animation_clip', 'get_animation_clips'])(
      'scores the stub arm %s as NOT implemented',
      (name) => {
        expect(arms.stubbed.has(name)).toBe(true);
        expect(arms.implemented.has(name)).toBe(false);
      },
    );

    it.each([
      'get_all_reverb_zones',
      'list_particle_presets',
      'extrude_faces',
      'create_tileset',
      'delete_tileset',
      'create_tilemap',
      'delete_tilemap',
      'clear_tilemap',
      'set_tile',
      'solve_ik2d',
      'set_skeleton_skin2d',
      'add_skeletal_keyframe2d',
    ])('does not route the deleted name %s', (name) => {
      // PF-1181 deleted twenty names the router advertised with no arm behind
      // them. Their deletion left explanatory comments in `route_domain` that
      // still spell the names, so this doubles as the pin on the comment strip
      // in `readRoutedNames`: without it every one of these reads as routed.
      expect(arms.routed.has(name)).toBe(false);
      expect(arms.implemented.has(name)).toBe(false);
    });

    it.each(['mask', 'blend', 'value', 'high', 'add', 'toggle', 'step'])(
      'does not mistake the payload value %s for a command name',
      (value) => {
        expect(arms.implemented.has(value)).toBe(false);
        expect(arms.stubbed.has(value)).toBe(false);
      },
    );
  });

  it('every dispatched name is implemented or allowlisted with a reason', () => {
    const unrouted = [...storeDispatches]
      .filter(([name]) => !arms.implemented.has(name))
      .filter(([name]) => !Object.hasOwn(ALLOWED_UNROUTED, name))
      .map(([name, file]) => `${name} (${file})`);

    expect(
      unrouted,
      'These command names reach no implemented engine arm. Add the arm, fix the ' +
        'spelling, delete the dead store action, or add an ALLOWED_UNROUTED entry ' +
        'with a reason and a ticket.',
    ).toEqual([]);
  });

  it('every allowlist entry carries a reason', () => {
    const bare = Object.entries(ALLOWED_UNROUTED)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([name]) => name);
    expect(bare, 'An allowlist entry without a real reason is not a waiver.').toEqual([]);
  });

  it('no allowlist entry is now implemented', () => {
    const stale = Object.keys(ALLOWED_UNROUTED).filter((name) => arms.implemented.has(name));
    expect(
      stale,
      'The engine now implements these — delete their ALLOWED_UNROUTED entries.',
    ).toEqual([]);
  });

  it('no allowlist entry has stopped being dispatched', () => {
    const orphaned = Object.keys(ALLOWED_UNROUTED).filter((name) => !storeDispatches.has(name));
    expect(
      orphaned,
      'No store slice dispatches these any more — delete their ALLOWED_UNROUTED entries.',
    ).toEqual([]);
  });

  it('every routed engine command has a browser dispatch site or a reasoned waiver', () => {
    const unreachable = [...arms.implemented]
      .filter((name) => !browserDispatches.has(name))
      .filter((name) => !Object.hasOwn(ALLOWED_UNDISPATCHED, name));
    expect(
      unreachable,
      'These implemented, routed engine commands have no literal browser dispatch site. ' +
        'Wire a caller or add an ALLOWED_UNDISPATCHED entry with a reason and ticket.',
    ).toEqual([]);
  });

  it('every reverse-parity waiver carries a reason', () => {
    const bare = Object.entries(ALLOWED_UNDISPATCHED)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([name]) => name);
    expect(bare, 'A reverse-parity waiver without a real reason is not a waiver.').toEqual([]);
  });

  it('no reverse-parity waiver has gained a browser dispatch site', () => {
    const stale = Object.keys(ALLOWED_UNDISPATCHED).filter((name) => browserDispatches.has(name));
    expect(stale, 'These commands now have callers — delete their reverse-parity waivers.').toEqual([]);
  });

  it('no reverse-parity waiver names a command that stopped being implemented', () => {
    const orphaned = Object.keys(ALLOWED_UNDISPATCHED).filter((name) => !arms.implemented.has(name));
    expect(orphaned, 'These commands are no longer implemented — delete their waivers.').toEqual([]);
  });
});
