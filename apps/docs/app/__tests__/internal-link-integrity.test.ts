/**
 * @vitest-environment node
 */

/**
 * CI gate for #9046 on the docs app: every internal link must point at a route
 * that exists.
 *
 * The docs app shipped BOTH failure modes this ticket is about. The homepage
 * linked to `/api`, which has never had a route (that link is now plain text —
 * the content file says the reference is "coming soon" and robots.ts already
 * disallows the path). And `/mcp` linked every category tile at
 * `/mcp/${category}` with no `[category]` route behind it, so all 35 tiles
 * 404'd — that one is now a real route rendered from the commands manifest.
 *
 * Deliberately a vitest suite rather than a CI job: it rides the existing
 * `npx vitest run` for this package with no workflow wiring.
 *
 * Scope and limits are documented at the top of `helpers/linkIntegrity.ts`.
 * The checker's own self-tests (planted dead links, template literals it must
 * skip, primitives) live in the web copy of this suite; this file is the
 * tree-scan half.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  checkLinks,
  collectLinks,
  collectRoutes,
  formatDeadLinks,
} from './helpers/linkIntegrity';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(HERE, '..', '..'); // apps/docs
const APP_DIR = path.join(DOCS_ROOT, 'app');

/** Every source directory in this package that can contain a link. */
const SOURCE_DIRS = ['app', 'components', 'lib']
  .map((dir) => path.join(DOCS_ROOT, dir))
  .filter((dir) => existsSync(dir));

describe('internal link integrity (docs)', () => {
  const routes = collectRoutes(APP_DIR);
  const links = SOURCE_DIRS.flatMap((dir) => collectLinks(dir));
  const report = checkLinks(links, routes);

  // Fail closed: a walk that finds nothing is a broken checker, not a pass.
  it('finds the App Router route table', () => {
    expect(routes.length).toBeGreaterThanOrEqual(3);
  });

  it('finds internal links to check', () => {
    expect(links.length).toBeGreaterThanOrEqual(3);
  });

  it('actually resolves links rather than skipping them all', () => {
    expect(report.resolved.length).toBeGreaterThanOrEqual(3);
  });

  it('has no internal link pointing at a route that does not exist', () => {
    expect(
      report.dead,
      `Dead internal links found:\n${formatDeadLinks(report.dead)}\n\n` +
        'Either create the route or repoint the link at one that exists.',
    ).toEqual([]);
  });

  it('resolves every /mcp category tile against the [category] route', () => {
    const tile = report.resolved.find((l) => l.raw === '/mcp/${category}');
    expect(
      tile,
      'the category tiles on /mcp are no longer being checked — ' +
        'if the href changed shape, update this assertion rather than dropping it',
    ).toBeDefined();
    expect(tile?.path).toBe('/mcp/<dynamic>');
  });

  it('does not link to /api, which has no route and is disallowed in robots.ts', () => {
    expect(links.filter((l) => l.raw === '/api' || l.raw.startsWith('/api?'))).toEqual([]);
  });
});
