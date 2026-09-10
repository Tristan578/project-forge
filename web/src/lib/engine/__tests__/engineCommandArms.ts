/**
 * Shared scanner for the engine's command surface, used by every parity pin
 * that has to answer "can this name actually run?".
 *
 * It started life inside `stores/slices/__tests__/commandArmParity.test.ts` and
 * moved here when PF-1180 (#9284) added a second pin — `SCRIPT_ALLOWED_COMMANDS`
 * — that needs exactly the same answer. Two hand-copied scanners would be two
 * things to keep in step, and the first one to fall behind would go on reporting
 * green: a scanner that under-reports arms fails loudly, but one that
 * over-reports them (a broken stub detector, a `route_domain` anchor that
 * matches nothing) reads as coverage. One copy, checked by both suites.
 *
 * Not a `.test.ts` file, so vitest does not collect it as a suite; it lives
 * under `__tests__/` so the coverage config's `src/**\/__tests__/**` exclusion
 * covers it. Every function here FAILS CLOSED — an unparseable source throws
 * rather than returning an empty set that would read as "nothing to check".
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// __dirname is web/src/lib/engine/__tests__ — five levels below the repo root.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
export const ENGINE_COMMANDS_DIR = join(REPO_ROOT, 'engine', 'src', 'core', 'commands');
export const WEB_SRC_DIR = join(REPO_ROOT, 'web', 'src');

/** Text of a brace-balanced block starting at `openIndex` (which must be a `{`). */
export function blockAt(source: string, openIndex: number): string {
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
export function fnBodies(source: string, namePattern: string): Array<[string, string]> {
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

export interface EngineArms {
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
export function topLevelFnBody(source: string, name: string): string | undefined {
  const at = source.indexOf(`\nfn ${name}(`);
  if (at === -1) return undefined;
  const open = source.indexOf('{', at);
  return open === -1 ? undefined : blockAt(source, open);
}

/** Every command name listed in `fn route_domain`, whatever domain it maps to. */
export function readRoutedNames(): Set<string> {
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

/**
 * The engine's command surface, split into what can run and what cannot.
 *
 * An arm that exists but only returns `Not yet implemented` counts as ABSENT,
 * and that distinction is load-bearing: `engine/src/core/commands/animation.rs`
 * holds nine inline stub arms, so a name-only scan reports the entire
 * animation-clip surface as routed when none of it does anything.
 *
 * A working arm is ALSO not enough. `commands::dispatch` consults `route_domain`
 * first, and an unlisted name returns 255 → `Err("Unknown command: ...")` before
 * any domain module is reached. So an arm the router does not name is dead
 * however correct it is, and `implemented` requires both.
 */
export function readEngineArms(): EngineArms {
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
  // implemented. Tracked separately so callers can prove this subtraction is
  // really happening rather than being vacuous.
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

/** Every production `.ts`/`.tsx` source under `dir`, tests excluded. */
export function productionSources(dir: string): string[] {
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
