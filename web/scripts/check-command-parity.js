#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * CI quality gate: verify every MCP command in the manifest has a matching
 * handler registered in the chat handler modules.
 *
 * Usage:  node scripts/check-command-parity.js
 * Exit 0: all commands have handlers
 * Exit 1: one or more commands are missing handlers
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.resolve(ROOT, '..', 'mcp-server', 'manifest', 'commands.json');
const HANDLERS_DIR = path.join(ROOT, 'src', 'lib', 'chat', 'handlers');

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const manifestNames = new Set(manifest.commands.map((c) => c.name));

const handlerFiles = fs
  .readdirSync(HANDLERS_DIR)
  .filter((f) => f.endsWith('.ts') && f !== 'types.ts' && f !== 'helpers.ts');

const handlerKeys = new Set();

// Regex for a single handler key line — must match only within a handlers block.
// Uses a simple, linear-time pattern: no nested quantifiers, no backtracking risk.
const KEY_LINE_RE = /^\s{2,}['"]?([a-z][a-z0-9_]*)['"]?\s*:/;
const HANDLERS_OPEN_RE = /(?:export\s+)?const\s+\w+[Hh]andlers\s*[=:]/;

for (const file of handlerFiles) {
  const content = fs.readFileSync(path.join(HANDLERS_DIR, file), 'utf8');
  // Scan line by line to avoid multi-line ReDoS (CodeQL cwe-1333).
  // Track brace depth to know when we are inside a handlers object literal.
  const lines = content.split('\n');
  let inHandlers = false;
  let depth = 0;
  for (const line of lines) {
    if (!inHandlers) {
      if (HANDLERS_OPEN_RE.test(line)) {
        inHandlers = true;
        depth = 0;
        // Count any opening braces on this same line
        for (const ch of line) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
      }
      continue;
    }
    // Count braces to track when the handlers object closes
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth <= 0) {
      inHandlers = false;
      continue;
    }
    const m = KEY_LINE_RE.exec(line);
    if (m) {
      const key = m[1];
      if (key.includes('_') || manifestNames.has(key)) {
        handlerKeys.add(key);
      }
    }
  }
}

const missing = [...manifestNames].filter((n) => !handlerKeys.has(n)).sort();
const extra = [...handlerKeys].filter((n) => !manifestNames.has(n)).sort();

console.log('Manifest commands: ', manifestNames.size);
console.log('Handler keys:      ', handlerKeys.size);
console.log();

if (extra.length > 0) {
  console.log('Handlers without manifest entry (' + extra.length + '):');
  extra.forEach((n) => console.log('  + ' + n));
  console.log();
}

if (missing.length === 0) {
  console.log('All manifest commands have handlers.');
  process.exit(0);
} else {
  console.error('Missing handlers for ' + missing.length + ' manifest command(s):');
  missing.forEach((n) => console.error('  - ' + n));
  console.error();
  console.error(
    'Every command in mcp-server/manifest/commands.json must have a handler in web/src/lib/chat/handlers/.'
  );
  process.exit(1);
}
