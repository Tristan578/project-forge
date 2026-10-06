// @vitest-environment node
/**
 * The E2E-only Neon HTTP endpoint override (#10161).
 *
 * The CI engine-journeys job serves the app against a Postgres created for
 * that run, reached through a local Neon-protocol proxy. The driver finds that
 * proxy through `E2E_NEON_HTTP_ENDPOINT`, and the ONLY thing that may honour
 * that variable is a build whose `e2eHooksEnabled()` is true. A production
 * build with the hooks flag unset must ignore it no matter what the runtime
 * environment says — that is the acceptance criterion this file exists for.
 *
 * Two kinds of evidence, because no runtime test can see a build-time inline:
 *   - behaviour, through the real `neonConfig` of the installed driver;
 *   - source shape, so the gate keeps reading the flag the way Next.js inlines
 *     it, and every `neon(` construction site in the app keeps going through
 *     the override (lessons-learned #16: executable occurrences, never
 *     containment).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { neonConfig } from '@neondatabase/serverless';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  E2E_NEON_HTTP_ENDPOINT_ENV,
  applyE2eNeonEndpointOverride,
  resolveE2eNeonEndpoint,
} from '../e2eNeonEndpoint';

const ROOT = process.cwd();
const MODULE_FILE = join(ROOT, 'src/lib/db/e2eNeonEndpoint.ts');
const HOOKS_FILE = join(ROOT, 'src/lib/e2e/testHooks.ts');
const PROXY = 'http://localhost:4444/sql';

/**
 * Strip comments so a pin only sees EXECUTABLE code (lessons-learned #16).
 * Crude but sufficient for these files: no string literal in them contains
 * `//` or `/*`.
 */
function executableCode(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
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

describe('resolveE2eNeonEndpoint (pure)', () => {
  it('is null while the hooks gate is closed, whatever the variable says', () => {
    expect(resolveE2eNeonEndpoint(PROXY, false)).toBeNull();
  });

  it('is null when the variable is unset or empty, even with the gate open', () => {
    expect(resolveE2eNeonEndpoint(undefined, true)).toBeNull();
    expect(resolveE2eNeonEndpoint('', true)).toBeNull();
  });

  it('returns the endpoint for a loopback /sql URL with the gate open', () => {
    expect(resolveE2eNeonEndpoint(PROXY, true)).toBe(PROXY);
    expect(resolveE2eNeonEndpoint('http://127.0.0.1:4444/sql', true)).toBe(
      'http://127.0.0.1:4444/sql',
    );
    expect(resolveE2eNeonEndpoint('http://[::1]:4444/sql', true)).toBe('http://[::1]:4444/sql');
  });

  it('refuses a non-loopback host loudly, naming the variable', () => {
    expect(() => resolveE2eNeonEndpoint('http://ep-x.neon.tech/sql', true)).toThrow(
      new RegExp(`${E2E_NEON_HTTP_ENDPOINT_ENV}.*loopback`),
    );
    expect(() => resolveE2eNeonEndpoint('http://db.localtest.me:4444/sql', true)).toThrow(
      /loopback/,
    );
  });

  it('refuses a non-http(s) scheme, a non-/sql path and a value that is not a URL', () => {
    expect(() => resolveE2eNeonEndpoint('postgres://localhost:5432/db', true)).toThrow(
      /http/,
    );
    expect(() => resolveE2eNeonEndpoint('http://localhost:4444', true)).toThrow(/\/sql/);
    expect(() => resolveE2eNeonEndpoint('http://localhost:4444/', true)).toThrow(/\/sql/);
    expect(() => resolveE2eNeonEndpoint('not a url', true)).toThrow(/URL/);
  });
});

describe('applyE2eNeonEndpointOverride (through the real driver config)', () => {
  const defaultEndpoint = neonConfig.fetchEndpoint;

  beforeEach(() => {
    // The driver resolves `fetchEndpoint` at query time from this global, so
    // restoring it is what keeps one case from leaking into the next.
    neonConfig.fetchEndpoint = defaultEndpoint;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    neonConfig.fetchEndpoint = defaultEndpoint;
  });

  it('a production build with the hooks flag unset IGNORES the variable set at runtime', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_E2E_HOOKS', '');
    vi.stubEnv(E2E_NEON_HTTP_ENDPOINT_ENV, PROXY);

    expect(applyE2eNeonEndpointOverride()).toBeNull();
    expect(neonConfig.fetchEndpoint).toBe(defaultEndpoint);
  });

  it('a production build with the hooks flag set at build time honours it', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_E2E_HOOKS', 'true');
    vi.stubEnv(E2E_NEON_HTTP_ENDPOINT_ENV, PROXY);

    expect(applyE2eNeonEndpointOverride()).toBe(PROXY);
    expect(neonConfig.fetchEndpoint).toBe(PROXY);
  });

  it('a non-production process (tsx scripts, next dev) honours it without the flag', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_E2E_HOOKS', '');
    vi.stubEnv(E2E_NEON_HTTP_ENDPOINT_ENV, PROXY);

    expect(applyE2eNeonEndpointOverride()).toBe(PROXY);
    expect(neonConfig.fetchEndpoint).toBe(PROXY);
  });

  it('leaves the driver on its default endpoint when the variable is unset', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(E2E_NEON_HTTP_ENDPOINT_ENV, '');

    expect(applyE2eNeonEndpointOverride()).toBeNull();
    expect(neonConfig.fetchEndpoint).toBe(defaultEndpoint);
  });

  it('a non-loopback value with the gate open throws rather than falling back to Neon', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(E2E_NEON_HTTP_ENDPOINT_ENV, 'https://ep-x.neon.tech/sql');

    expect(() => applyE2eNeonEndpointOverride()).toThrow(/loopback/);
    expect(neonConfig.fetchEndpoint).toBe(defaultEndpoint);
  });

  it('the driver default is a function the override replaces with a string (the contract this file pins)', () => {
    // Pinned so a driver bump that changes the shape of `fetchEndpoint` is
    // noticed here rather than in a CI job that quietly posts to the wrong
    // place. @neondatabase/serverless 1.x: a string is used verbatim and a
    // function is called as (host, port, { jwtAuth }) at query time.
    expect(typeof defaultEndpoint).toBe('function');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(E2E_NEON_HTTP_ENDPOINT_ENV, PROXY);
    applyE2eNeonEndpointOverride();
    expect(typeof neonConfig.fetchEndpoint).toBe('string');
  });
});

describe('source shape (Next.js inlines only literal process.env reads; every neon() site is gated)', () => {
  const moduleCode = executableCode(readFileSync(MODULE_FILE, 'utf8'));
  const hooksCode = executableCode(readFileSync(HOOKS_FILE, 'utf8'));

  it('the override reads E2E_NEON_HTTP_ENDPOINT as exactly one literal member expression', () => {
    const literal = moduleCode.match(/\bprocess\.env\.E2E_NEON_HTTP_ENDPOINT\b/g) ?? [];
    expect(literal).toHaveLength(1);
    // Every executable `process.env` in the module must be that literal: an
    // aliased or injected env object is exactly the shape a build-time
    // substitution cannot see (CLAUDE.md, NEXT_PUBLIC_MCP_BRIDGE).
    const all = moduleCode.match(/\bprocess\.env\b/g) ?? [];
    expect(all).toHaveLength(literal.length);
  });

  it('the override is gated through e2eHooksEnabled(), executably, exactly once', () => {
    const calls = moduleCode.match(/\be2eHooksEnabled\(\)/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it('the hooks gate still reads NEXT_PUBLIC_E2E_HOOKS as a literal member expression', () => {
    const literal = hooksCode.match(/\bprocess\.env\.NEXT_PUBLIC_E2E_HOOKS\b/g) ?? [];
    expect(literal).toHaveLength(1);
  });

  it('every neon() construction site under src/ and scripts/ applies the override', () => {
    const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))];
    const sites = files.filter((file) => /\bneon\(/.test(executableCode(readFileSync(file, 'utf8'))));
    // Vacuity guard: the walk must find the sites that are known to exist.
    const relSites = sites.map((f) => relative(ROOT, f).replace(/\\/g, '/'));
    expect(relSites).toEqual(
      expect.arrayContaining([
        'src/lib/db/client.ts',
        'src/lib/monitoring/healthChecks.ts',
        'scripts/apply-migrations.ts',
        'scripts/check-schema-drift.ts',
      ]),
    );
    const ungated = sites.filter(
      (file) => !/\bapplyE2eNeonEndpointOverride\(\)/.test(executableCode(readFileSync(file, 'utf8'))),
    );
    expect(
      ungated.map((f) => relative(ROOT, f).replace(/\\/g, '/')),
      'a neon() site that never calls applyE2eNeonEndpointOverride() reaches Neon cloud even in the journeys job',
    ).toEqual([]);
  });
});
