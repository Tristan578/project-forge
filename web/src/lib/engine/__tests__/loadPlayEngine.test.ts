import { describe, it, expect, beforeEach, vi } from 'vitest';

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

  it('returns the first origin that instantiates and never touches the rest', async () => {
    const { instantiateFromPaths } = await import('../loadPlayEngine');
    const calls: string[] = [];
    const load = vi.fn(async (specifier: string) => {
      calls.push(`glue:${specifier}`);
      return glue(calls);
    });

    await instantiateFromPaths(['https://cdn.test/v1/engine-pkg-webgpu/', '/engine-pkg-webgpu/'], load);

    expect(calls).toEqual([
      'glue:https://cdn.test/v1/engine-pkg-webgpu/forge_engine.js',
      'wasm:https://cdn.test/v1/engine-pkg-webgpu/forge_engine_bg.wasm',
    ]);
  });

  it('falls back to the next origin when the CDN glue fails to import', async () => {
    const { instantiateFromPaths } = await import('../loadPlayEngine');
    const calls: string[] = [];
    const load = vi.fn(async (specifier: string) => {
      calls.push(`glue:${specifier}`);
      if (specifier.startsWith('https://')) throw new Error('403 from CDN');
      return glue(calls);
    });

    const runtime = await instantiateFromPaths(
      ['https://cdn.test/v1/engine-pkg-webgl2/', '/engine-pkg-webgl2/'],
      load,
    );

    expect(runtime).toBeDefined();
    expect(calls).toEqual([
      'glue:https://cdn.test/v1/engine-pkg-webgl2/forge_engine.js',
      'glue:/engine-pkg-webgl2/forge_engine.js',
      'wasm:/engine-pkg-webgl2/forge_engine_bg.wasm',
    ]);
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

    await instantiateFromPaths(['https://cdn.test/v1/engine-pkg-webgpu/', '/engine-pkg-webgpu/'], load);

    expect(calls.at(-1)).toBe('wasm:/engine-pkg-webgpu/forge_engine_bg.wasm');
  });

  it('surfaces the LAST origin\'s failure when every origin fails', async () => {
    const { instantiateFromPaths } = await import('../loadPlayEngine');
    const load = vi.fn(async (specifier: string) => {
      throw new Error(`cannot load ${specifier}`);
    });

    await expect(
      instantiateFromPaths(['https://cdn.test/v1/engine-pkg-webgpu/', '/engine-pkg-webgpu/'], load),
    ).rejects.toThrow('cannot load /engine-pkg-webgpu/forge_engine.js');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('rejects rather than resolving to nothing when given no origins', async () => {
    const { instantiateFromPaths } = await import('../loadPlayEngine');
    await expect(instantiateFromPaths([], vi.fn())).rejects.toThrow('No engine base path');
  });
});
