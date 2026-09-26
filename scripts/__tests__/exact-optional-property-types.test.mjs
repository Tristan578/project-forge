// Pins `exactOptionalPropertyTypes: true` as the EFFECTIVE compiler option of
// the three packages that turned it on in #7592. Nothing else would notice the
// flag being deleted: every file that compiles under it also compiles without
// it, so tsc, vitest and the build all stay green while checking silently
// loosens (lessons-learned #16 — a property no runtime test can see needs a
// pin, and the pin must be mutation-tested).
//
// "Effective" means after following `extends`, the way tsc resolves it: a
// child's own value wins, otherwise the nearest ancestor's. A key that only
// appears in a comment, or a chain that ends without the key, is a failure.
//
// web/ is deliberately absent: its migration is #10230. Add it to PINNED when
// that lands.
//
// Runs in the CI Self-Defense Tests job, which has no `npm ci`, so this file
// uses node built-ins only (no `typescript` import for parsing tsconfig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const PINNED = ['apps/docs/tsconfig.json', 'mcp-server/tsconfig.json', 'packages/ui/tsconfig.json'];
const FLAG = 'exactOptionalPropertyTypes';

// tsconfig is JSONC: // and /* */ comments plus trailing commas. Strip both
// outside string literals, then JSON.parse.
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') { out += next ?? ''; i += 2; continue; }
      if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === '"') { inString = true; out += c; i += 1; continue; }
    if (c === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i += 1; continue; }
    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) throw new Error('unterminated block comment');
      i = end + 2;
      continue;
    }
    if (c === ',') {
      // Trailing comma: next non-whitespace, non-comment char closes a scope.
      let j = i + 1;
      for (;;) {
        while (j < text.length && /\s/.test(text[j])) j += 1;
        if (text[j] === '/' && text[j + 1] === '/') { while (j < text.length && text[j] !== '\n') j += 1; continue; }
        if (text[j] === '/' && text[j + 1] === '*') { const e = text.indexOf('*/', j + 2); j = e === -1 ? text.length : e + 2; continue; }
        break;
      }
      if (text[j] === '}' || text[j] === ']') { i += 1; continue; }
    }
    out += c;
    i += 1;
  }
  return JSON.parse(out);
}

// Returns the effective value of compilerOptions[FLAG] for the tsconfig at
// `file`, following relative `extends` (string or array; later entries win,
// as in tsc). A non-relative (package) extends cannot be resolved here without
// node_modules, so it throws rather than guessing.
export function effectiveFlag(file, seen = new Set()) {
  const abs = resolve(file);
  if (seen.has(abs)) throw new Error(`extends cycle at ${abs}`);
  seen.add(abs);
  const cfg = parseJsonc(readFileSync(abs, 'utf8'));
  const own = cfg.compilerOptions?.[FLAG];
  if (own !== undefined) return own;
  const parents = cfg.extends === undefined ? [] : [].concat(cfg.extends);
  let inherited;
  for (const ext of parents) {
    if (!ext.startsWith('.')) throw new Error(`cannot resolve package extends "${ext}" from ${abs}`);
    let target = resolve(dirname(abs), ext);
    if (!existsSync(target) && existsSync(`${target}.json`)) target = `${target}.json`;
    const v = effectiveFlag(target, new Set(seen));
    if (v !== undefined) inherited = v;
  }
  return inherited;
}

for (const rel of PINNED) {
  test(`${rel} has ${FLAG} effectively true`, () => {
    assert.equal(effectiveFlag(join(root, rel)), true, `${rel}: ${FLAG} must resolve to true (#7592)`);
  });
}

test('the pinned list is non-empty and every file exists', () => {
  assert.ok(PINNED.length === 3);
  for (const rel of PINNED) assert.ok(existsSync(join(root, rel)), `${rel} missing`);
});

// The resolver itself — each case is a way the pin could be defeated.
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'eopt-'));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

test('resolver: flag deleted → undefined (the pin goes red)', () => {
  const dir = fixture({ 'tsconfig.json': '{ "compilerOptions": { "strict": true } }' });
  try { assert.equal(effectiveFlag(join(dir, 'tsconfig.json')), undefined); } finally { rmSync(dir, { recursive: true }); }
});

test('resolver: flag only in a comment is not the flag', () => {
  const dir = fixture({
    'tsconfig.json': '{\n  "compilerOptions": {\n    // "exactOptionalPropertyTypes": true,\n    /* "exactOptionalPropertyTypes": true */\n    "strict": true,\n  },\n}\n',
  });
  try { assert.equal(effectiveFlag(join(dir, 'tsconfig.json')), undefined); } finally { rmSync(dir, { recursive: true }); }
});

test('resolver: inherited through extends counts', () => {
  const dir = fixture({
    'base.json': '{ "compilerOptions": { "exactOptionalPropertyTypes": true } }',
    'pkg/tsconfig.json': '{ "extends": "../base", "compilerOptions": {} }',
  });
  try { assert.equal(effectiveFlag(join(dir, 'pkg/tsconfig.json')), true); } finally { rmSync(dir, { recursive: true }); }
});

test('resolver: child false overrides inherited true', () => {
  const dir = fixture({
    'base.json': '{ "compilerOptions": { "exactOptionalPropertyTypes": true } }',
    'tsconfig.json': '{ "extends": ["./base.json"], "compilerOptions": { "exactOptionalPropertyTypes": false } }',
  });
  try { assert.equal(effectiveFlag(join(dir, 'tsconfig.json')), false); } finally { rmSync(dir, { recursive: true }); }
});

test('resolver: later extends entry wins', () => {
  const dir = fixture({
    'a.json': '{ "compilerOptions": { "exactOptionalPropertyTypes": true } }',
    'b.json': '{ "compilerOptions": { "exactOptionalPropertyTypes": false } }',
    'tsconfig.json': '{ "extends": ["./a.json", "./b.json"] }',
  });
  try { assert.equal(effectiveFlag(join(dir, 'tsconfig.json')), false); } finally { rmSync(dir, { recursive: true }); }
});

test('parser: comment and trailing-comma lookalikes inside strings are preserved', () => {
  const parsed = parseJsonc('{ "a": "http://x/*,]", "b": "q\\" // ,}", "c": [1, 2, /* x */ ], }');
  assert.deepEqual(parsed, { a: 'http://x/*,]', b: 'q" // ,}', c: [1, 2] });
});

test('resolver: package extends fails closed', () => {
  const dir = fixture({ 'tsconfig.json': '{ "extends": "@tsconfig/strictest" }' });
  try { assert.throws(() => effectiveFlag(join(dir, 'tsconfig.json')), /cannot resolve package extends/); } finally { rmSync(dir, { recursive: true }); }
});
