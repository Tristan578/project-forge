#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * CI quality gate: enforce JS bundle size limits after next build.
 *
 * ## What this measures, and why the old metric was wrong
 *
 * The previous version summed every top-level `.js` file under
 * `.next/static/chunks` and called the result "First-load JS (shared chunks)".
 * Under Turbopack that number is not a first-load figure at all:
 *
 *   1. It counts lazily-loaded chunks. A `next/dynamic` import emits its own
 *      chunk (listed in a route's `react-loadable-manifest.json`) that no page
 *      loads on first paint.
 *   2. It counts the same module graph more than once. Turbopack groups chunks
 *      per client entry, so one graph reachable from two entries is emitted
 *      twice under two hashes. Crossing a grouping threshold duplicates a chunk
 *      wholesale — measured live: 3,665 bytes of new source code moved a shared
 *      chunk 48,181 -> 51,846 bytes and re-emitted it, for a +52,015 byte
 *      "regression" that shipped no such thing.
 *   3. `Page JS (routes)` was structurally always `0 B`: it summed
 *      `static/chunks/app` and `static/chunks/pages`, and Turbopack emits
 *      neither directory. So `grandTotal === firstLoadSize`, and the total-JS
 *      threshold pair was a second threshold on the same number — dead code,
 *      since the (lower) first-load fail line always tripped first.
 *
 * What a route actually first-loads is recorded by Next itself:
 *   - `.next/build-manifest.json` -> `rootMainFiles` + `polyfillFiles`
 *   - `.next/server/app/**\/page_client-reference-manifest.js` -> `entryJSFiles`,
 *     which maps each client entry module of that route to its chunk files.
 *
 * This gate sums those per route and budgets the HEAVIEST route. Chunks shared
 * between entries are de-duplicated by set membership, so the grouping churn
 * above cannot move the number. `--metadata` entries are excluded (they are
 * server-side metadata routes, not client JS); error/not-found boundaries are
 * included, because they ship with the route.
 *
 * Turbopack does not emit `.next/app-build-manifest.json` and prints no
 * Size / First Load JS columns, so there is no upstream number to cross-check.
 * The measurement below is the grounding:
 *
 *   origin/main @ 2026-08-10 (production build, 27 routes):
 *     heaviest route  /editor/[id]  1.95 MB  (23 chunks)
 *     runner-up       /sign-up      1.59 MB
 *     total static/chunks JS        5.49 MB
 *
 * Thresholds are defined in src/lib/config/performanceTargets.ts. This script
 * duplicates the numeric values because it runs as a standalone Node CJS script
 * (no TypeScript, no path aliases) — the duplication is pinned by
 * scripts/__tests__/check-bundle-size.test.ts, so it can no longer drift
 * silently. Update performanceTargets.ts FIRST, then mirror the values here.
 *
 * Exit codes follow the house convention:
 *   0 = within limits
 *   1 = a real finding (a threshold was exceeded)
 *   2 = fail-closed tooling error (build output missing or unreadable, so the
 *       gate could not measure anything — never reported as a pass)
 *
 * Usage:  node scripts/check-bundle-size.js
 * Expects: npm run build has already been run (.next/ exists)
 */

const fs = require('fs');
const path = require('path');

// Mirror of performanceTargets.ts BUNDLE_* constants.
// Names match the canonical constants for grep-based discovery.
const BUNDLE_ROUTE_FIRST_LOAD_WARN = 2.1 * 1024 * 1024;
const BUNDLE_ROUTE_FIRST_LOAD_FAIL = 2.3 * 1024 * 1024;
const BUNDLE_TOTAL_WARN = 5.5 * 1024 * 1024;
const BUNDLE_TOTAL_FAIL = 6 * 1024 * 1024;

/** Thrown for conditions that must fail closed (exit 2), never pass. */
class BundleToolingError extends Error {}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/** Recursively sum every `.js` file under `dir`. Missing dir contributes 0. */
function sumJsFiles(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return total;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += sumJsFiles(full);
    else if (entry.name.endsWith('.js')) total += fs.statSync(full).size;
  }
  return total;
}

/** Every `page_client-reference-manifest.js` under `.next/server/app`. */
function findRouteManifests(serverAppDir) {
  const out = [];
  if (!fs.existsSync(serverAppDir)) return out;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'page_client-reference-manifest.js') out.push(full);
    }
  };
  walk(serverAppDir);
  return out.sort();
}

/**
 * Load one route's client-reference manifest.
 *
 * The file assigns into `globalThis.__RSC_MANIFEST[<routeKey>]` and expects
 * `self` to exist. The stored value is an object in the current Next version
 * but a JSON string in others, so both are handled. More than one key means the
 * file is not the single-route artifact this gate assumes — fail closed rather
 * than silently grade the first key.
 */
function loadRouteManifest(manifestFile) {
  const abs = path.resolve(manifestFile);
  const priorSelf = globalThis.self;
  globalThis.__RSC_MANIFEST = {};
  globalThis.self = globalThis;
  // `bag` is read out of the global and every later line uses the LOCAL, so the
  // globals are restored in the finally below on EVERY path — including the
  // throws further down. Deleting `__RSC_MANIFEST` only on the success path
  // leaks it to the caller on every failure, which cross-contaminates callers
  // that survive the throw (the unit suite does).
  let bag;
  try {
    delete require.cache[abs];
    require(abs);
    bag = globalThis.__RSC_MANIFEST;
  } catch (err) {
    throw new BundleToolingError(
      'Could not load route manifest ' + manifestFile + ': ' + (err && err.message) +
      '. The build output is incomplete or stale — re-run npm run build.'
    );
  } finally {
    if (priorSelf === undefined) delete globalThis.self;
    else globalThis.self = priorSelf;
    delete globalThis.__RSC_MANIFEST;
  }

  const keys = Object.keys(bag);
  if (keys.length !== 1) {
    throw new BundleToolingError(
      'Expected exactly 1 route key in ' + manifestFile + ', found ' + keys.length +
      ' (' + keys.join(', ') + '). The manifest format changed — update this gate.'
    );
  }
  let manifest = bag[keys[0]];
  if (typeof manifest === 'string') {
    try {
      manifest = JSON.parse(manifest);
    } catch (err) {
      throw new BundleToolingError(
        'Route manifest ' + manifestFile + ' is not valid JSON: ' + (err && err.message) +
        '. The build output is incomplete or stale — re-run npm run build.'
      );
    }
  }
  if (!manifest || typeof manifest !== 'object') {
    throw new BundleToolingError(
      'Route manifest ' + manifestFile + ' resolved to a non-object' +
      '. The build output is incomplete or stale — re-run npm run build.'
    );
  }
  delete globalThis.__RSC_MANIFEST;
  return { routeKey: keys[0], entryJSFiles: manifest.entryJSFiles || {} };
}

/**
 * Per-route first-load JS: the root chunks every route loads, plus the chunk
 * files of every non-metadata client entry of that route, de-duplicated.
 */
function computeRouteFirstLoad(buildDir) {
  const buildManifestPath = path.join(buildDir, 'build-manifest.json');
  if (!fs.existsSync(buildManifestPath)) {
    throw new BundleToolingError(
      'build-manifest.json not found at ' + buildManifestPath + '. Run npm run build first.'
    );
  }
  let buildManifest;
  try {
    buildManifest = JSON.parse(fs.readFileSync(buildManifestPath, 'utf8'));
  } catch (err) {
    throw new BundleToolingError(
      'build-manifest.json is not valid JSON: ' + (err && err.message) +
      '. The build output is incomplete or stale — re-run npm run build.'
    );
  }

  const baseFiles = [
    ...(buildManifest.rootMainFiles || []),
    ...(buildManifest.polyfillFiles || []),
  ];

  const sizeOf = (relFile) => {
    const full = path.join(buildDir, relFile);
    if (!fs.existsSync(full)) {
      throw new BundleToolingError(
        'Manifest references a chunk that does not exist on disk: ' + relFile +
        '. The build output is incomplete — re-run npm run build.'
      );
    }
    return fs.statSync(full).size;
  };

  const manifestFiles = findRouteManifests(path.join(buildDir, 'server', 'app'));
  if (manifestFiles.length === 0) {
    throw new BundleToolingError(
      'No route client-reference manifests found under ' +
      path.join(buildDir, 'server', 'app') +
      '. Nothing was measured, so this is not a pass.' +
      ' If the build succeeded, the manifest layout changed — update this gate.'
    );
  }

  const routes = [];
  for (const manifestFile of manifestFiles) {
    const { routeKey, entryJSFiles } = loadRouteManifest(manifestFile);
    const chunks = new Set(baseFiles);
    for (const [entry, files] of Object.entries(entryJSFiles)) {
      // Metadata routes (favicon, opengraph-image, ...) are server-rendered
      // and never part of a route's client first load.
      if (entry.endsWith('--metadata')) continue;
      for (const file of files || []) chunks.add(file);
    }
    let bytes = 0;
    for (const file of chunks) bytes += sizeOf(file);
    routes.push({ route: routeKey, bytes, chunkCount: chunks.size });
  }

  routes.sort((a, b) => b.bytes - a.bytes || a.route.localeCompare(b.route));
  return routes;
}

/** Measure the build. Throws BundleToolingError when it cannot measure. */
function analyzeBundle(buildDir) {
  if (!fs.existsSync(buildDir)) {
    throw new BundleToolingError(
      'Build directory ' + buildDir + ' not found. Run npm run build first.'
    );
  }
  const routes = computeRouteFirstLoad(buildDir);
  const totalJs = sumJsFiles(path.join(buildDir, 'static', 'chunks'));
  return { routes, heaviest: routes[0], totalJs };
}

/** Render + threshold-check a report. Returns the process exit code. */
function reportBundle(report, log) {
  const { routes, heaviest, totalJs } = report;

  log.info('=== Bundle Size Report ===');
  log.info('Routes measured:               ' + routes.length);
  log.info(
    'Heaviest route first-load JS:  ' + formatBytes(heaviest.bytes) +
    '  (' + heaviest.route + ', ' + heaviest.chunkCount + ' chunks)'
  );
  for (const route of routes.slice(1, 4)) {
    log.info(
      '  next:                        ' + formatBytes(route.bytes) + '  (' + route.route + ')'
    );
  }
  log.info('Total static/chunks JS:        ' + formatBytes(totalJs));
  log.info('==========================');
  log.info('');

  let failed = false;

  if (heaviest.bytes > BUNDLE_ROUTE_FIRST_LOAD_FAIL) {
    log.error(
      '::error::Route ' + heaviest.route + ' first-load JS ' + formatBytes(heaviest.bytes) +
      ' exceeds hard limit of ' + formatBytes(BUNDLE_ROUTE_FIRST_LOAD_FAIL)
    );
    failed = true;
  } else if (heaviest.bytes > BUNDLE_ROUTE_FIRST_LOAD_WARN) {
    log.warn(
      '::warning::Route ' + heaviest.route + ' first-load JS ' + formatBytes(heaviest.bytes) +
      ' exceeds warning threshold of ' + formatBytes(BUNDLE_ROUTE_FIRST_LOAD_WARN)
    );
  }

  if (totalJs > BUNDLE_TOTAL_FAIL) {
    log.error(
      '::error::Total JS bundle ' + formatBytes(totalJs) + ' exceeds hard limit of ' +
      formatBytes(BUNDLE_TOTAL_FAIL)
    );
    failed = true;
  } else if (totalJs > BUNDLE_TOTAL_WARN) {
    log.warn(
      '::warning::Total JS bundle ' + formatBytes(totalJs) +
      ' exceeds warning threshold of ' + formatBytes(BUNDLE_TOTAL_WARN)
    );
  }

  if (failed) {
    log.error('');
    log.error('Bundle size exceeds hard limits. Reduce JS bundle size before merging.');
    return 1;
  }
  log.info('Bundle size within limits.');
  return 0;
}

function main(buildDir, log) {
  let report;
  try {
    report = analyzeBundle(buildDir);
  } catch (err) {
    if (err instanceof BundleToolingError) {
      log.error('Error: ' + err.message);
      return 2;
    }
    throw err;
  }
  return reportBundle(report, log);
}

module.exports = {
  BUNDLE_ROUTE_FIRST_LOAD_WARN,
  BUNDLE_ROUTE_FIRST_LOAD_FAIL,
  BUNDLE_TOTAL_WARN,
  BUNDLE_TOTAL_FAIL,
  BundleToolingError,
  formatBytes,
  sumJsFiles,
  findRouteManifests,
  loadRouteManifest,
  computeRouteFirstLoad,
  analyzeBundle,
  reportBundle,
  main,
};

if (require.main === module) {
  const buildDir = path.join(path.resolve(__dirname, '..'), '.next');
  process.exit(
    main(buildDir, {
      info: (m) => console.log(m),
      warn: (m) => console.warn(m),
      error: (m) => console.error(m),
    })
  );
}
