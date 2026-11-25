import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startPerfCaptureServer, type PerfCaptureServer } from '../../perf/perfCaptureServer';

let server: PerfCaptureServer | undefined;
let directory: string | undefined;
afterEach(async () => {
  await server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('performance fixture loopback server', () => {
  it('rejects malformed URL encoding and continues serving the fixture and binary', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'forge-perf-server-'));
    await mkdir(path.join(directory, 'engine-pkg-webgpu'));
    await writeFile(path.join(directory, 'engine-pkg-webgpu', 'test.wasm'), 'test-binary');
    server = await startPerfCaptureServer(directory, ['engine-pkg-webgpu']);
    server.setPage('<!doctype html><title>fixture</title>');
    expect((await fetch(server.origin + '/%')).status).toBe(400);
    expect(await fetch(server.origin + '/index.html').then((r) => r.text())).toContain('<title>fixture</title>');
    const binary = await fetch(server.origin + '/engine-pkg-webgpu/test.wasm');
    expect(binary.status).toBe(200);
    expect(binary.headers.get('content-type')).toBe('application/wasm');
    expect(await binary.text()).toBe('test-binary');
    expect((await fetch(server.origin + '/unlisted/test.wasm')).status).toBe(404);
  });
});
