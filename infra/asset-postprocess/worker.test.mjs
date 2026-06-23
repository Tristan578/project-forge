import { describe, it, expect, vi } from 'vitest';
import workerDefault, {
  extractKey,
  shouldSkip,
  processMessage,
} from './worker.mjs';

function makeGlbBytes() {
  const buf = new ArrayBuffer(20);
  const view = new DataView(buf);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, 20, true);
  return new Uint8Array(buf);
}

/** Minimal in-memory R2 bucket stub. */
function makeBucket(objects = {}) {
  const store = { ...objects };
  return {
    puts: {},
    async get(key) {
      const o = store[key];
      if (!o) return null;
      return {
        httpMetadata: { contentType: o.contentType },
        async arrayBuffer() {
          return o.bytes.buffer.slice(
            o.bytes.byteOffset,
            o.bytes.byteOffset + o.bytes.byteLength
          );
        },
      };
    },
    async put(key, value) {
      this.puts[key] = value;
      store[key] = { bytes: new TextEncoder().encode(value), contentType: 'application/json' };
    },
  };
}

describe('extractKey', () => {
  it('reads R2 event-notification object.key', () => {
    expect(extractKey({ object: { key: 'assets/u/a/model.glb' }, action: 'PutObject' })).toBe(
      'assets/u/a/model.glb'
    );
  });
  it('reads a flat { key } shape', () => {
    expect(extractKey({ key: 'x/y.png' })).toBe('x/y.png');
  });
  it('returns null for unrecognized shapes', () => {
    expect(extractKey(null)).toBeNull();
    expect(extractKey('nope')).toBeNull();
    expect(extractKey({})).toBeNull();
    expect(extractKey({ object: {} })).toBeNull();
  });
});

describe('shouldSkip', () => {
  it('skips our own status sidecars', () => {
    expect(shouldSkip('x/y.png.status.json', {})).toBe(true);
  });
  it('skips delete actions', () => {
    expect(shouldSkip('x/y.png', { action: 'DeleteObject' })).toBe(true);
  });
  it('does not skip real create events', () => {
    expect(shouldSkip('x/y.png', { action: 'PutObject' })).toBe(false);
  });
});

describe('processMessage', () => {
  it('validates a good GLB and writes a "valid" status sidecar', async () => {
    const bucket = makeBucket({
      'a/model.glb': { bytes: makeGlbBytes(), contentType: 'model/gltf-binary' },
    });
    const out = await processMessage({ object: { key: 'a/model.glb' }, action: 'PutObject' }, bucket);
    expect(out.status).toBe('valid');
    expect(out.kind).toBe('glb');
    const sidecar = JSON.parse(bucket.puts['a/model.glb.status.json']);
    expect(sidecar.status).toBe('valid');
    expect(sidecar.bytes).toBe(20);
  });

  it('marks an empty GLB as "failed" (provider-success-with-no-artifact)', async () => {
    const bucket = makeBucket({
      'a/model.glb': { bytes: new Uint8Array(0), contentType: 'model/gltf-binary' },
    });
    const out = await processMessage({ object: { key: 'a/model.glb' } }, bucket);
    expect(out.status).toBe('failed');
    const sidecar = JSON.parse(bucket.puts['a/model.glb.status.json']);
    expect(sidecar.status).toBe('failed');
    expect(sidecar.reason).toMatch(/too small|empty/);
  });

  it('skips when the object is gone', async () => {
    const bucket = makeBucket({});
    const out = await processMessage({ object: { key: 'a/missing.glb' } }, bucket);
    expect(out.status).toBe('skipped');
    expect(out.reason).toMatch(/not found/);
  });

  it('skips status sidecars without fetching', async () => {
    const bucket = makeBucket();
    const getSpy = vi.spyOn(bucket, 'get');
    const out = await processMessage({ object: { key: 'a/x.png.status.json' } }, bucket);
    expect(out.status).toBe('skipped');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('skips unrecognized message shapes', async () => {
    const out = await processMessage(null, makeBucket());
    expect(out.status).toBe('skipped');
  });
});

describe('queue() consumer handler', () => {
  it('ACKs every message when ASSET_BUCKET is unbound (env guard no-op)', async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await workerDefault.queue({ messages: [{ body: {}, ack, retry }] }, {});
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ACKs a successfully-validated (valid) message', async () => {
    const bucket = makeBucket({
      'a/model.glb': { bytes: makeGlbBytes(), contentType: 'model/gltf-binary' },
    });
    const ack = vi.fn();
    const retry = vi.fn();
    await workerDefault.queue(
      { messages: [{ body: { object: { key: 'a/model.glb' } }, ack, retry }] },
      { ASSET_BUCKET: bucket }
    );
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it('ACKs a "failed"-validation message (failure is recorded, not retried)', async () => {
    const bucket = makeBucket({
      'a/model.glb': { bytes: new Uint8Array(0), contentType: 'model/gltf-binary' },
    });
    const ack = vi.fn();
    const retry = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await workerDefault.queue(
      { messages: [{ body: { object: { key: 'a/model.glb' } }, ack, retry }] },
      { ASSET_BUCKET: bucket }
    );
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('RETRIES on an unexpected R2 error', async () => {
    const bucket = {
      get: vi.fn().mockRejectedValue(new Error('R2 hiccup')),
      put: vi.fn(),
    };
    const ack = vi.fn();
    const retry = vi.fn();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await workerDefault.queue(
      { messages: [{ body: { object: { key: 'a/model.glb' } }, ack, retry }] },
      { ASSET_BUCKET: bucket }
    );
    expect(retry).toHaveBeenCalledTimes(1);
    expect(ack).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
