import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Two cases below switch to fake timers; nothing in vitest.setup.ts switches
// back, so without this the describes after them run in an order-dependent
// timer mode.
afterEach(() => {
  vi.useRealTimers();
});

/**
 * The module holds a module-level latch, so every case needs a fresh copy.
 * `vi.resetModules()` + dynamic import is the repo's idiom for that.
 */
async function freshLoader() {
  vi.resetModules();
  const mod = await import('../loadPlayEngine');
  return mod.loadPlayEngine;
}

describe('loadPlayEngine', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('hands concurrent callers the same in-flight load', async () => {
    const loadPlayEngine = await freshLoader();

    const first = loadPlayEngine();
    const second = loadPlayEngine();

    // Identity, not just equivalent results: a second attempt would call
    // wasm-bindgen's `default()` again on the same glue module while the first
    // instantiation is still in flight. This is what makes the caller's retry
    // JOIN the running load instead of racing a rival one against it.
    expect(second).toBe(first);

    // The engine bundle is not resolvable under Vitest — that is the whole
    // reason this module exists as a seam — so both settle as rejections.
    // Swallow them here; the rejection path is asserted below.
    await Promise.allSettled([first, second]);
  });

  it('clears the latch after a failed load so the next call retries', async () => {
    const loadPlayEngine = await freshLoader();

    const first = loadPlayEngine();
    await expect(first).rejects.toBeDefined();

    const second = loadPlayEngine();
    // A failed attempt produced no instance, so it must not be cached as one.
    expect(second).not.toBe(first);

    await expect(second).rejects.toBeDefined();
  });

  it('does not leave the rejection unhandled when nobody retries', async () => {
    const loadPlayEngine = await freshLoader();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    try {
      await expect(loadPlayEngine()).rejects.toBeDefined();
      // The internal `.catch` that clears the latch is a second branch off the
      // same promise; if the caller's branch were the only handled one, or if
      // that internal branch rethrew, this would fire.
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('selectPlayEngineBackend', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('falls back to webgl2 when WebGPU exposes no adapter', async () => {
    const requestAdapter = vi.fn().mockResolvedValue(null);
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    const { selectPlayEngineBackend } = await import('../loadPlayEngine');

    await expect(selectPlayEngineBackend()).resolves.toBe('webgl2');
    expect(requestAdapter).toHaveBeenCalledOnce();
  });

  it('selects webgpu only after obtaining an adapter', async () => {
    const adapter = {};
    const requestAdapter = vi.fn().mockResolvedValue(adapter);
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    const { selectPlayEngineBackend } = await import('../loadPlayEngine');

    await expect(selectPlayEngineBackend()).resolves.toBe('webgpu');
  });

  it('falls back to webgl2 when the adapter request rejects', async () => {
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn().mockRejectedValue(new Error('blocked GPU')) },
    });
    const { selectPlayEngineBackend } = await import('../loadPlayEngine');

    await expect(selectPlayEngineBackend()).resolves.toBe('webgl2');
  });

  it('falls back to webgl2 when the adapter request never settles', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('navigator', {
        gpu: { requestAdapter: vi.fn(() => new Promise(() => {})) },
      });
      const { selectPlayEngineBackend } = await import('../loadPlayEngine');

      const selection = selectPlayEngineBackend();
      await vi.runAllTimersAsync();
      await expect(selection).resolves.toBe('webgl2');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('getPlayEngineBasePaths', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('serves same-origin only when no engine CDN is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', '');
    vi.stubEnv('NEXT_PUBLIC_ENGINE_VERSION', '');
    const { getPlayEngineBasePaths } = await import('../loadPlayEngine');
    expect(getPlayEngineBasePaths('webgpu')).toEqual(['/engine-pkg-webgpu/']);
  });

  it('tries the versioned CDN prefix first, then same-origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', 'https://engine.example.test/');
    vi.stubEnv('NEXT_PUBLIC_ENGINE_VERSION', 'abc1234');
    const { getPlayEngineBasePaths } = await import('../loadPlayEngine');
    expect(getPlayEngineBasePaths('webgl2')).toEqual([
      'https://engine.example.test/abc1234/engine-pkg-webgl2/',
      '/engine-pkg-webgl2/',
    ]);
  });

  it('uses the /latest alias when the CDN is set but no build version is', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', 'https://engine.example.test');
    vi.stubEnv('NEXT_PUBLIC_ENGINE_VERSION', '');
    const { getPlayEngineBasePaths } = await import('../loadPlayEngine');
    expect(getPlayEngineBasePaths('webgpu')[0]).toBe(
      'https://engine.example.test/latest/engine-pkg-webgpu/',
    );
  });

  it('reads the CDN variables as literal process.env members so Next.js can inline them', async () => {
    // Next.js substitutes only the fully-qualified `process.env.NEXT_PUBLIC_*`
    // form into the browser bundle. An aliased read compiles, passes every
    // runtime test (Node sees the real env), and silently drops the CDN path in
    // production — so the source shape is the only place this can be pinned.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../loadPlayEngine.ts', import.meta.url)),
      'utf8',
    );
    expect(src).toMatch(/^\s*const cdnBase = \(process\.env\.NEXT_PUBLIC_ENGINE_CDN_URL/m);
    expect(src).toMatch(/^\s*const version = \(process\.env\.NEXT_PUBLIC_ENGINE_VERSION/m);
  });
});

describe('instantiateFromPaths', () => {
  const CDN = 'https://cdn.test/v1/engine-pkg-webgpu/';
  const SAME = '/engine-pkg-webgpu/';

  function glue(calls: string[]) {
    return {
      default: vi.fn(async (wasmUrl: string) => {
        calls.push(`wasm:${wasmUrl}`);
      }),
      init_engine: vi.fn(),
      handle_command: vi.fn(),
      set_event_callback: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('returns the first origin that instantiates, reports it, and never touches the rest', async () => {
    const { instantiateFromPaths } = await import('../loadPlayEngine');
    const calls: string[] = [];
    const load = vi.fn(async (specifier: string) => {
      calls.push(`glue:${specifier}`);
      return glue(calls);
    });
    const onOriginUsed = vi.fn();
    const onOriginSkipped = vi.fn();

    await instantiateFromPaths([CDN, SAME], { load, onOriginUsed, onOriginSkipped });

    expect(calls).toEqual([`glue:${CDN}forge_engine.js`, `wasm:${CDN}forge_engine_bg.wasm`]);
    expect(onOriginUsed).toHaveBeenCalledWith(CDN);
    expect(onOriginSkipped).not.toHaveBeenCalled();
  });

  it('falls back to the next origin when the CDN glue fails to import, and says so', async () => {
    const { instantiateFromPaths } = await import('../loadPlayEngine');
    const calls: string[] = [];
    const load = vi.fn(async (specifier: string) => {
      calls.push(`glue:${specifier}`);
      if (specifier.startsWith('https://')) throw new Error('403 from CDN');
      return glue(calls);
    });
    const onOriginSkipped = vi.fn();
    const onOriginUsed = vi.fn();

    const runtime = await instantiateFromPaths([CDN, SAME], { load, onOriginSkipped, onOriginUsed });

    expect(runtime).toBeDefined();
    expect(calls).toEqual([
      `glue:${CDN}forge_engine.js`,
      `glue:${SAME}forge_engine.js`,
      `wasm:${SAME}forge_engine_bg.wasm`,
    ]);
    expect(onOriginSkipped).toHaveBeenCalledTimes(1);
    expect(onOriginSkipped).toHaveBeenCalledWith(CDN, expect.objectContaining({ message: '403 from CDN' }));
    expect(onOriginUsed).toHaveBeenCalledWith(SAME);
  });

  it('falls back when the CDN glue imports but its binary fails to instantiate', async () => {
    const { instantiateFromPaths } = await import('../loadPlayEngine');
    const calls: string[] = [];
    const load = vi.fn(async (specifier: string) => {
      calls.push(`glue:${specifier}`);
      const g = glue(calls);
      if (specifier.startsWith('https://')) {
        g.default = vi.fn(async () => { throw new Error('wasm 404'); });
      }
      return g;
    });

    await instantiateFromPaths([CDN, SAME], { load });

    expect(calls.at(-1)).toBe(`wasm:${SAME}forge_engine_bg.wasm`);
  });

  it('falls back when the CDN STALLS, inside the per-origin deadline', async () => {
    vi.useFakeTimers();
    const { instantiateFromPaths } = await import('../loadPlayEngine');
    const calls: string[] = [];
    const load = vi.fn((specifier: string) => {
      calls.push(`glue:${specifier}`);
      // The CDN never answers — a blackholed connection, not a 4xx.
      if (specifier.startsWith('https://')) return new Promise<never>(() => {});
      return Promise.resolve(glue(calls));
    });
    const onOriginSkipped = vi.fn();

    const pending = instantiateFromPaths([CDN, SAME], { load, originTimeoutMs: 1_000, onOriginSkipped });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toBeDefined();
    expect(onOriginSkipped).toHaveBeenCalledWith(
      CDN,
      expect.objectContaining({ message: expect.stringContaining('timed out after 1000ms') }),
    );
    expect(calls.at(-1)).toBe(`wasm:${SAME}forge_engine_bg.wasm`);
  });

  it('does not cut a slow binary download with the glue deadline', async () => {
    vi.useFakeTimers();
    const { instantiateFromPaths } = await import('../loadPlayEngine');
    const calls: string[] = [];
    // The glue arrives at once; the ~23 MiB binary takes five times the
    // per-origin budget. That is a slow link, not a stalled origin, and it
    // must still succeed on the origin it started on.
    const slowGlue = glue(calls);
    let finishBinary: (() => void) | undefined;
    slowGlue.default = vi.fn(
      (wasmUrl: string) => new Promise<void>((resolve) => {
        finishBinary = () => { calls.push(`wasm:${wasmUrl}`); resolve(); };
      }),
    );
    const load = vi.fn(async () => slowGlue);
    const onOriginSkipped = vi.fn();

    const pending = instantiateFromPaths([CDN, SAME], { load, originTimeoutMs: 1_000, onOriginSkipped });
    // Five glue budgets pass while the binary is still downloading...
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onOriginSkipped).not.toHaveBeenCalled();
    // ...and when it lands, the origin it started on is the one that serves.
    finishBinary!();

    await expect(pending).resolves.toBeDefined();
    expect(onOriginSkipped).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([`wasm:${CDN}forge_engine_bg.wasm`]);
  });

  it('labels a deadline by host, never by the versioned path', async () => {
    vi.useFakeTimers();
    const { instantiateFromPaths } = await import('../loadPlayEngine');
    const load = vi.fn(() => new Promise<never>(() => {}));
    const pending = instantiateFromPaths(['https://cdn.test/abc1234/engine-pkg-webgpu/'], { load, originTimeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).rejects.toThrow('Engine glue from cdn.test timed out');
    await expect(pending).rejects.not.toThrow('abc1234');
  });

  it('does not instantiate a CDN glue module that arrives after its deadline', async () => {
    vi.useFakeTimers();
    const { instantiateFromPaths } = await import('../loadPlayEngine');
    const calls: string[] = [];
    const lateCdnGlue = glue(calls);
    let deliverCdn: (() => void) | undefined;
    const load = vi.fn((specifier: string) => {
      if (specifier.startsWith('https://')) {
        return new Promise<typeof lateCdnGlue>((resolve) => { deliverCdn = () => resolve(lateCdnGlue); });
      }
      return Promise.resolve(glue(calls));
    });

    const pending = instantiateFromPaths([CDN, SAME], { load, originTimeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;

    // The CDN glue shows up late. A second wasm-bindgen init here would be a
    // rival WASM instance; the abandoned attempt must not run it.
    deliverCdn!();
    await vi.runAllTimersAsync();
    expect(lateCdnGlue.default).not.toHaveBeenCalled();
  });

  it("surfaces the LAST origin's failure when every origin fails", async () => {
    const { instantiateFromPaths } = await import('../loadPlayEngine');
    const load = vi.fn(async (specifier: string) => {
      throw new Error(`cannot load ${specifier}`);
    });
    const onOriginSkipped = vi.fn();

    await expect(
      instantiateFromPaths([CDN, SAME], { load, onOriginSkipped }),
    ).rejects.toThrow(`cannot load ${SAME}forge_engine.js`);
    expect(load).toHaveBeenCalledTimes(2);
    // Only origins with a successor are "skipped"; the last failure is the error.
    expect(onOriginSkipped).toHaveBeenCalledTimes(1);
  });

  it('rejects rather than resolving to nothing when given no origins', async () => {
    const { instantiateFromPaths } = await import('../loadPlayEngine');
    await expect(instantiateFromPaths([], { load: vi.fn() })).rejects.toThrow('No engine base path');
  });
});

describe('isCdnOrigin / describeOrigin', () => {
  it('tells an absolute http(s) origin from a same-origin path', async () => {
    const { isCdnOrigin, describeOrigin } = await import('../loadPlayEngine');
    expect(isCdnOrigin('https://engine.example.test/abc1234/engine-pkg-webgpu/')).toBe(true);
    expect(isCdnOrigin('http://localhost:8787/latest/engine-pkg-webgl2/')).toBe(true);
    expect(isCdnOrigin('/engine-pkg-webgpu/')).toBe(false);
    expect(describeOrigin('https://engine.example.test/abc1234/engine-pkg-webgpu/')).toBe('engine.example.test');
    expect(describeOrigin('/engine-pkg-webgpu/')).toBe('same-origin');
  });
});

describe('resolveAndInstantiate (env → origins → loader)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('asks the CDN first when it is configured, and falls back to same-origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', 'https://engine.example.test');
    vi.stubEnv('NEXT_PUBLIC_ENGINE_VERSION', 'abc1234');
    // No `gpu` on navigator → webgl2, with no adapter probe to wait on.
    vi.stubGlobal('navigator', {});
    const { resolveAndInstantiate } = await import('../loadPlayEngine');
    const specifiers: string[] = [];
    const load = vi.fn(async (specifier: string) => {
      specifiers.push(specifier);
      if (specifier.startsWith('https://')) throw new Error('cdn down');
      return {
        default: vi.fn(async () => {}),
        init_engine: vi.fn(),
        handle_command: vi.fn(),
        set_event_callback: vi.fn(),
      };
    });

    await resolveAndInstantiate({ load });

    // Reverting instantiate() to the pre-#7580 hardcoded path would fail here.
    expect(specifiers).toEqual([
      'https://engine.example.test/abc1234/engine-pkg-webgl2/forge_engine.js',
      '/engine-pkg-webgl2/forge_engine.js',
    ]);
  });

  it('goes straight to same-origin when no CDN is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', '');
    vi.stubGlobal('navigator', {});
    const { resolveAndInstantiate } = await import('../loadPlayEngine');
    const load = vi.fn(async () => ({
      default: vi.fn(async () => {}),
      init_engine: vi.fn(),
      handle_command: vi.fn(),
      set_event_callback: vi.fn(),
    }));

    await resolveAndInstantiate({ load });

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('/engine-pkg-webgl2/forge_engine.js');
  });
});

describe('parity with the editor resolver', () => {
  // getPlayEngineBasePaths is a copy of useEngine.getWasmBasePaths because the
  // play bundle must not import the editor's engine graph. A test file may
  // import both, so this is what stops the two copies drifting on the CDN
  // layout (/latest vs versioned prefix, path shape).
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    ['cdn + version', 'https://engine.example.test', 'abc1234'],
    ['cdn, no version', 'https://engine.example.test/', ''],
    ['no cdn', '', 'abc1234'],
  ])('matches useEngine.getWasmBasePaths (%s)', async (_label, cdn, version) => {
    vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', cdn);
    vi.stubEnv('NEXT_PUBLIC_ENGINE_VERSION', version);
    const { getPlayEngineBasePaths } = await import('../loadPlayEngine');
    const { getWasmBasePaths } = await import('@/hooks/useEngine');
    for (const backend of ['webgpu', 'webgl2'] as const) {
      expect(getPlayEngineBasePaths(backend)).toEqual(getWasmBasePaths(backend));
    }
  });
});
