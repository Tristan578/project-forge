// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SCRIPT_ISOLATION_MODE,
  getScriptIsolationMode,
  parseScriptIsolationMode,
  resolveScriptTransport,
  type ScriptIsolationMode,
} from '../sandboxConfig';
import { AST_INTERPRETER_IMPLEMENTED, createAstScriptHost } from '../astInterpreter';

const FLAG = 'NEXT_PUBLIC_SCRIPT_ISOLATION';
const SRC = join(process.cwd(), 'src');
const CONFIG_FILE = join(SRC, 'lib/scripting/sandboxConfig.ts');

/**
 * Strip comments so a pin only sees EXECUTABLE code (lessons-learned #16: a
 * containment check passes on a commented-out line). Crude but sufficient for
 * these files: no string literal in them contains `//` or `/*`.
 */
function executableCode(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The body of `export function <name>(...) { ... }`, by brace matching. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  expect(start, `function ${name} not found`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unbalanced body for ${name}`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('NEXT_PUBLIC_SCRIPT_ISOLATION flag parse', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Read through getScriptIsolationMode(), i.e. through the real process.env
  // member expression — not through the pure parser alone.
  it.each<[string | undefined, ScriptIsolationMode]>([
    ['sandboxed-origin', 'sandboxed-origin'],
    ['ast', 'ast'],
    ['revoke', 'revoke'],
    [undefined, 'revoke'],
    ['', 'revoke'],
    ['TRUE', 'revoke'],
    ['true', 'revoke'],
    ['1', 'revoke'],
    ['Sandboxed-Origin', 'revoke'],
    [' sandboxed-origin', 'revoke'],
    ['sandboxed-origin ', 'revoke'],
    ['sandboxed_origin', 'revoke'],
    ['AST', 'revoke'],
  ])('%j -> %s', (raw, expected) => {
    vi.stubEnv(FLAG, raw);
    expect(process.env[FLAG]).toBe(raw);
    expect(getScriptIsolationMode()).toBe(expected);
    expect(parseScriptIsolationMode(raw)).toBe(expected);
  });

  it('defaults to revoke, which is today’s behaviour', () => {
    expect(DEFAULT_SCRIPT_ISOLATION_MODE).toBe('revoke');
  });
});

describe('resolveScriptTransport', () => {
  it('maps revoke and sandboxed-origin onto themselves with no notice', () => {
    expect(resolveScriptTransport('revoke')).toEqual({ transport: 'revoke' });
    expect(resolveScriptTransport('sandboxed-origin')).toEqual({ transport: 'sandboxed-origin' });
  });

  it('resolves the unimplemented ast mode UP to sandboxed-origin, visibly — never down to revoke', () => {
    expect(AST_INTERPRETER_IMPLEMENTED).toBe(false);
    const resolved = resolveScriptTransport('ast');
    expect(resolved.transport).toBe('sandboxed-origin');
    expect(resolved.notice).toMatch(/not implemented/);
    expect(resolved.notice).toMatch(/sandboxed-origin/);
  });

  it('the ast host stub refuses rather than running anything', () => {
    expect(() => createAstScriptHost()).toThrow(/not implemented/);
  });
});

describe('flag source shape (Next.js inlines only literal process.env.NEXT_PUBLIC_* reads)', () => {
  /**
   * Next.js substitutes `process.env.NEXT_PUBLIC_SCRIPT_ISOLATION` at build time
   * ONLY as a fully-qualified member expression. An alias
   * (`const env = process.env`), a destructure, a computed key or an injected
   * env object reads the browser shim's `{}` — the flag would be `undefined` in
   * every production build and the opt-in would silently do nothing. vitest has
   * a real process.env, so no runtime test can see this; the source is pinned.
   */
  const code = executableCode(readFileSync(CONFIG_FILE, 'utf8'));

  it('getScriptIsolationMode reads the flag as one literal member expression', () => {
    const body = functionBody(code, 'getScriptIsolationMode');
    const literal = body.match(/\bprocess\.env\.NEXT_PUBLIC_SCRIPT_ISOLATION\b/g) ?? [];
    expect(literal).toHaveLength(1);
  });

  it('never touches process.env in any other shape', () => {
    // Every executable `process.env` in the module must be exactly the literal
    // read above. This catches an alias, a destructure, `process.env[FLAG]`,
    // `process.env?.X`, and a second read of some other variable.
    const all = code.match(/\bprocess\s*(?:\?\.|\.)\s*env\b/g) ?? [];
    const literal = code.match(/\bprocess\.env\.NEXT_PUBLIC_SCRIPT_ISOLATION\b/g) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(all).toHaveLength(literal.length);
    expect(code).not.toMatch(/NodeJS\.ProcessEnv/);
  });

  it('no other module reads the flag — sandboxConfig.ts is the single reader', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(100); // a walk over nothing proves nothing
    // A READ is a member access (`x.FLAG`, `x['FLAG']`), not the name inside
    // a message string — the ast notice and stub error both spell it out.
    const read = new RegExp(`(?:\\.|\\[\\s*['"\`])${FLAG}\\b`);
    const readers = files
      .filter((file) => read.test(executableCode(readFileSync(file, 'utf8'))))
      .map((file) => relative(SRC, file));
    expect(readers).toEqual(['lib/scripting/sandboxConfig.ts']);
  });

  it('the worker never reads process.env — the mode is resolved on the main thread', () => {
    const worker = executableCode(readFileSync(join(SRC, 'lib/scripting/scriptWorker.ts'), 'utf8'));
    expect(worker.length).toBeGreaterThan(10_000);
    expect(worker).not.toMatch(/\bprocess\s*\.\s*env\b/);
  });
});
