/**
 * The exported-runtime performance harness (#10013, operation
 * performance.FR-3.OP-01). The fragment is plain JS emitted into every exported
 * game; these tests run the emitted source against fake browser globals.
 *
 * Contract: dormant unless armed (`?forgePerf=1` or a preset
 * `window.__forgePerfConfig`); once armed it records raw frame timestamps from
 * the first game-loop frame until warm-up + capture have elapsed, marks first
 * interactive, and on completion collects the environment and fires
 * `forge:perf-capture-complete`.
 */
import { describe, it, expect, vi } from 'vitest';
import { generatePerfHarnessBootstrap } from '../perfHarnessFragment';

interface FakeEnv {
  window: Record<string, unknown> & {
    __forgePerf?: Record<string, unknown> & { frameTimestampsMs: number[] };
    __forgePerfHooks?: Record<string, (...args: unknown[]) => void>;
  };
  events: string[];
  marks: string[];
  setVisibility: (v: 'visible' | 'hidden') => void;
}

function run(search: string, extra: Record<string, unknown> = {}): FakeEnv {
  const events: string[] = [];
  const marks: string[] = [];
  const listeners: Record<string, Array<() => void>> = {};
  const doc = {
    visibilityState: 'visible',
    addEventListener: (type: string, fn: () => void) => {
      (listeners[type] ??= []).push(fn);
    },
    createElement: () => ({ getContext: () => null }),
  };
  const win: FakeEnv['window'] = {
    location: { search },
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    dispatchEvent: (e: { type: string }) => {
      events.push(e.type);
      return true;
    },
    ...extra,
  };
  const perf = {
    now: () => 0,
    mark: (name: string) => marks.push(name),
    memory: { usedJSHeapSize: 64 * 1048576, jsHeapSizeLimit: 4096 * 1048576 },
    getEntriesByType: () => [
      { name: 'http://x/engine-pkg-webgpu-runtime/forge_engine_bg.wasm', transferSize: 900, encodedBodySize: 800, decodedBodySize: 800 },
      { name: 'http://x/app.js', transferSize: 1, encodedBodySize: 1, decodedBodySize: 1 },
    ],
  };
  const nav = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/153.0.0.0 Safari/537.36',
    deviceMemory: 8,
    userAgentData: {
      getHighEntropyValues: async () => ({ fullVersionList: [{ brand: 'Google Chrome', version: '153.0.8010.53' }] }),
    },
    gpu: { requestAdapter: async () => ({ info: { vendor: 'nvidia', architecture: 'turing', device: '', description: '' } }) },
  };
  class FakeEvent {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  }
  const fn = new Function(
    'window', 'document', 'navigator', 'performance', 'URLSearchParams', 'CustomEvent', 'innerWidth', 'innerHeight', 'devicePixelRatio',
    generatePerfHarnessBootstrap(),
  );
  fn(win, doc, nav, perf, URLSearchParams, FakeEvent, 1280, 720, 1);
  return {
    window: win,
    events,
    marks,
    setVisibility: (v) => {
      doc.visibilityState = v;
      (listeners.visibilitychange ?? []).forEach((l) => l());
    },
  };
}

describe('generatePerfHarnessBootstrap', () => {
  it('is dormant in a normal exported game: no hooks, no state', () => {
    const env = run('');
    expect(env.window.__forgePerf).toBeUndefined();
    expect(env.window.__forgePerfHooks).toBeUndefined();
  });

  it('arms from ?forgePerf=1 with the default 10 s + 60 s protocol', () => {
    const env = run('?forgePerf=1');
    expect(env.window.__forgePerf?.protocol).toEqual({ warmupMs: 10000, captureMs: 60000 });
    expect(env.window.__forgePerf?.status).toBe('armed');
  });

  it('accepts bounded protocol overrides and ignores invalid ones', () => {
    expect(run('?forgePerf=1&forgePerfWarmupMs=500&forgePerfCaptureMs=2000').window.__forgePerf?.protocol).toEqual({
      warmupMs: 500,
      captureMs: 2000,
    });
    expect(run('?forgePerf=1&forgePerfWarmupMs=-1&forgePerfCaptureMs=abc').window.__forgePerf?.protocol).toEqual({
      warmupMs: 10000,
      captureMs: 60000,
    });
  });

  it('arms from a preset window.__forgePerfConfig', () => {
    const env = run('', { __forgePerfConfig: { warmupMs: 0, captureMs: 1000 } });
    expect(env.window.__forgePerf?.protocol).toEqual({ warmupMs: 0, captureMs: 1000 });
  });

  it('records from the first game-loop frame until warm-up + capture elapse, then collects the environment', async () => {
    const env = run('?forgePerf=1&forgePerfWarmupMs=100&forgePerfCaptureMs=1000');
    const hooks = env.window.__forgePerfHooks!;
    hooks.initStart();
    hooks.backend('webgpu');
    hooks.wasm({ memory: { buffer: { byteLength: 32 * 1048576 } } });
    hooks.sceneLoad({ success: true });
    for (let t = 2000; t <= 3200; t += 10) hooks.frame(t);
    const state = env.window.__forgePerf!;
    expect(state.firstFrameMs).toBe(2000);
    expect(env.marks).toEqual(['forge:first-interactive']);
    // 2000..3100 inclusive closes the window; later frames are ignored.
    expect(state.frameTimestampsMs[0]).toBe(2000);
    expect(state.frameTimestampsMs[state.frameTimestampsMs.length - 1]).toBe(3100);
    // Environment collection awaits client hints and the GPU adapter.
    await vi.waitFor(() => expect(state.status).toBe('complete'));
    expect(env.events).toEqual(['forge:perf-capture-complete']);
    expect(state.env).toMatchObject({
      userAgent: expect.stringContaining('Chrome/153'),
      deviceMemory: 8,
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      memory: { usedJSHeapSize: 64 * 1048576, jsHeapSizeLimit: 4096 * 1048576 },
      wasmMemoryBytes: 32 * 1048576,
      fullVersionList: [{ brand: 'Google Chrome', version: '153.0.8010.53' }],
      gpu: { vendor: 'nvidia', architecture: 'turing', device: '', description: '' },
    });
    // Only the engine binaries' resource timing is kept.
    expect((state.env as { resources: unknown[] }).resources).toEqual([
      { name: 'http://x/engine-pkg-webgpu-runtime/forge_engine_bg.wasm', transferSize: 900, encodedBodySize: 800, decodedBodySize: 800 },
    ]);
    expect(state.backend).toBe('webgpu');
    // Normalised: a structured-clone-safe record of the engine's answer.
    expect(state.sceneLoad).toEqual({ success: true, error: null });
  });

  it('notes a hidden page during recording', () => {
    const env = run('?forgePerf=1&forgePerfWarmupMs=0&forgePerfCaptureMs=1000');
    env.window.__forgePerfHooks!.frame(0);
    env.setVisibility('hidden');
    expect(env.window.__forgePerf?.hiddenDuringCapture).toBe(true);
  });

  it('drops a timestamp that goes backwards', () => {
    const env = run('?forgePerf=1&forgePerfWarmupMs=0&forgePerfCaptureMs=1000');
    const hooks = env.window.__forgePerfHooks!;
    hooks.frame(100);
    hooks.frame(90);
    hooks.frame(110);
    expect(env.window.__forgePerf?.frameTimestampsMs).toEqual([100, 110]);
  });

  it('records a failure and announces completion so a waiting harness does not hang', () => {
    const env = run('?forgePerf=1');
    env.window.__forgePerfHooks!.fail(new Error('Scene failed to load: nope'));
    expect(env.window.__forgePerf?.status).toBe('failed');
    expect(env.window.__forgePerf?.error).toBe('Scene failed to load: nope');
    expect(env.events).toEqual(['forge:perf-capture-complete']);
    // A failed run records nothing further.
    env.window.__forgePerfHooks!.frame(5);
    expect(env.window.__forgePerf?.frameTimestampsMs).toEqual([]);
  });

  it('never throws out of a hook, even with hostile inputs', () => {
    const env = run('?forgePerf=1');
    const hooks = env.window.__forgePerfHooks!;
    expect(() => hooks.wasm(null)).not.toThrow();
    expect(() => hooks.frame(Number.NaN)).not.toThrow();
    expect(env.window.__forgePerf?.frameTimestampsMs).toEqual([]);
  });
});
