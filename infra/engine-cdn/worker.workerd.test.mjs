import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestHarness, unstable_readConfig } from 'wrangler';
import { fileURLToPath } from 'node:url';
const configPath = fileURLToPath(new URL('./wrangler.toml', import.meta.url));
const server = createTestHarness({ workers: [{ configPath }] });
const magic = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
const wasm = 'a105d3a7/engine-pkg-webgpu/forge_engine_bg.wasm';
const js = 'a105d3a7/engine-pkg-webgpu/forge_engine.js';
let bucket;
describe('canonical Wrangler config in real workerd', () => {
  before(async () => {
    await server.listen();
    const env = await server.getWorker('engine-cdn').getEnv();
    assert.ok(env.ENGINE_BUCKET && typeof env.ENGINE_BUCKET.put === 'function');
    assert.equal(env.ASSET_BUCKET, undefined);
    bucket = env.ENGINE_BUCKET;
    await bucket.put(wasm, magic, { httpMetadata: { contentType: 'application/octet-stream' } });
    await bucket.put(js, 'export const version = 1;', { httpMetadata: { contentType: 'application/javascript' } });
  });
  after(async () => { await server.close(); });
  it('binds only the intended engine bucket and enables cache on the pinned runtime', () => {
    const config = unstable_readConfig({ config: configPath }, { hideWarnings: true });
    assert.equal(config.name, 'engine-cdn');
    assert.equal(config.compatibility_date, '2026-07-30');
    assert.deepEqual(config.r2_buckets, [{ binding: 'ENGINE_BUCKET', bucket_name: 'spawnforge-engine' }]);
    assert.equal(config.cache.enabled, true);
  });
  it('serves seeded R2 WASM bytes, forced MIME, ETag and isolation headers', async () => {
    const response = await server.fetch('https://engine.spawnforge.ai/' + wasm);
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), magic);
    assert.equal(response.headers.get('content-type'), 'application/wasm');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp');
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(response.headers.get('etag'), (await bucket.head(wasm)).httpEtag);
    const head = await server.fetch('/' + wasm, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-type'), 'application/wasm');
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  });
  it('serves JavaScript using real R2 metadata', async () => {
    const response = await server.fetch('/' + js);
    assert.equal(response.headers.get('content-type'), 'application/javascript');
    assert.equal(await response.text(), 'export const version = 1;');
  });
  it('does not freeze mutable aliases after their object is replaced', async () => {
    const alias = 'latest/engine-pkg-webgpu/forge_engine.js';
    await bucket.put(alias, 'first');
    const first = await server.fetch('/' + alias);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.equal(await first.text(), 'first');
    await bucket.put(alias, 'second');
    const second = await server.fetch('/' + alias);
    assert.equal(second.headers.get('cache-control'), 'no-store');
    assert.equal(await second.text(), 'second');
  });
  it('refuses writes and listings without changing or revealing bucket objects', async () => {
    const beforeKeys = (await bucket.list()).objects.map(object => object.key);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await server.fetch('/' + wasm, { method });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('allow'), 'GET, HEAD');
    }
    for (const path of ['/', '/a105d3a7/', '/missing.wasm']) {
      const response = await server.fetch(path);
      assert.equal(response.status, 404);
      assert.equal(await response.text(), 'Not Found');
    }
    assert.deepEqual((await bucket.list()).objects.map(object => object.key), beforeKeys);
    assert.deepEqual(new Uint8Array(await (await bucket.get(wasm)).arrayBuffer()), magic);
    const preflight = await server.fetch('/' + wasm, { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS');
  });
});
