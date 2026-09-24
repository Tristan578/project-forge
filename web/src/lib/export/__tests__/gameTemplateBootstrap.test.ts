// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { generateGameHTML } from '../gameTemplate';
import { getDefaultTouchPreset } from '../touchControls';

const scene = { entities: [{ id: 'fixture-entity' }] };
const options = {
  title: 'Bootstrap fixture', bgColor: '#000000', resolution: 'responsive' as const,
  sceneData: JSON.stringify(scene), scriptBundle: '', includeDebug: false,
  projectType: '2d' as const,
  mobileTouchConfig: JSON.stringify({ ...getDefaultTouchPreset('platformer'), enabled: true, autoReduceQuality: true }),
};

/** Execute generated module code; only browser scheduling and WASM imports are replaced. */
async function executeBootstrap(html: string, { failure, armed = true }: { failure?: Error; armed?: boolean } = {}) {
  const page = new DOMParser().parseFromString(html, 'text/html');
  const source = page.querySelector('script[type="module"]')!.textContent!;
  const hooks = {
    initStart: vi.fn(), backend: vi.fn(), wasm: vi.fn(),
    sceneLoad: vi.fn(), fail: vi.fn(), frame: vi.fn(),
  };
  const wasmOutput = { memory: { buffer: { byteLength: 1024 } } };
  const calls: Array<{ command: string; payload: unknown }> = [];
  const order: string[] = [];
  const timers: Array<() => void> = [];
  const frames: Array<() => void> = [];
  const engine = {
    default: vi.fn(async () => { if (failure) throw failure; return wasmOutput; }),
    init_engine: vi.fn(() => { order.push('init'); }),
    handle_command: vi.fn((command: string, payload: unknown) => {
      order.push(command);
      calls.push({ command, payload });
      return { success: true };
    }),
    set_event_callback: vi.fn(),
  };
  const gameWindow = { __forgeSceneData: scene, ...(armed ? { __forgePerfHooks: hooks } : {}) };
  const load = vi.fn(async () => engine);
  // Dynamic import remains awaited and preserves the generated fallback logic.
  const evaluate = new Function(
    '__import', 'window', 'document', 'navigator', 'performance',
    'setTimeout', 'requestAnimationFrame', 'console',
    source.replace(/\bimport\(/g, '__import(') + '\nreturn init;',
  );
  const init = evaluate(
    load, gameWindow, page, { userAgent: 'Android', maxTouchPoints: 1 },
    { now: () => 100 },
    (callback: () => void) => { timers.push(callback); },
    (callback: () => void) => { frames.push(callback); },
    { error: vi.fn(), log: vi.fn() },
  ) as () => Promise<void>;
  await init();
  timers.shift()?.(); // Actual generated autoplay callback.
  frames.shift()?.(); // Actual generated game loop.
  return { hooks, engine, calls, order, wasmOutput, page };
}

function expectSuccessfulBootstrap(result: Awaited<ReturnType<typeof executeBootstrap>>) {
  expect(result.hooks.initStart).toHaveBeenCalledOnce();
  expect(result.hooks.backend).toHaveBeenCalledWith('webgl2');
  expect(result.hooks.wasm).toHaveBeenCalledWith(result.wasmOutput);
  expect(result.hooks.sceneLoad).toHaveBeenCalledWith({ success: true });
  expect(result.hooks.frame).toHaveBeenCalledWith(100);
  expect(result.hooks.fail).not.toHaveBeenCalled();
  expect(result.order).toEqual(['init', 'load_scene', 'set_project_type', 'set_quality', 'play']);
  expect(result.calls).toContainEqual({ command: 'load_scene', payload: { json: JSON.stringify(scene) } });
  expect(result.calls).toContainEqual({ command: 'set_project_type', payload: { projectType: '2d' } });
  expect(result.calls).toContainEqual({ command: 'set_quality', payload: { preset: 'low' } });
  expect(result.page.getElementById('loading')!.classList.contains('hidden')).toBe(true);
}

describe('generated export bootstrap integration', () => {
  it('executes the hook calls and real scene helper in startup order', async () => {
    const result = await executeBootstrap(generateGameHTML(options));
    expect(result.engine.init_engine).toHaveBeenCalledWith('game-canvas');
    expectSuccessfulBootstrap(result);
  });

  it.each(['initStart()', 'backend(variant)', 'wasm(wasmExports)', 'sceneLoad(sceneLoad)', 'frame(now)'])(
    'rejects a commented-out executable hook: %s', async (hook) => {
      const call = 'if (window.__forgePerfHooks) window.__forgePerfHooks.' + hook + ';';
      const html = generateGameHTML(options);
      expect(html).toContain(call);
      const mutated = html.replace(call, '// ' + call);
      const result = await executeBootstrap(mutated);
      expect(() => expectSuccessfulBootstrap(result)).toThrow();
    },
  );

  it('forwards initialization failure to the harness and user-visible error', async () => {
    const failure = new Error('WASM failed');
    const result = await executeBootstrap(generateGameHTML(options), { failure });
    expect(result.hooks.fail).toHaveBeenCalledWith(failure);
    expect(result.page.querySelector('#loading p')!.textContent).toContain('WASM failed');
    expect(result.calls).toEqual([]);
  });

  it('detects a commented-out failure hook', async () => {
    const call = 'if (window.__forgePerfHooks) window.__forgePerfHooks.fail(err);';
    const failure = new Error('WASM failed');
    const result = await executeBootstrap(generateGameHTML(options).replace(call, '// ' + call), { failure });
    expect(() => expect(result.hooks.fail).toHaveBeenCalledWith(failure)).toThrow();
  });

  it('initializes an ordinary uninstrumented game without requiring hooks', async () => {
    const result = await executeBootstrap(generateGameHTML(options), { armed: false });
    expect(result.order).toEqual(['init', 'load_scene', 'set_project_type', 'set_quality', 'play']);
    expect(result.page.getElementById('loading')!.classList.contains('hidden')).toBe(true);
  });
});
