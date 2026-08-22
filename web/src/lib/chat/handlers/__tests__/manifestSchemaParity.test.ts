/**
 * Pins the MCP manifest's declared `parameters` against the Zod schema the
 * matching handler actually validates with.
 *
 * WHY THIS EXISTS
 * ---------------
 * `commands.json` is the tool surface the AI and every MCP client see; the Zod
 * schema inside the handler is what the arguments are actually checked against.
 * Nothing connected the two, so they drifted silently and in the direction that
 * cannot be noticed from either side alone: the manifest advertised `tileId` /
 * `layer` / `x,y,width,height` while the handlers had moved to `tileIndex` /
 * `layerIndex` / `fromX,fromY,toX,toY`, so a model following the documented
 * schema produced arguments that `parseArgs` rejected outright. The tool
 * "existed", was listed, and could never succeed (PF-1181).
 *
 * The manifest is data, so no type-checker sees it; the schema is built inside
 * an async function body, so nothing can import it. That leaves reading both
 * sources textually, which is the same idiom `gameCameraPayload.test.ts` uses
 * against the Rust engine defaults.
 *
 * SCOPE
 * -----
 * Deliberately scoped to `PINNED_CATEGORIES`, not the whole manifest: a full
 * sweep reports 71 other drifted entries that predate this test (43 where the
 * handler requires a key the manifest never documents, 17 where the manifest
 * documents a key the handler passes through unvalidated, 11 that differ only
 * in required-ness). Widening the scope is a one-line change once those are
 * fixed — see the tracking note in the commit that added this file. The scope
 * is itself asserted non-empty per category, so a category rename cannot
 * quietly empty the pin instead of failing it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import manifest from '@/data/commands.json';

const HANDLER_DIR = path.join(process.cwd(), 'src/lib/chat/handlers');

/** Categories whose manifest entries must match their handler schema exactly. */
const PINNED_CATEGORIES = ['tilemap'] as const;

/**
 * Command names registered by more than one handler module, where the winner is
 * decided purely by spread order in `executor.ts`. Every entry is a latent bug:
 * reordering the spreads silently swaps the implementation. These predate this
 * test and are listed so a NEW one fails instead of joining them unnoticed.
 *
 * `get_tilemap` was removed from this class rather than added to the list --
 * the `queryHandlers` copy read `store.tilemaps[entityId]` bare, so a
 * `'__proto__'` entity id returned `Object.prototype` as tilemap data.
 */
const KNOWN_DUPLICATE_REGISTRATIONS = [
  'get_animation_clip', 'get_animation_graph', 'get_animation_state',
  'get_audio_buses', 'get_camera_state', 'get_entity_details',
  'get_export_status', 'get_game_camera', 'get_game_components',
  'get_input_bindings', 'get_input_state', 'get_joint', 'get_mode',
  'get_particle', 'get_physics', 'get_physics2d', 'get_quality_settings',
  'get_scene_graph', 'get_scene_name', 'get_script', 'get_selection',
  'get_skeleton2d', 'get_sprite', 'get_sprite_generation_status',
  'get_terrain', 'get_token_balance', 'get_token_pricing', 'list_animations',
  'list_assets', 'list_game_component_types', 'list_script_templates',
] as const;

// ---------------------------------------------------------------------------
// Source parsing
// ---------------------------------------------------------------------------

/**
 * Strip the interior of every balanced `()`, `{}`, `[]` group, leaving only the
 * outermost expression text. Without this a nested `.optional()` on some inner
 * field would read as an `.optional()` on the field being classified.
 */
function outerChainOnly(expr: string): string {
  let out = '';
  let depth = 0;
  for (const ch of expr) {
    if (ch === '(' || ch === '{' || ch === '[') {
      if (depth === 0) out += ch;
      depth++;
      continue;
    }
    if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) out += ch;
      continue;
    }
    if (depth === 0) out += ch;
  }
  return out;
}

/** Advance past a string literal starting at `i`; returns the index after it. */
function skipString(src: string, i: number): number {
  const quote = src[i];
  i++;
  while (i < src.length && src[i] !== quote) {
    if (src[i] === '\\') i++;
    i++;
  }
  return i + 1;
}

/** Top-level `key: value` pairs of an object-literal body (braces excluded). */
function topLevelFields(body: string): { name: string; expr: string }[] {
  const fields: { name: string; expr: string }[] = [];
  let depth = 0;
  let i = 0;
  let keyStart = 0;
  let pendingKey: string | null = null;
  let valueStart = 0;

  const flush = (end: number) => {
    if (pendingKey !== null) {
      fields.push({ name: pendingKey, expr: body.slice(valueStart, end).trim() });
      pendingKey = null;
    }
  };

  while (i < body.length) {
    const ch = body[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(body, i);
      continue;
    }
    if (ch === '/' && body[i + 1] === '/') {
      while (i < body.length && body[i] !== '\n') i++;
      // Reset the key window past the comment. Without this the comment text
      // is prepended to the NEXT key, which then fails the identifier test and
      // is dropped silently -- a field the manifest must declare would vanish
      // from the comparison rather than fail it.
      if (pendingKey === null) keyStart = i;
      continue;
    }
    if (ch === '/' && body[i + 1] === '*') {
      const close = body.indexOf('*/', i);
      i = close === -1 ? body.length : close + 2;
      if (pendingKey === null) keyStart = i;
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') { depth++; i++; continue; }
    if (ch === ')' || ch === '}' || ch === ']') { depth--; i++; continue; }
    if (depth === 0 && ch === ':' && pendingKey === null) {
      const key = body.slice(keyStart, i).trim().replace(/^['"]|['"]$/g, '');
      if (/^[A-Za-z_$][\w$]*$/.test(key)) {
        pendingKey = key;
        valueStart = i + 1;
      }
      i++;
      continue;
    }
    if (depth === 0 && ch === ',') {
      flush(i);
      keyStart = i + 1;
      i++;
      continue;
    }
    i++;
  }
  flush(body.length);
  return fields;
}

/** Body of the first `z.object({ ... })` in `src`, or null if there is none. */
function firstZodObjectBody(src: string): string | null {
  const marker = src.indexOf('z.object({');
  if (marker === -1) return null;
  const open = src.indexOf('{', marker);
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(src, i);
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
    i++;
  }
  return null;
}

interface ParsedHandler {
  file: string;
  /** property name -> required (i.e. neither `.optional()` nor `.default()`). */
  props: Map<string, boolean>;
}

function parseHandlers(): {
  schemas: Map<string, ParsedHandler>;
  registrations: Map<string, string[]>;
} {
  const schemas = new Map<string, ParsedHandler>();
  const registrations = new Map<string, string[]>();

  for (const file of readdirSync(HANDLER_DIR).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(path.join(HANDLER_DIR, file), 'utf8');
    const re = /^ {2}([a-z_0-9]+): async \(/gm;
    const marks: { name: string; at: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) marks.push({ name: m[1], at: m.index });

    for (let k = 0; k < marks.length; k++) {
      const { name, at } = marks[k];
      registrations.set(name, [...(registrations.get(name) ?? []), file]);

      const end = k + 1 < marks.length ? marks[k + 1].at : src.length;
      const body = firstZodObjectBody(src.slice(at, end));
      if (body === null) continue;
      const props = new Map<string, boolean>();
      for (const field of topLevelFields(body)) {
        const outer = outerChainOnly(field.expr);
        props.set(field.name, !/\.optional\(\)|\.default\(/.test(outer));
      }
      if (props.size === 0) continue;
      schemas.set(name, { file, props });
    }
  }
  return { schemas, registrations };
}

const { schemas, registrations } = parseHandlers();

interface ManifestCommand {
  name: string;
  category: string;
  parameters?: {
    properties?: Record<string, unknown>;
    required?: string[];
  };
}
const commands = (manifest as { commands: ManifestCommand[] }).commands;

// ---------------------------------------------------------------------------
// Parser self-tests -- a silently-broken parser is what makes this class of
// test report green on a broken tree, so assert it against a known corpus
// before trusting any verdict derived from it.
// ---------------------------------------------------------------------------

describe('the schema parser itself', () => {
  it('reads top-level keys and skips nested ones', () => {
    const fields = topLevelFields(
      "a: z.string(), b: z.object({ nested: z.number() }), c: z.tuple([x, y])",
    );
    expect(fields.map((f) => f.name)).toEqual(['a', 'b', 'c']);
  });

  it('classifies required vs optional by the OUTER chain only', () => {
    const cases: [string, boolean][] = [
      ['z.string()', true],
      ['z.string().optional()', false],
      ['z.string().default("x")', false],
      // The nested `.optional()` belongs to `inner`, not to this field.
      ['z.object({ inner: z.string().optional() })', true],
      ['z.object({ inner: z.string() }).optional()', false],
    ];
    for (const [expr, required] of cases) {
      const outer = outerChainOnly(expr);
      expect(!/\.optional\(\)|\.default\(/.test(outer)).toBe(required);
    }
  });

  it('ignores a brace inside a string literal when finding the object body', () => {
    const body = firstZodObjectBody('parseArgs(z.object({ a: z.literal("}") }), args)');
    expect(body).not.toBeNull();
    expect(topLevelFields(body as string).map((f) => f.name)).toEqual(['a']);
  });

  it('ignores keys that appear inside comments', () => {
    const fields = topLevelFields('a: z.string(), /* b: z.string(), */ c: z.string()');
    expect(fields.map((f) => f.name)).toEqual(['a', 'c']);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed floors
// ---------------------------------------------------------------------------

describe('parse coverage', () => {
  it('extracts a schema from a large majority of handlers', () => {
    // Guards against a parser change that silently matches nothing: an empty
    // result would otherwise make every parity assertion below vacuous.
    expect(schemas.size).toBeGreaterThan(200);
  });

  it('finds every handler registration', () => {
    expect(registrations.size).toBeGreaterThan(300);
  });

  it.each(PINNED_CATEGORIES)('has at least one command in category %s', (category) => {
    const inCategory = commands.filter((c) => c.category === category);
    expect(inCategory.length).toBeGreaterThan(0);
    // Every pinned command must resolve to a handler, or the pin below skips it.
    for (const cmd of inCategory) {
      expect(schemas.has(cmd.name), `no handler schema found for ${cmd.name}`).toBe(true);
    }
  });

  it('pins the tilemap command count', () => {
    // A new tilemap tool must be added to the manifest AND get a schema, rather
    // than shrinking the pinned set without anything reporting it.
    expect(commands.filter((c) => c.category === 'tilemap')).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// The pin
// ---------------------------------------------------------------------------

describe('manifest parameters match the handler Zod schema', () => {
  const pinned = commands.filter((c) =>
    (PINNED_CATEGORIES as readonly string[]).includes(c.category) && schemas.has(c.name),
  );

  it.each(pinned.map((c) => [c.name, c] as const))(
    '%s declares exactly the properties its handler validates',
    (_name, cmd) => {
      const schema = schemas.get(cmd.name) as ParsedHandler;
      const declared = Object.keys(cmd.parameters?.properties ?? {}).sort();
      const validated = [...schema.props.keys()].sort();
      expect(declared).toEqual(validated);
    },
  );

  it.each(pinned.map((c) => [c.name, c] as const))(
    '%s marks exactly the non-optional schema fields as required',
    (_name, cmd) => {
      const schema = schemas.get(cmd.name) as ParsedHandler;
      const declared = [...(cmd.parameters?.required ?? [])].sort();
      const validated = [...schema.props.entries()]
        .filter(([, required]) => required)
        .map(([propName]) => propName)
        .sort();
      expect(declared).toEqual(validated);
    },
  );
});

// ---------------------------------------------------------------------------
// Duplicate registrations
// ---------------------------------------------------------------------------

describe('handler registration uniqueness', () => {
  const duplicates = [...registrations.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([name]) => name)
    .sort();

  it('registers no command in two modules beyond the known backlog', () => {
    const unexpected = duplicates.filter(
      (name) => !(KNOWN_DUPLICATE_REGISTRATIONS as readonly string[]).includes(name),
    );
    expect(unexpected).toEqual([]);
  });

  it('keeps the known-duplicate list free of stale entries', () => {
    // Reverse direction: an entry that stops being a duplicate must be pruned,
    // so the list cannot rot into permission for something already fixed.
    const stale = KNOWN_DUPLICATE_REGISTRATIONS.filter((name) => !duplicates.includes(name));
    expect(stale).toEqual([]);
  });

  it('registers get_tilemap exactly once', () => {
    // Named explicitly: this one was deduplicated, and the surviving handler is
    // the prototype-safe `ownEntry` implementation in handlers2d.ts.
    expect(registrations.get('get_tilemap')).toEqual(['handlers2d.ts']);
  });
});
