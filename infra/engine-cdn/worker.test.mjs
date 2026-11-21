// Hermetic regression suite for the engine-cdn Cloudflare Worker.
//
// Runs with zero network / wrangler / live R2 via `node --test`. Drives the
// worker through a stub `env.ENGINE_BUCKET` that records every method called so
// the tests can assert the worker NEVER lists the bucket and NEVER attempts a
// write. Mirrors scripts/pitr-verify.test.mjs (node:test + node:assert/strict).
//
// These cases would FAIL against the pre-fix tree (the worker did not exist):
// the import alone throws, and each invariant (GET-only, no listing, CORS+CORP
// on every served object) is asserted explicitly.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import worker, {
  pathToKey,
  buildObjectHeaders,
  preflightResponse,
  methodNotAllowedResponse,
  notFoundResponse,
} from './worker.js';

/**
 * Build a stub R2 binding. Only `get` is implemented (the worker's entire
 * surface). `list`/`put`/`delete` throw if ever called, and `calls` records the
 * key history so a test can prove no enumeration happened.
 *
 * @param {Record<string, { body?: unknown, httpMetadata?: { contentType?: string }, httpEtag?: string }>} objects
 */
function makeBucket(objects) {
  const calls = { get: [] };
  return {
    calls,
    async get(key) {
      calls.get.push(key);
      return Object.prototype.hasOwnProperty.call(objects, key)
        ? objects[key]
        : null;
    },
    async list() {
      throw new Error('list() must never be called — no bucket listing allowed');
    },
    async put() {
      throw new Error('put() must never be called — public edge is read-only');
    },
    async delete() {
      throw new Error('delete() must never be called — public edge is read-only');
    },
  };
}

function req(method, path) {
  return new Request(`https://engine.spawnforge.ai${path}`, { method });
}

const WASM_KEY = 'abc123/engine-pkg-webgpu/forge_engine_bg.wasm';
const JS_KEY = 'abc123/engine-pkg-webgpu/forge_engine.js';

function fakeObject({ contentType, etag } = {}) {
  return {
    body: 'FAKE_BYTES',
    httpMetadata: contentType ? { contentType } : {},
    httpEtag: etag,
  };
}

describe('pathToKey', () => {
  test('strips a single leading slash', () => {
    assert.equal(pathToKey('/abc/forge_engine_bg.wasm'), 'abc/forge_engine_bg.wasm');
  });

  test('bare root → null (no object, no listing)', () => {
    assert.equal(pathToKey('/'), null);
  });

  test('empty string → null', () => {
    assert.equal(pathToKey(''), null);
  });

  test('directory-style trailing slash → null', () => {
    assert.equal(pathToKey('/engine-pkg-webgpu/'), null);
  });

  test('path traversal → null', () => {
    assert.equal(pathToKey('/../secret'), null);
    assert.equal(pathToKey('/a/../b'), null);
  });
});

describe('buildObjectHeaders', () => {
  test('*.wasm forces application/wasm and carries CORS + isolation', () => {
    const h = buildObjectHeaders(WASM_KEY, { contentType: 'text/plain' });
    assert.equal(h.get('Content-Type'), 'application/wasm');
    assert.equal(h.get('Access-Control-Allow-Origin'), '*');
    assert.equal(h.get('Cross-Origin-Resource-Policy'), 'cross-origin');
    assert.equal(h.get('Cross-Origin-Embedder-Policy'), 'require-corp');
    assert.equal(h.get('Cross-Origin-Opener-Policy'), 'same-origin');
    assert.equal(h.get('Cache-Control'), 'public, max-age=31536000, immutable');
  });

  test('non-wasm falls back to object httpMetadata content-type', () => {
    const h = buildObjectHeaders(JS_KEY, { contentType: 'application/javascript' });
    assert.equal(h.get('Content-Type'), 'application/javascript');
    // Still cross-origin isolated.
    assert.equal(h.get('Cross-Origin-Resource-Policy'), 'cross-origin');
    assert.equal(h.get('Access-Control-Allow-Origin'), '*');
  });

  test('header set exposes NO write/list affordance', () => {
    const h = buildObjectHeaders(WASM_KEY, {});
    assert.equal(h.get('Allow'), null);
    assert.match(h.get('Access-Control-Allow-Methods'), /^GET, HEAD, OPTIONS$/);
    assert.doesNotMatch(h.get('Access-Control-Allow-Methods'), /PUT|POST|DELETE/);
  });
});

describe('worker.fetch — happy path', () => {
  test('GET *.wasm → 200 with application/wasm + full isolation headers', async () => {
    const bucket = makeBucket({ [WASM_KEY]: fakeObject({ etag: '"deadbeef"' }) });
    const res = await worker.fetch(req('GET', `/${WASM_KEY}`), { ENGINE_BUCKET: bucket });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'application/wasm');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(res.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin');
    assert.equal(res.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
    assert.equal(res.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
    assert.equal(res.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    assert.equal(res.headers.get('ETag'), '"deadbeef"');
    assert.deepEqual(bucket.calls.get, [WASM_KEY]);
  });

  test('GET non-wasm (forge_engine.js) → 200 with object content-type + CORS/CORP', async () => {
    const bucket = makeBucket({
      [JS_KEY]: fakeObject({ contentType: 'application/javascript' }),
    });
    const res = await worker.fetch(req('GET', `/${JS_KEY}`), { ENGINE_BUCKET: bucket });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'application/javascript');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(res.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin');
  });

  test('HEAD returns headers but no body', async () => {
    const bucket = makeBucket({ [WASM_KEY]: fakeObject() });
    const res = await worker.fetch(req('HEAD', `/${WASM_KEY}`), { ENGINE_BUCKET: bucket });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'application/wasm');
    const body = await res.text();
    assert.equal(body, '');
  });
});

describe('worker.fetch — write methods are refused (read-only edge)', () => {
  for (const method of ['PUT', 'POST', 'DELETE', 'PATCH']) {
    test(`${method} → 405 with Allow: GET, HEAD and bucket untouched`, async () => {
      const bucket = makeBucket({ [WASM_KEY]: fakeObject() });
      const res = await worker.fetch(req(method, `/${WASM_KEY}`), { ENGINE_BUCKET: bucket });
      assert.equal(res.status, 405);
      assert.equal(res.headers.get('Allow'), 'GET, HEAD');
      // Negative: never offers a write method.
      assert.doesNotMatch(res.headers.get('Allow'), /PUT|POST|DELETE|PATCH/);
      // The bucket was never touched — no get, and (by stub) no put/delete.
      assert.deepEqual(bucket.calls.get, []);
    });
  }
});

describe('worker.fetch — no bucket listing', () => {
  test('bare / → 404 and never enumerates', async () => {
    const bucket = makeBucket({ [WASM_KEY]: fakeObject() });
    const res = await worker.fetch(req('GET', '/'), { ENGINE_BUCKET: bucket });
    assert.equal(res.status, 404);
    // The stub's list() throws if called; reaching here proves it wasn't.
    assert.deepEqual(bucket.calls.get, []);
  });

  test('directory-style path → 404 and never enumerates', async () => {
    const bucket = makeBucket({ [WASM_KEY]: fakeObject() });
    const res = await worker.fetch(req('GET', '/engine-pkg-webgpu/'), { ENGINE_BUCKET: bucket });
    assert.equal(res.status, 404);
    assert.deepEqual(bucket.calls.get, []);
  });

  test('worker default export has no list affordance', () => {
    assert.equal(typeof worker.fetch, 'function');
    assert.equal(worker.list, undefined);
    assert.equal(worker.put, undefined);
  });
});

describe('worker.fetch — CORS preflight', () => {
  test('OPTIONS → 204 with Access-Control-Allow-Methods', async () => {
    const bucket = makeBucket({});
    const res = await worker.fetch(req('OPTIONS', `/${WASM_KEY}`), { ENGINE_BUCKET: bucket });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.match(res.headers.get('Access-Control-Allow-Methods'), /GET, HEAD, OPTIONS/);
    // Preflight does not touch the bucket.
    assert.deepEqual(bucket.calls.get, []);
  });
});

describe('worker.fetch — miss', () => {
  test('GET of an absent key → 404', async () => {
    const bucket = makeBucket({});
    const res = await worker.fetch(req('GET', `/${WASM_KEY}`), { ENGINE_BUCKET: bucket });
    assert.equal(res.status, 404);
    assert.deepEqual(bucket.calls.get, [WASM_KEY]);
  });
});

describe('helper response builders', () => {
  test('methodNotAllowedResponse never advertises a write method', () => {
    const res = methodNotAllowedResponse();
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('Allow'), 'GET, HEAD');
    assert.doesNotMatch(res.headers.get('Allow'), /PUT/);
  });

  test('notFoundResponse is 404', () => {
    assert.equal(notFoundResponse().status, 404);
  });

  test('preflightResponse is 204', () => {
    assert.equal(preflightResponse().status, 204);
  });
});
