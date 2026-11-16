/**
 * Structural pin for the cross-user job-id binding (#10262).
 *
 * Every `/api/generate/<type>/status` route that resolves a provider key
 * (`resolveApiKey`, which returns the PLATFORM key for a zero-cost status
 * check) must call `verifyProviderJobOwner` BEFORE it, and the POST route
 * that issues the job id must declare `asyncJob` (or `jobIdForOwnership`
 * when there is no `generation_type` enum member — pixel-art) so the id is
 * bound to the caller before the response leaves. Each half is mocked in the
 * other's tests (`bindProviderJob` in the handler suites,
 * `verifyProviderJobOwner` in every `status/route.test.ts`), so a new route
 * that omits either half passes every behavioural test: no binding means the
 * owner's own poll is refused; no check means nobody's is. This file is the
 * only thing that sees the omission.
 *
 * EXECUTABLE occurrence, not containment (lessons-learned #16): comments and
 * string literals are stripped before the indices are compared, so a
 * commented-out `verifyProviderJobOwner(` or a prose mention of it cannot
 * satisfy the pin. And the enumeration is asserted non-empty and to include
 * the seven routes that exist today (#9/#11): a glob that matched nothing
 * would otherwise pass vacuously.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GENERATE_DIR = fileURLToPath(new URL('..', import.meta.url));

/** The seven status routes that resolve a key today. A new one must be added here. */
const KNOWN_KEY_RESOLVING_STATUS_ROUTES = [
  'model',
  'pixel-art',
  'skybox',
  'sprite',
  'sprite-sheet',
  'texture',
  'tileset-gen',
].sort();

/**
 * Drop `//` and `/* *\/` comments and blank out the contents of string
 * literals, leaving indices of the remaining code intact enough to compare.
 * A small scanner rather than a regex: a regex cannot tell a `//` inside a
 * string from a comment.
 */
function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      out += quote + quote;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

interface StatusRoute {
  name: string;
  /** Comment- and string-stripped source of `<name>/status/route.ts`. */
  status: string;
  /** Comment- and string-stripped source of `<name>/route.ts`. */
  post: string;
}

function keyResolvingStatusRoutes(): StatusRoute[] {
  const routes: StatusRoute[] = [];
  for (const entry of readdirSync(GENERATE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const statusPath = join(GENERATE_DIR, entry.name, 'status', 'route.ts');
    const postPath = join(GENERATE_DIR, entry.name, 'route.ts');
    if (!existsSync(statusPath) || !existsSync(postPath)) continue;
    const status = stripCommentsAndStrings(readFileSync(statusPath, 'utf8'));
    // `resolveApiKey(` — the call, not the import specifier.
    if (!status.includes('resolveApiKey(')) continue;
    routes.push({
      name: entry.name,
      status,
      post: stripCommentsAndStrings(readFileSync(postPath, 'utf8')),
    });
  }
  return routes;
}

describe('status-route job ownership — structural pin (#10262)', () => {
  const routes = keyResolvingStatusRoutes();

  it('enumerates every status route that resolves a provider key (non-vacuous)', () => {
    const names = routes.map((r) => r.name).sort();
    expect(names.length).toBeGreaterThanOrEqual(KNOWN_KEY_RESOLVING_STATUS_ROUTES.length);
    expect(names).toEqual(expect.arrayContaining(KNOWN_KEY_RESOLVING_STATUS_ROUTES));
    // A key-resolving status route this pin does not know about is a route
    // nobody has reviewed for the invariant: name it above, deliberately.
    expect(names).toEqual(KNOWN_KEY_RESOLVING_STATUS_ROUTES);
  });

  it('calls verifyProviderJobOwner( — executably — BEFORE resolveApiKey( in every key-resolving status route', () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const { name, status } of routes) {
      const verify = status.indexOf('verifyProviderJobOwner(');
      const resolve = status.indexOf('resolveApiKey(');
      expect(verify, `${name}/status/route.ts: no executable verifyProviderJobOwner( call`).toBeGreaterThanOrEqual(0);
      expect(resolve, `${name}/status/route.ts: no executable resolveApiKey( call`).toBeGreaterThanOrEqual(0);
      expect(verify, `${name}/status/route.ts: ownership must be checked BEFORE the key resolves`).toBeLessThan(resolve);
    }
  });

  it('renders a lookup failure as the retryable 503 and a miss as the shared 404 sentence, in every key-resolving status route', () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const { name, status } of routes) {
      // "Cannot verify" must not become the terminal 404 (round 4): the route
      // must handle JobOwnershipUnavailableError with the degraded contract.
      expect(status, `${name}/status/route.ts: no JobOwnershipUnavailableError handling`).toContain('instanceof JobOwnershipUnavailableError');
      expect(status, `${name}/status/route.ts: lookup failure must answer serviceDegraded(`).toContain('serviceDegraded(');
      // And the miss must use the one shared, user-facing sentence.
      expect(status, `${name}/status/route.ts: 404 must carry JOB_NOT_FOUND_MESSAGE`).toContain('JOB_NOT_FOUND_MESSAGE');
    }
  });

  it('declares asyncJob or jobIdForOwnership on every POST route whose status sibling resolves a key', () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const { name, post } of routes) {
      expect(post, `${name}/route.ts: must use createGenerationHandler`).toContain('createGenerationHandler');
      const binds = /\basyncJob\s*:/.test(post) || /\bjobIdForOwnership\s*:/.test(post);
      expect(
        binds,
        `${name}/route.ts: declare asyncJob (or jobIdForOwnership when there is no generation_type member) so the job id is bound to the caller`,
      ).toBe(true);
    }
  });

  it('the scanner really strips comments (so a commented-out call cannot satisfy the pin)', () => {
    const src = [
      "import { verifyProviderJobOwner } from '@/lib/generate/jobOwnership';",
      '// verifyProviderJobOwner(userId, provider, jobId)',
      '/* verifyProviderJobOwner(userId, provider, jobId) */',
      "const s = 'verifyProviderJobOwner(';",
      'const key = await resolveApiKey(userId);',
    ].join('\n');
    const stripped = stripCommentsAndStrings(src);
    expect(stripped).not.toContain('verifyProviderJobOwner(');
    expect(stripped).toContain('resolveApiKey(');
  });
});
