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
const PINNED_CATEGORIES = [
  'tilemap',
  'sprite',
  'sprite_animation',
  'physics2d',
  'scripting',
] as const;

/** Exact command count per pinned category, so shrinking one silently fails loudly. */
const PINNED_CATEGORY_COUNTS: Record<(typeof PINNED_CATEGORIES)[number], number> = {
  tilemap: 10,
  sprite: 8,
  sprite_animation: 6,
  physics2d: 8,
  scripting: 15,
};

/**
 * No command may be registered by more than one handler module. Registry
 * spread order must never decide which implementation production executes.
 */
const KNOWN_DUPLICATE_REGISTRATIONS = [
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

/**
 * Body of the schema's `z.object({ ... })` in `src`, plus the index right
 * after its closing brace (so a caller can inspect what follows, e.g. a
 * `.merge(...)` chain). Anchors the search on `parseArgs(` when present, so a
 * handler that declares a local `z.object({...})` helper BEFORE its actual
 * `parseArgs(z.object({...}), args)` call doesn't have that helper mistaken
 * for the schema. Falls back to searching from the start of `src` when no
 * `parseArgs(` marker exists (e.g. a schema built and merged separately).
 */
function objectBodyFrom(src: string, marker: number): { body: string; end: number } | null {
  const open = src.indexOf('{', marker);
  if (open === -1) return null;
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
      if (depth === 0) {
        // `end` points past the `z.object(...)` CALL, not just its object
        // literal -- skip the call's own closing `)` (and any whitespace
        // before it) so a caller can detect a `.merge(...)` chained onto it.
        let end = i + 1;
        while (end < src.length && /\s/.test(src[end])) end++;
        if (src[end] === ')') end++;
        return { body: src.slice(open + 1, i), end };
      }
    }
    i++;
  }
  return null;
}

function firstZodObjectBodyWithEnd(src: string): { body: string; end: number } | null {
  const anchor = src.indexOf('parseArgs(');
  const searchFrom = anchor === -1 ? 0 : anchor;
  const marker = src.indexOf('z.object({', searchFrom);
  if (marker === -1) return null;
  return objectBodyFrom(src, marker);
}

/** Body of the first `z.object({ ... })` in `src`, or null if there is none. */
function firstZodObjectBody(src: string): string | null {
  return firstZodObjectBodyWithEnd(src)?.body ?? null;
}

/**
 * Top-level fields of a module-level `const <varName> = z.object({ ... })`
 * declaration, searched across the FULL file source (not a handler's slice).
 * Used to resolve `.merge(<varName>)` chains -- see `parseHandlers()`.
 *
 * Locates the object body directly from the declaration's own `z.object({`
 * marker via `objectBodyFrom` -- NOT via `firstZodObjectBodyWithEnd`, which
 * anchors on the first `parseArgs(` in its input. Slicing from the
 * declaration to end-of-file (to search forward) would otherwise hand that
 * anchor the next unrelated handler's `parseArgs(` call, silently returning
 * a stranger handler's fields instead of this declaration's own.
 */
function moduleObjectFields(src: string, varName: string): { name: string; expr: string }[] {
  const declMarker = new RegExp(`\\b${varName}\\s*=\\s*z\\.object\\(\\{`);
  const declMatch = declMarker.exec(src);
  if (declMatch === null) return [];
  const objectStart = declMatch.index + declMatch[0].indexOf('z.object({');
  const parsed = objectBodyFrom(src, objectStart);
  if (parsed === null) return [];
  return topLevelFields(parsed.body);
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
      const slice = src.slice(at, end);
      const parsed = firstZodObjectBodyWithEnd(slice);
      if (parsed === null) continue;
      const fields = topLevelFields(parsed.body);

      // Resolve a single `.merge(identifier)` chain onto the base object, e.g.
      // `z.object({ entityId: zEntityId }).merge(zPhysics2dData)`. Only a bare
      // identifier is supported -- the one real usage in this directory.
      const mergeMatch = /^\s*\.merge\(([A-Za-z_$][\w$]*)\)/.exec(slice.slice(parsed.end));
      if (mergeMatch) {
        fields.push(...moduleObjectFields(src, mergeMatch[1]));
      }

      const props = new Map<string, boolean>();
      for (const field of fields) {
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

  it('anchors the object search on parseArgs(, skipping an earlier unrelated z.object(', () => {
    const src = [
      'const helper = z.object({ notTheSchema: z.string() });',
      'const p = parseArgs(z.object({ real: z.number() }), args);',
    ].join('\n');
    const body = firstZodObjectBody(src);
    expect(body).not.toBeNull();
    expect(topLevelFields(body as string).map((f) => f.name)).toEqual(['real']);
  });

  it('resolves a .merge(identifier) chain onto the base object fields', () => {
    const src = [
      'const zExtra = z.object({ b: z.string(), c: z.number().optional() });',
      'const p = parseArgs(z.object({ a: z.string() }).merge(zExtra), args);',
    ].join('\n');
    const parsed = firstZodObjectBodyWithEnd(src);
    expect(parsed).not.toBeNull();
    const { body, end } = parsed as { body: string; end: number };
    const fields = topLevelFields(body);
    const mergeMatch = /^\s*\.merge\(([A-Za-z_$][\w$]*)\)/.exec(src.slice(end));
    expect(mergeMatch?.[1]).toBe('zExtra');
    fields.push(...moduleObjectFields(src, mergeMatch![1]));
    expect(fields.map((f) => f.name)).toEqual(['a', 'b', 'c']);
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

  it.each(PINNED_CATEGORIES)('pins the %s command count', (category) => {
    // A new tool in a pinned category must be added to the manifest AND get a
    // schema, rather than shrinking the pinned set without anything reporting it.
    expect(commands.filter((c) => c.category === category)).toHaveLength(
      PINNED_CATEGORY_COUNTS[category],
    );
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
