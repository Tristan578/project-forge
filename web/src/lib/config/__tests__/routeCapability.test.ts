/**
 * ROUTE_CAPABILITY covers every generate route (#9117).
 *
 * The handler's refuse-before-charge gate reads this table when a route omits
 * `capability`, so the only way a route can be ungated is to be missing here.
 * This test walks the real route files and fails in both directions: a route
 * with no table entry, and a table entry with no route.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROUTE_CAPABILITY, PROVIDER_CAPABILITIES } from '../providers';

const GENERATE_DIR = path.resolve(__dirname, '../../../app/api/generate');

function declaredRoutes(): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(GENERATE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(GENERATE_DIR, entry.name, 'route.ts');
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    const match = src.match(/^\s*route:\s*'([^']+)'/m);
    if (match) routes.push(match[1]);
  }
  return routes;
}

describe('ROUTE_CAPABILITY', () => {
  it('names a real capability for every generate route on disk', () => {
    const routes = declaredRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(12);
    const missing = routes.filter((r) => ROUTE_CAPABILITY[r] === undefined);
    expect(missing).toEqual([]);
    for (const cap of Object.values(ROUTE_CAPABILITY)) {
      expect(PROVIDER_CAPABILITIES).toContain(cap);
    }
  });

  it('has no entry for a route that does not exist', () => {
    const routes = new Set(declaredRoutes());
    const stale = Object.keys(ROUTE_CAPABILITY).filter((r) => !routes.has(r));
    expect(stale).toEqual([]);
  });
});
