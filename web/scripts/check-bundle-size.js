#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * CI quality gate: enforce JS/CSS bundle size limits after next build.
 *
 * Thresholds are defined in src/lib/config/performanceTargets.ts.
 * This script duplicates the numeric values because it runs as a
 * standalone Node CJS script (no TypeScript, no path aliases).
 *
 * When updating thresholds, update performanceTargets.ts FIRST,
 * then mirror the values here.
 *
 * Thresholds:
 *   First-load JS:  warn > 3.5 MB, fail > 4 MB
 *   Total JS:       warn > 4.5 MB, fail > 5 MB
 *
 * Usage:  node scripts/check-bundle-size.js
 * Expects: npm run build has already been run (.next/ exists)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, '.next');

// Mirror of performanceTargets.ts BUNDLE_* constants.
// Names match the canonical constants for grep-based discovery.
// Previous values (pre-2026-03-31): 4/4.75/5/5.5 MB
const BUNDLE_BUNDLE_FIRST_LOAD_WARN = 3.5 * 1024 * 1024;
const BUNDLE_BUNDLE_FIRST_LOAD_FAIL = 4 * 1024 * 1024;
const BUNDLE_BUNDLE_TOTAL_WARN = 4.5 * 1024 * 1024;
const BUNDLE_BUNDLE_TOTAL_FAIL = 5 * 1024 * 1024;

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function sumJsFiles(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return total;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += sumJsFiles(full);
    } else if (entry.name.endsWith('.js')) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

if (!fs.existsSync(BUILD_DIR)) {
  console.error('Error: .next/ build directory not found. Run npm run build first.');
  process.exit(1);
}

const chunksDir = path.join(BUILD_DIR, 'static', 'chunks');
const pagesChunksDir = path.join(chunksDir, 'pages');
const appChunksDir = path.join(chunksDir, 'app');

let firstLoadSize = 0;
if (fs.existsSync(chunksDir)) {
  const entries = fs.readdirSync(chunksDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() && entry.name.endsWith('.js')) {
      firstLoadSize += fs.statSync(path.join(chunksDir, entry.name)).size;
    }
  }
}

const totalPageSize = sumJsFiles(pagesChunksDir) + sumJsFiles(appChunksDir);
const grandTotal = firstLoadSize + totalPageSize;

console.log('=== Bundle Size Report ===');
console.log('First-load JS (shared chunks): ' + formatBytes(firstLoadSize));
console.log('Page JS (routes):              ' + formatBytes(totalPageSize));
console.log('Grand total JS:                ' + formatBytes(grandTotal));
console.log('==========================');
console.log();

let failed = false;

if (firstLoadSize > BUNDLE_FIRST_LOAD_FAIL) {
  console.error('::error::First-load JS ' + formatBytes(firstLoadSize) + ' exceeds hard limit of ' + formatBytes(BUNDLE_FIRST_LOAD_FAIL));
  failed = true;
} else if (firstLoadSize > BUNDLE_FIRST_LOAD_WARN) {
  console.warn('::warning::First-load JS ' + formatBytes(firstLoadSize) + ' exceeds warning threshold of ' + formatBytes(BUNDLE_FIRST_LOAD_WARN));
}

if (grandTotal > BUNDLE_TOTAL_FAIL) {
  console.error('::error::Total JS bundle ' + formatBytes(grandTotal) + ' exceeds hard limit of ' + formatBytes(BUNDLE_TOTAL_FAIL));
  failed = true;
} else if (grandTotal > BUNDLE_TOTAL_WARN) {
  console.warn('::warning::Total JS bundle ' + formatBytes(grandTotal) + ' exceeds warning threshold of ' + formatBytes(BUNDLE_TOTAL_WARN));
}

if (failed) {
  console.error();
  console.error('Bundle size exceeds hard limits. Reduce JS bundle size before merging.');
  process.exit(1);
} else {
  console.log('Bundle size within limits.');
  process.exit(0);
}
