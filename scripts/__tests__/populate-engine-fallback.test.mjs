/** Cover artifact reuse packaging and fail-closed deployment wiring. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { populateEngineFallback } from '../populate-engine-fallback.mjs';

const VARIANTS = ['pkg-webgl2', 'pkg-webgpu', 'pkg-webgl2-runtime', 'pkg-webgpu-runtime'];
const MODULE = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'forge-engine-fallback-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const engine = resolve(root, 'engine');
  const publicRoot = resolve(root, 'public');
  for (const variant of VARIANTS) {
    mkdirSync(resolve(engine, variant), { recursive: true });
    writeFileSync(resolve(engine, variant, 'forge_engine_bg.wasm'), MODULE);
    writeFileSync(resolve(engine, variant, 'forge_engine.js'), 'export const ready = true;');
  }
  return { engine, publicRoot };
}
test('cached packages provide every same-origin browser dependency and replace stale contents', (t) => {
  const { engine, publicRoot } = fixture(t);
  mkdirSync(resolve(publicRoot, 'engine-pkg-webgl2'), { recursive: true });
  writeFileSync(resolve(publicRoot, 'engine-pkg-webgl2', 'stale.js'), 'obsolete');
  assert.deepEqual(populateEngineFallback(engine, publicRoot), VARIANTS.map((v) => 'engine-' + v));
  for (const variant of VARIANTS) {
    assert.deepEqual(readFileSync(resolve(publicRoot, 'engine-' + variant, 'forge_engine_bg.wasm')), MODULE);
    assert.equal(readFileSync(resolve(publicRoot, 'engine-' + variant, 'forge_engine.js'), 'utf8'), 'export const ready = true;');
  }
  assert.equal(existsSync(resolve(publicRoot, 'engine-pkg-webgl2', 'stale.js')), false);
});
for (const failure of ['missing variant', 'corrupt module', 'missing glue']) {
  test(failure + ' fails before replacing any fallback', (t) => {
    const { engine, publicRoot } = fixture(t);
    mkdirSync(resolve(publicRoot, 'engine-pkg-webgl2'), { recursive: true });
    const existing = resolve(publicRoot, 'engine-pkg-webgl2', 'old.js');
    writeFileSync(existing, 'preserve');
    if (failure === 'missing variant') rmSync(resolve(engine, 'pkg-webgpu-runtime'), { recursive: true });
    if (failure === 'corrupt module') writeFileSync(resolve(engine, 'pkg-webgpu-runtime', 'forge_engine_bg.wasm'), MODULE.subarray(0, 7));
    if (failure === 'missing glue') rmSync(resolve(engine, 'pkg-webgpu-runtime', 'forge_engine.js'));
    assert.throws(() => populateEngineFallback(engine, publicRoot), /pkg-webgpu-runtime:/);
    assert.equal(readFileSync(existing, 'utf8'), 'preserve');
    assert.equal(existsSync(resolve(publicRoot, 'engine-pkg-webgpu')), false);
  });
}
const workflow = readFileSync(new URL('../../.github/workflows/cd.yml', import.meta.url), 'utf8');
for (const target of ['staging', 'production']) {
  test(target + ' cannot skip artifact download, packaging, or upload validation', () => {
    const job = workflow.split('  deploy-' + target + ':')[1].split(/\n  [a-z][a-z0-9-]*:\n/)[0];
    for (const name of ['Download WASM artifacts for same-origin fallback', 'Populate same-origin WASM fallback', 'Verify ' + target + ' upload contains the engine']) {
      const step = job.split('      - name: ' + name + '\n')[1]?.split(/\n      - /)[0];
      assert.ok(step, 'missing step: ' + name);
      assert.doesNotMatch(step, /\n        (if:|continue-on-error:)/);
    }
    assert.match(job, /node scripts\/populate-engine-fallback[.]mjs engine web\/public/);
    assert.ok(job.indexOf('Populate same-origin') < job.indexOf('Verify ' + target + ' upload'));
    assert.ok(job.indexOf('Verify ' + target + ' upload') < job.indexOf('Deploy to ' + target + ' (remote build)'));
  });
}
