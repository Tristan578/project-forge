/**
 * Unit tests for the bundle-size gate (PF-1132).
 *
 * The gate reads real Next build output, so these tests build synthetic
 * `.next` trees in a tmpdir: a `build-manifest.json`, chunk files with known
 * byte sizes, and per-route `page_client-reference-manifest.js` files in the
 * shape Next actually emits (`self.__RSC_MANIFEST[routeKey] = {...}`).
 *
 * Exit-code contract under test (house convention):
 *   0 = within limits, 1 = a real finding, 2 = fail-closed tooling error.
 * The fail-closed cases matter most: a gate that cannot measure must never
 * report a pass.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  BUNDLE_ROUTE_FIRST_LOAD_WARN,
  BUNDLE_ROUTE_FIRST_LOAD_FAIL,
  BUNDLE_TOTAL_WARN,
  BUNDLE_TOTAL_FAIL,
} from '../../src/lib/config/performanceTargets';

const require_ = createRequire(import.meta.url);
const gate = require_('../check-bundle-size.js') as {
  BUNDLE_ROUTE_FIRST_LOAD_WARN: number;
  BUNDLE_ROUTE_FIRST_LOAD_FAIL: number;
  BUNDLE_TOTAL_WARN: number;
  BUNDLE_TOTAL_FAIL: number;
  formatBytes: (n: number) => string;
  findRouteManifests: (dir: string) => string[];
  computeRouteFirstLoad: (buildDir: string) => Array<{
    route: string;
    bytes: number;
    chunkCount: number;
  }>;
  analyzeBundle: (buildDir: string) => unknown;
  main: (buildDir: string, log: Logger) => number;
};

interface Logger {
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
}

function makeLog() {
  const lines: string[] = [];
  const log: Logger = {
    info: (m) => lines.push(m),
    warn: (m) => lines.push(m),
    error: (m) => lines.push(m),
  };
  return { log, text: () => lines.join('\n') };
}

// ---------------------------------------------------------------------------
// Synthetic build-output fixtures
// ---------------------------------------------------------------------------

let buildDir: string;

/** Write a chunk of exactly `bytes` bytes at `static/chunks/<name>`. */
function writeChunk(name: string, bytes: number): string {
  const rel = path.join('static', 'chunks', name);
  const full = path.join(buildDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'x'.repeat(bytes));
  return rel.split(path.sep).join('/');
}

function writeBuildManifest(manifest: unknown): void {
  fs.writeFileSync(path.join(buildDir, 'build-manifest.json'), JSON.stringify(manifest));
}

/**
 * Write a route manifest in Next's emitted shape. `extraKeys` adds additional
 * `__RSC_MANIFEST` keys so the multi-route failure mode can be exercised.
 */
function writeRouteManifest(
  routeDir: string,
  routeKey: string,
  entryJSFiles: Record<string, string[]>,
  extraKeys: Record<string, unknown> = {}
): void {
  const dir = path.join(buildDir, 'server', 'app', routeDir);
  fs.mkdirSync(dir, { recursive: true });
  const assignments = Object.entries({ [routeKey]: { entryJSFiles }, ...extraKeys })
    .map(([k, v]) => `self.__RSC_MANIFEST[${JSON.stringify(k)}] = ${JSON.stringify(v)};`)
    .join('\n');
  fs.writeFileSync(
    path.join(dir, 'page_client-reference-manifest.js'),
    `self.__RSC_MANIFEST = self.__RSC_MANIFEST || {};\n${assignments}\n`
  );
}

beforeEach(() => {
  buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-gate-'));
});

afterEach(() => {
  fs.rmSync(buildDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Threshold mirror
// ---------------------------------------------------------------------------

describe('threshold mirror against performanceTargets.ts', () => {
  it('every BUNDLE_* constant in the script equals the canonical value', () => {
    // The script is CJS and cannot import the TS module, so it duplicates the
    // numbers. This test is what makes the duplication safe.
    expect(gate.BUNDLE_ROUTE_FIRST_LOAD_WARN).toBe(BUNDLE_ROUTE_FIRST_LOAD_WARN);
    expect(gate.BUNDLE_ROUTE_FIRST_LOAD_FAIL).toBe(BUNDLE_ROUTE_FIRST_LOAD_FAIL);
    expect(gate.BUNDLE_TOTAL_WARN).toBe(BUNDLE_TOTAL_WARN);
    expect(gate.BUNDLE_TOTAL_FAIL).toBe(BUNDLE_TOTAL_FAIL);
  });
});

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

describe('computeRouteFirstLoad', () => {
  it('sums root chunks plus the route entry chunks', () => {
    const root = writeChunk('root.js', 1000);
    const poly = writeChunk('poly.js', 500);
    const page = writeChunk('page.js', 2000);
    writeBuildManifest({ rootMainFiles: [root], polyfillFiles: [poly] });
    writeRouteManifest('foo', '/foo/page', { 'app/foo/page': [page] });

    const routes = gate.computeRouteFirstLoad(buildDir);
    expect(routes).toEqual([{ route: '/foo/page', bytes: 3500, chunkCount: 3 }]);
  });

  it('de-duplicates a chunk reachable from several entries', () => {
    // The whole point of the rewrite: Turbopack emits a shared graph per entry,
    // and the old gate double-counted it.
    const root = writeChunk('root.js', 1000);
    const shared = writeChunk('shared.js', 4000);
    const page = writeChunk('page.js', 100);
    writeBuildManifest({ rootMainFiles: [root] });
    writeRouteManifest('foo', '/foo/page', {
      'app/layout': [shared],
      'app/error': [shared],
      'app/foo/page': [shared, page],
    });

    expect(gate.computeRouteFirstLoad(buildDir)[0]).toEqual({
      route: '/foo/page',
      bytes: 5100,
      chunkCount: 3,
    });
  });

  it('excludes --metadata entries', () => {
    const root = writeChunk('root.js', 1000);
    const page = writeChunk('page.js', 100);
    const meta = writeChunk('meta.js', 900_000);
    writeBuildManifest({ rootMainFiles: [root] });
    writeRouteManifest('foo', '/foo/page', {
      'app/foo/page': [page],
      'app/foo/icon--metadata': [meta],
    });

    expect(gate.computeRouteFirstLoad(buildDir)[0].bytes).toBe(1100);
  });

  it('ranks routes heaviest first', () => {
    const root = writeChunk('root.js', 100);
    const small = writeChunk('small.js', 200);
    const big = writeChunk('big.js', 9000);
    const mid = writeChunk('mid.js', 3000);
    writeBuildManifest({ rootMainFiles: [root] });
    writeRouteManifest('a', '/a/page', { 'app/a/page': [small] });
    writeRouteManifest('b', '/b/page', { 'app/b/page': [big] });
    writeRouteManifest('c', '/c/page', { 'app/c/page': [mid] });

    expect(gate.computeRouteFirstLoad(buildDir).map((r) => r.route)).toEqual([
      '/b/page',
      '/c/page',
      '/a/page',
    ]);
  });

  it('finds route manifests at any nesting depth', () => {
    const root = writeChunk('root.js', 10);
    const page = writeChunk('page.js', 10);
    writeBuildManifest({ rootMainFiles: [root] });
    writeRouteManifest(path.join('play', '[userId]', '[slug]'), '/play/[userId]/[slug]/page', {
      'app/play/[userId]/[slug]/page': [page],
    });

    expect(gate.computeRouteFirstLoad(buildDir).map((r) => r.route)).toEqual([
      '/play/[userId]/[slug]/page',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed tooling errors (exit 2)
// ---------------------------------------------------------------------------

describe('fail-closed tooling errors', () => {
  it('exits 2 when the build directory is absent', () => {
    const { log, text } = makeLog();
    expect(gate.main(path.join(buildDir, 'nope'), log)).toBe(2);
    expect(text()).toContain('not found');
  });

  it('exits 2 when build-manifest.json is absent', () => {
    writeChunk('root.js', 10);
    const { log, text } = makeLog();
    expect(gate.main(buildDir, log)).toBe(2);
    expect(text()).toContain('build-manifest.json not found');
  });

  it('exits 2 when build-manifest.json is not valid JSON', () => {
    fs.writeFileSync(path.join(buildDir, 'build-manifest.json'), '{ "rootMainFiles": [,] }');
    const { log, text } = makeLog();
    expect(gate.main(buildDir, log)).toBe(2);
    expect(text()).toContain('not valid JSON');
  });

  it('exits 2 when no route manifests are found', () => {
    // A mis-pointed or half-written build measures nothing — never a pass.
    writeBuildManifest({ rootMainFiles: [writeChunk('root.js', 10)] });
    const { log, text } = makeLog();
    expect(gate.main(buildDir, log)).toBe(2);
    expect(text()).toContain('No route client-reference manifests found');
  });

  it('exits 2 when a manifest references a chunk that is not on disk', () => {
    writeBuildManifest({ rootMainFiles: [writeChunk('root.js', 10)] });
    writeRouteManifest('foo', '/foo/page', {
      'app/foo/page': ['static/chunks/vanished.js'],
    });
    const { log, text } = makeLog();
    expect(gate.main(buildDir, log)).toBe(2);
    expect(text()).toContain('does not exist on disk');
    expect(text()).toContain('vanished.js');
  });

  it('exits 2 when a route manifest carries more than one route key', () => {
    // Format drift: grading the first key would silently measure the wrong route.
    writeBuildManifest({ rootMainFiles: [writeChunk('root.js', 10)] });
    writeRouteManifest(
      'foo',
      '/foo/page',
      { 'app/foo/page': [writeChunk('page.js', 10)] },
      { '/bar/page': { entryJSFiles: {} } }
    );
    const { log, text } = makeLog();
    expect(gate.main(buildDir, log)).toBe(2);
    expect(text()).toContain('Expected exactly 1 route key');
  });

  it('exits 2 when a route manifest assigns no route key at all', () => {
    writeBuildManifest({ rootMainFiles: [writeChunk('root.js', 10)] });
    const dir = path.join(buildDir, 'server', 'app', 'foo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'page_client-reference-manifest.js'), '// nothing\n');
    const { log, text } = makeLog();
    expect(gate.main(buildDir, log)).toBe(2);
    expect(text()).toContain('Expected exactly 1 route key');
  });

  it('exits 2 when a route manifest throws on load', () => {
    writeBuildManifest({ rootMainFiles: [writeChunk('root.js', 10)] });
    const dir = path.join(buildDir, 'server', 'app', 'foo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'page_client-reference-manifest.js'),
      'throw new Error("boom");\n'
    );
    const { log, text } = makeLog();
    expect(gate.main(buildDir, log)).toBe(2);
    expect(text()).toContain('Could not load route manifest');
  });

  it('leaves no __RSC_MANIFEST or self global behind after a successful run', () => {
    writeBuildManifest({ rootMainFiles: [writeChunk('root.js', 10)] });
    writeRouteManifest('foo', '/foo/page', { 'app/foo/page': [writeChunk('page.js', 10)] });
    const hadSelf = 'self' in globalThis;
    expect(gate.main(buildDir, makeLog().log)).toBe(0);
    expect('__RSC_MANIFEST' in globalThis).toBe(false);
    expect('self' in globalThis).toBe(hadSelf);
  });

  // The success path is the EASY half. Every exit-2 path below throws from
  // inside `loadRouteManifest` AFTER the manifest was assigned onto
  // `globalThis`, so a cleanup that only runs on success leaks the bag to
  // whoever survives the throw. The gate process exits, but this suite does
  // not — a leak here silently contaminates the next test's measurement.
  it.each([
    [
      'multi-key manifest',
      () =>
        writeRouteManifest('foo', '/foo/page', { 'app/foo/page': [] }, { '/bar/page': {} }),
    ],
    [
      'no-key manifest',
      () => {
        const dir = path.join(buildDir, 'server', 'app', 'foo');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'page_client-reference-manifest.js'), '// nothing\n');
      },
    ],
    [
      'throwing manifest',
      () => {
        const dir = path.join(buildDir, 'server', 'app', 'foo');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, 'page_client-reference-manifest.js'),
          'throw new Error("boom");\n'
        );
      },
    ],
  ])('leaves no globals behind after failing on a %s', (_label, writeFixture) => {
    writeBuildManifest({ rootMainFiles: [writeChunk('root.js', 10)] });
    writeFixture();
    const hadSelf = 'self' in globalThis;
    expect(gate.main(buildDir, makeLog().log)).toBe(2);
    expect('__RSC_MANIFEST' in globalThis).toBe(false);
    expect('self' in globalThis).toBe(hadSelf);
  });
});

// ---------------------------------------------------------------------------
// Threshold behaviour (exit 0 / 1)
// ---------------------------------------------------------------------------

describe('threshold behaviour', () => {
  /** Build a single-route fixture whose first-load is `routeBytes`. */
  function fixture(routeBytes: number, extraTotalBytes = 0): void {
    const root = writeChunk('root.js', 1);
    writeBuildManifest({ rootMainFiles: [root] });
    writeRouteManifest('foo', '/foo/page', {
      'app/foo/page': [writeChunk('page.js', routeBytes - 1)],
    });
    if (extraTotalBytes > 0) writeChunk('orphan.js', extraTotalBytes);
  }

  it('passes when the heaviest route is under the warn line', () => {
    fixture(BUNDLE_ROUTE_FIRST_LOAD_WARN - 1024);
    const { log, text } = makeLog();
    expect(gate.main(buildDir, log)).toBe(0);
    expect(text()).toContain('Bundle size within limits.');
    expect(text()).not.toContain('::warning::');
  });

  it('warns but passes between the warn and fail lines', () => {
    fixture(BUNDLE_ROUTE_FIRST_LOAD_WARN + 1024);
    const { log, text } = makeLog();
    expect(gate.main(buildDir, log)).toBe(0);
    expect(text()).toContain('::warning::Route /foo/page first-load JS');
    expect(text()).not.toContain('::error::');
  });

  it('exactly at the fail line is not a failure', () => {
    fixture(BUNDLE_ROUTE_FIRST_LOAD_FAIL);
    expect(gate.main(buildDir, makeLog().log)).toBe(0);
  });

  it('exits 1 one byte over the fail line, naming the route', () => {
    fixture(BUNDLE_ROUTE_FIRST_LOAD_FAIL + 1);
    const { log, text } = makeLog();
    expect(gate.main(buildDir, log)).toBe(1);
    expect(text()).toContain('::error::Route /foo/page first-load JS');
    expect(text()).toContain('exceeds hard limit');
  });

  it('exits 1 when total JS exceeds its own limit even if every route is small', () => {
    // The two budgets are independent: unreferenced/lazy chunks land here only.
    fixture(1024, BUNDLE_TOTAL_FAIL + 1);
    const { log, text } = makeLog();
    expect(gate.main(buildDir, log)).toBe(1);
    expect(text()).toContain('::error::Total JS bundle');
    expect(text()).not.toContain('::error::Route');
  });

  it('warns on total JS between its warn and fail lines', () => {
    fixture(1024, BUNDLE_TOTAL_WARN + 1024);
    const { log, text } = makeLog();
    expect(gate.main(buildDir, log)).toBe(0);
    expect(text()).toContain('::warning::Total JS bundle');
  });

  it('counts nested chunk directories toward the total', () => {
    fixture(1024);
    const nested = path.join(buildDir, 'static', 'chunks', 'app', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'x.js'), 'y'.repeat(BUNDLE_TOTAL_FAIL + 1));
    const { log, text } = makeLog();
    expect(gate.main(buildDir, log)).toBe(1);
    expect(text()).toContain('::error::Total JS bundle');
  });
});

describe('formatBytes', () => {
  it('renders each unit band', () => {
    expect(gate.formatBytes(512)).toBe('512 B');
    expect(gate.formatBytes(2048)).toBe('2.0 KB');
    expect(gate.formatBytes(2 * 1024 * 1024)).toBe('2.00 MB');
  });
});
