/** Exercise the exact CLI used by CD against complete and corrupt package sets. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CLI = fileURLToPath(new URL('../verify-engine-wasm.mjs', import.meta.url));
const VARIANTS = ['pkg-webgl2', 'pkg-webgpu', 'pkg-webgl2-runtime', 'pkg-webgpu-runtime'];
const MODULE = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]); // Valid empty WASM module.

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'forge-wasm-verify-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const variant of VARIANTS) {
    mkdirSync(resolve(root, variant));
    writeFileSync(resolve(root, variant, 'forge_engine_bg.wasm'), MODULE);
    writeFileSync(resolve(root, variant, 'forge_engine.js'), 'export const ready = true;');
  }
  return root;
}
function run(root) { return spawnSync(process.execPath, [CLI, root], { encoding: 'utf8' }); }

test('a valid four-variant set passes the production CLI', (t) => {
  const result = run(fixture(t));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.split('\n').filter((line) => line.startsWith('ok: ')).map((line) => line.slice(4)), VARIANTS);
});
for (const variant of VARIANTS) {
  test(variant + ': another WASM filename cannot substitute for the browser dependency', (t) => {
    const root = fixture(t);
    renameSync(resolve(root, variant, 'forge_engine_bg.wasm'), resolve(root, variant, 'other.wasm'));
    const result = run(root);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(variant + ': missing or unreadable forge_engine_bg.wasm'));
  });
}
for (const [name, corrupt] of [
  ['empty module', Buffer.alloc(0)],
  ['truncated module', MODULE.subarray(0, 7)],
  ['garbage module', Buffer.from('not a wasm module')],
  ['malformed section after a valid header', Buffer.concat([MODULE, Buffer.from([1, 2, 255])])],
]) {
  test(name + ' fails before persistence', (t) => {
    const root = fixture(t);
    writeFileSync(resolve(root, 'pkg-webgpu-runtime', 'forge_engine_bg.wasm'), corrupt);
    const result = run(root);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('pkg-webgpu-runtime:'));
    assert.ok(result.stderr.includes('forge_engine_bg.wasm'));
  });
}
for (const [name, contents] of [['empty glue', ''], ['truncated glue', 'export const broken =']]) {
  test(name + ' fails before persistence', (t) => {
    const root = fixture(t);
    writeFileSync(resolve(root, 'pkg-webgl2', 'forge_engine.js'), contents);
    const result = run(root);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('pkg-webgl2:'));
    assert.ok(result.stderr.includes('forge_engine.js'));
  });
}
test('missing glue is rejected by name', (t) => {
  const root = fixture(t);
  rmSync(resolve(root, 'pkg-webgl2', 'forge_engine.js'));
  const result = run(root);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('pkg-webgl2: missing or unreadable forge_engine.js'));
});
test('missing variant is rejected by name', (t) => {
  const root = fixture(t);
  rmSync(resolve(root, 'pkg-webgpu'), { recursive: true });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('pkg-webgpu:'));
});
