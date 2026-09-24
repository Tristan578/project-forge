/**
 * Sandboxed-origin script transport (#8700, Option A).
 *
 * Active only when `NEXT_PUBLIC_SCRIPT_ISOLATION === 'sandboxed-origin'` (see
 * `sandboxConfig.ts`). It runs the SAME `scriptWorker.ts` as the default
 * transport, but inside a boundary the browser enforces rather than one this
 * code enumerates:
 *
 *     editor (main thread)              iframe sandbox="allow-scripts"        blob: Worker
 *     useScriptRunner ── MessagePort ──> bootstrap (null origin, meta CSP) ──> scriptWorker
 *                     <── MessagePort ──                                  <──
 *
 * - `sandbox="allow-scripts"` and NOTHING else. Without `allow-same-origin` the
 *   frame gets an opaque origin, so code in it cannot read the app's cookies or
 *   storage (`document.cookie` and `localStorage` are unavailable to it), even
 *   code that escapes every in-realm control. Whether a cookie would ride on a
 *   request FROM the frame is not something this module decides; the CSP below
 *   refuses every request, so no request leaves the frame for any credential
 *   to ride on. Adding `allow-same-origin`
 *   (the usual "make postMessage work" fix) would hand the editor's origin
 *   back and silently reopen #8607. The channel is a pair of `MessagePort`s,
 *   which work across an opaque origin, so there is never a reason to add it.
 * - The frame's CSP (`buildSandboxFrameContentSecurityPolicy`) is delivered IN
 *   the srcdoc as `<meta http-equiv>`. The blob worker inherits it, so
 *   `connect-src 'none'` and a script-src with no network source apply to the
 *   user script itself — `(0).constructor.constructor('return fetch')()` still
 *   reaches a `fetch`, and the browser refuses the request.
 * - `revokeNetworkGlobalsIfWorker()` still runs at worker init. Here it is
 *   belt-and-braces; the frame is the control.
 *
 * ## How the bundled worker gets into a null-origin frame
 *
 * The default transport is `new Worker(new URL('./scriptWorker.ts', ...))`,
 * which the bundler turns into a chunk URL on the app origin plus further
 * chunks it loads at run time. None of that can work here: the frame's origin
 * is opaque and its CSP has no network source, so it can load nothing from the
 * app origin — and widening script-src to allow the app's chunk URLs would open
 * exactly the GET channel this transport exists to close (`import(url)` and
 * `importScripts(url)` are script loads, and a CSP path match ignores the query
 * string, so `chunk.js?data=...` would leave).
 *
 * So the worker is shipped as TEXT. `scriptWorkerSource.bundle.ts` is a
 * placeholder that `web/scripts/sandbox-worker-loader.cjs` replaces at build
 * time (webpack in `next dev`, Turbopack in `next build`) with the whole worker
 * graph bundled by esbuild into one self-contained classic script. The main
 * thread imports that string lazily (it is only in the client bundle behind a
 * dynamic import), hands it to the frame over `postMessage`, and the frame
 * starts it from a `blob:` URL. Nothing is fetched by the frame or the worker,
 * which is what lets the policy stay at `connect-src 'none'` with no script host.
 *
 * ## Browser support — do NOT enable for production users yet
 *
 * Measured, not assumed (CI run 35997735154, head a17c010f,
 * `e2e/tests/script-sandbox-isolation.spec.ts`; the WebKit result re-measured
 * in run 36007182328, job 107658645036, head 8b7869d8, after the spec stopped
 * answering the frame's `blob:` worker load with a fake body: WebKit still
 * reported a boot `worker-error`, so the harness was not the cause):
 *
 * - Chromium and Firefox: scripts RUN through this transport — a normal script
 *   runs end to end, `terminate()` ends a spinning worker, and an escaped
 *   script gets no request out.
 * - WebKit (Safari): scripts do NOT run. Every sandbox test failed there; the
 *   host reported `Script sandbox worker-error: Error: Script error.` (the
 *   sanitised text a browser gives a cross-origin error) and the tests waiting
 *   on the worker never got an answer. A `worker-error` that arrives before
 *   the worker's first message is a `boot` failure below, reason
 *   `worker-error`, so the host FAILS CLOSED: it reports once, removes the
 *   frame and relays nothing, and the runner stops Play and never falls back
 *   to the same-origin transport. The spec's WebKit branch asserts that — one
 *   `boot` failure with reason `worker-error`, nothing relayed, nothing on the
 *   network. Why WebKit refuses the worker has not been diagnosed.
 *
 * The runner shows the creator one of two boot messages, chosen by
 * {@link SandboxBootFailureReason}:
 *
 * - `worker-error` (the browser refused the worker; retrying cannot help):
 *   {@link SCRIPT_SANDBOX_UNSUPPORTED_MESSAGE} — scripts can't run in this
 *   browser with the current editor settings. It offers no retry.
 * - `timeout` or `source-load` (possibly transient):
 *   {@link SCRIPT_SANDBOX_START_FAILED_MESSAGE} — press Play again or reload.
 *
 * So a creator on Safari cannot run their game's scripts at all with the flag
 * on. It must stay off for production users until WebKit support exists.
 *
 * ## What is unchanged
 *
 * The host is a drop-in for the three members of `Worker` the runner uses
 * (`postMessage`, `onmessage`, `terminate`). Messages are relayed verbatim in
 * both directions — the command allowlist, `MAX_COMMANDS_PER_FRAME`, the loop
 * guards, the `AsyncChannelRouter` and delta serialisation see exactly what
 * they see today. Only the transport differs.
 */

import { buildSandboxFrameContentSecurityPolicy } from '@/lib/security/csp';

/** The members of `Worker` that `useScriptRunner` uses, and nothing else. */
export interface ScriptWorkerLike {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
  terminate(): void;
}

/**
 * The frame's sandbox tokens. Exactly one. Tested against the BUILT element in
 * `sandboxOrigin.test.ts`, not against this constant.
 */
const SANDBOX_TOKENS = 'allow-scripts';

/** Envelope types on the control port. Protocol messages never use this port. */
const BOOT_MESSAGE_TYPE = 'spawnforge:script-sandbox:boot';

/**
 * The frame's only script, run under its own CSP by hash.
 *
 * Kept as a plain string (not a function's `toString()`) so a minifier cannot
 * change the bytes the hash below was taken over. It must never contain a
 * closing script tag or a backtick; `sandboxOrigin.test.ts` checks both, and
 * recomputes the hash from these exact bytes.
 *
 * It accepts one boot message, from its parent only, carrying the worker source
 * and two ports: `data` relays protocol messages verbatim in both directions,
 * `control` carries boot/worker errors out and a terminate request in.
 */
export const SANDBOX_BOOTSTRAP = [
  '(function () {',
  "  'use strict';",
  '  var booted = false;',
  "  window.addEventListener('message', function (ev) {",
  '    if (booted || ev.source !== window.parent) return;',
  '    var d = ev.data;',
  "    if (!d || d.type !== '" + BOOT_MESSAGE_TYPE + "' || typeof d.source !== 'string') return;",
  '    if (!ev.ports || ev.ports.length !== 2) return;',
  '    booted = true;',
  '    var data = ev.ports[0];',
  '    var control = ev.ports[1];',
  '    var worker;',
  '    var started = false;',
  '    try {',
  "      var url = URL.createObjectURL(new Blob([d.source], { type: 'text/javascript' }));",
  '      worker = new Worker(url);',
  '      URL.revokeObjectURL(url);',
  '    } catch (err) {',
  "      control.postMessage({ type: 'boot-error', message: String((err && err.message) || err) });",
  '      return;',
  '    }',
  '    worker.onmessage = function (e) { started = true; data.postMessage(e.data); };',
  '    worker.onerror = function (e) {',
  "      control.postMessage({ type: 'worker-error', started: started, message: String((e && e.message) || 'worker error') });",
  '    };',
  '    data.onmessage = function (e) { worker.postMessage(e.data); };',
  '    control.onmessage = function (e) {',
  "      if (e.data && e.data.type === 'terminate') { worker.terminate(); data.close(); control.close(); }",
  '    };',
  "    control.postMessage({ type: 'ready' });",
  '  });',
  '})();',
].join('\n');

/**
 * Base64 SHA-256 of {@link SANDBOX_BOOTSTRAP}. A constant rather than computed
 * at run time so building the frame needs no async crypto (and no secure
 * context); `sandboxOrigin.test.ts` recomputes it from the bootstrap bytes, so
 * an edit to one without the other fails there instead of shipping a frame
 * whose only script its own policy refuses.
 */
export const SANDBOX_BOOTSTRAP_SHA256 = '8Ivzu52QrCh1VZbiDHUnBzJlL6N2OpYAgnPpk6PQovQ=';

/** The complete srcdoc: the policy FIRST (a meta CSP governs only what follows it), then the bootstrap. */
export function buildSandboxFrameSrcdoc(): string {
  const csp = buildSandboxFrameContentSecurityPolicy({ bootstrapSha256: SANDBOX_BOOTSTRAP_SHA256 });
  const cspAttr = csp.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return (
    '<!doctype html><html><head>' +
    `<meta http-equiv="Content-Security-Policy" content="${cspAttr}">` +
    `<script>${SANDBOX_BOOTSTRAP}</script>` +
    '</head><body></body></html>'
  );
}

/** The frame element, not yet attached. Exported so the attribute contract is testable on the real element. */
export function createSandboxFrameElement(doc: Document = document): HTMLIFrameElement {
  const frame = doc.createElement('iframe');
  frame.setAttribute('sandbox', SANDBOX_TOKENS);
  frame.setAttribute('srcdoc', buildSandboxFrameSrcdoc());
  frame.setAttribute('title', 'Game script sandbox');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.style.display = 'none';
  return frame;
}

let workerSourcePromise: Promise<string> | null = null;

/**
 * The bundled worker as text. Loaded once and cached; a failed load is not
 * cached, so the next Play retries. Call it early (the runner does, on mount)
 * so the chunk is in memory before the first tick starts the 5 s watchdog.
 */
export function loadSandboxWorkerSource(): Promise<string> {
  if (!workerSourcePromise) {
    workerSourcePromise = import('./scriptWorkerSource.bundle')
      .then((mod) => {
        const source = mod.default;
        if (typeof source !== 'string' || source.length === 0) {
          throw new Error(
            'The sandboxed script worker was not bundled: scriptWorkerSource.bundle.ts was not ' +
              'rewritten by web/scripts/sandbox-worker-loader.cjs (check next.config.ts).',
          );
        }
        return source;
      })
      .catch((err: unknown) => {
        workerSourcePromise = null;
        throw err;
      });
  }
  return workerSourcePromise;
}

/**
 * `boot`: the scripts never started — the worker source did not load, the frame
 * could not construct the worker, the worker failed before its first message,
 * or the frame did not come up in time. Reported AT MOST ONCE per host, which
 * then terminates itself.
 * `runtime`: an uncaught error in a worker that had already started.
 */
export type SandboxFailurePhase = 'boot' | 'runtime';

/**
 * WHY a `boot` failure happened, in the terms that decide what the creator can
 * do about it. Behaviour-based: it names what the host observed, never a
 * browser.
 *
 * - `worker-error`: the frame came up and then reported that the worker could
 *   not be constructed (`boot-error`) or failed before its first message
 *   (`worker-error`). The browser refused to run the sandboxed worker, and it
 *   will refuse again: pressing Play again or reloading re-runs the same
 *   frame, the same policy and the same bytes. This is what WebKit does today.
 * - `timeout`: nothing was heard within the boot timeout. Possibly transient
 *   (a busy tab, a slow machine), so retrying is honest advice.
 * - `source-load`: the bundled worker text could not be loaded. A failed load
 *   is not cached ({@link loadSandboxWorkerSource}), so the next Play retries
 *   it; retrying is honest advice here too.
 */
export type SandboxBootFailureReason = 'worker-error' | 'timeout' | 'source-load';

/**
 * The arguments of {@link SandboxedScriptHostOptions.onError}. A `boot` report
 * always carries a reason; a `runtime` report never does. A tuple union rather
 * than an optional third parameter, so a handler written as
 * `(...report) => { const [detail, phase, reason] = report; ... }` gets a
 * non-optional `reason` once it has narrowed `phase` to `boot`.
 */
export type SandboxFailureReport =
  | [detail: string, phase: 'boot', reason: SandboxBootFailureReason]
  | [detail: string, phase: 'runtime'];

/**
 * What the script console shows the game creator for a `boot` failure whose
 * reason is `timeout` or `source-load`. The technical detail goes to the
 * devtools: a creator cannot act on a bundling hint or a raw worker error, but
 * can press Play again or reload, and for these two reasons that may help.
 */
export const SCRIPT_SANDBOX_START_FAILED_MESSAGE =
  "Your game's scripts couldn't start. Press Play again, or reload the editor if this keeps happening.";

/**
 * What the script console shows the game creator for a `boot` failure whose
 * reason is `worker-error`: this browser refused to run the sandboxed worker.
 * Retrying and reloading are dead ends there, so this message does not offer
 * them. It names the settings as the cause (the isolation flag is what puts
 * scripts in the sandbox) and suggests, without promising, another browser.
 */
export const SCRIPT_SANDBOX_UNSUPPORTED_MESSAGE =
  "Your game's scripts can't run in this browser with the editor's current settings. " +
  'You could try opening the editor in a different browser.';

/** What the script console shows the game creator for a `runtime` failure. */
export const SCRIPT_SANDBOX_RUNTIME_FAILED_MESSAGE =
  "Your game's scripts ran into an unexpected problem. If your game stops responding, press Play again.";

export interface SandboxedScriptHostOptions {
  /** Defaults to {@link loadSandboxWorkerSource}. */
  loadWorkerSource?: () => Promise<string>;
  /**
   * Boot and uncaught worker errors. Never protocol messages. `detail` is the
   * DEVELOPER account (raw error text, bundling hints): log it to the devtools
   * and show the creator plain words instead — for `boot`, chosen by `reason`
   * ({@link SCRIPT_SANDBOX_UNSUPPORTED_MESSAGE} for `worker-error`,
   * {@link SCRIPT_SANDBOX_START_FAILED_MESSAGE} otherwise); for `runtime`,
   * {@link SCRIPT_SANDBOX_RUNTIME_FAILED_MESSAGE}.
   *
   * REQUIRED, deliberately. A `runtime` report fires once per uncaught worker
   * error for as long as the worker runs (a script can throw from a
   * zero-delay interval), so whoever receives it must bound it —
   * `useScriptRunner` does. A built-in fallback could only log 1:1, which is
   * an unbounded console; there is none, so a new caller has to decide.
   */
  onError: (...report: SandboxFailureReport) => void;
  /** Where the hidden frame is attached. Defaults to `document.body`. */
  container?: HTMLElement;
  /** How long to wait for the frame to report `ready` before calling `onError`. */
  bootTimeoutMs?: number;
}

/**
 * Deliberately SHORTER than `useScriptRunner`'s `WATCHDOG_TIMEOUT_MS`, which is
 * armed on the first play tick (so no earlier than this timer). A frame that
 * never comes up must be reported as what it is — scripts that could not start
 * — before the watchdog can call it a possible infinite loop.
 * `useScriptRunner.test.ts` asserts the ordering by value.
 */
export const SANDBOX_BOOT_TIMEOUT_MS = 4_000;

export interface SandboxedScriptHost extends ScriptWorkerLike {
  /** The frame, once attached; `null` before the source has loaded and after terminate. */
  readonly frame: HTMLIFrameElement | null;
}

/**
 * Start a sandboxed script worker. Returns synchronously; messages posted before
 * the frame is up are queued on the (not yet transferred) port and delivered in
 * order once the worker exists, so the caller can post `init` immediately, as it
 * does with a plain `Worker`.
 */
export function createSandboxedScriptHost(options: SandboxedScriptHostOptions): SandboxedScriptHost {
  const {
    loadWorkerSource = loadSandboxWorkerSource,
    onError,
    container,
    bootTimeoutMs = SANDBOX_BOOT_TIMEOUT_MS,
  } = options;

  const data = new MessageChannel();
  const control = new MessageChannel();
  let frame: HTMLIFrameElement | null = null;
  let terminated = false;
  let bootTimer: ReturnType<typeof setTimeout> | null = null;
  /** The worker has sent at least one protocol message, i.e. its code is running. */
  let started = false;

  const report = (...args: SandboxFailureReport) => {
    if (terminated) return;
    onError(...args);
  };

  const host: SandboxedScriptHost = {
    onmessage: null,
    get frame() {
      return frame;
    },
    postMessage(message: unknown) {
      if (terminated) return;
      data.port1.postMessage(message);
    },
    terminate() {
      if (terminated) return;
      terminated = true;
      if (bootTimer) clearTimeout(bootTimer);
      bootTimer = null;
      try {
        control.port1.postMessage({ type: 'terminate' });
      } catch {
        // Port already closed — nothing left to stop.
      }
      // Removing the frame discards its document, which terminates the worker it
      // owns even if that worker is spinning in an infinite loop and never reads
      // the terminate request above.
      frame?.remove();
      frame = null;
      data.port1.close();
      control.port1.close();
    },
  };

  // A host whose scripts could not start is finished: report once, then
  // terminate. terminate() clears the boot timer and silences every later
  // report, so a load failure is never followed by a timeout for the same
  // frame, and a frame that turns up late is never built.
  const failBoot = (detail: string, reason: SandboxBootFailureReason) => {
    if (terminated) return;
    report(detail, 'boot', reason);
    host.terminate();
  };

  data.port1.onmessage = (event: MessageEvent) => {
    if (terminated) return;
    started = true;
    host.onmessage?.(event);
  };
  control.port1.onmessage = (event: MessageEvent) => {
    const msg = event.data as { type?: unknown; message?: unknown; started?: unknown } | null;
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'ready') {
      if (bootTimer) clearTimeout(bootTimer);
      bootTimer = null;
      return;
    }
    if (msg.type === 'boot-error' || msg.type === 'worker-error') {
      const detail = `Script sandbox ${msg.type}: ${typeof msg.message === 'string' ? msg.message : 'unknown error'}`;
      // A worker error before the worker has said anything (a bundle that does
      // not parse, a throw at module init, a browser that will not run it)
      // means the scripts never started — and, unlike a timeout, will not
      // start on a retry, so it carries the `worker-error` reason. So does a
      // worker the frame could not construct at all. Whether the worker had
      // spoken is the FRAME's to say: it sees both events from one Worker
      // object, while here they arrive on two ports with no ordering between
      // them, so an error can overtake the message that preceded it.
      if (msg.type === 'worker-error' && (started || msg.started === true)) report(detail, 'runtime');
      else failBoot(detail, 'worker-error');
    }
  };

  bootTimer = setTimeout(() => {
    bootTimer = null;
    failBoot(`Script sandbox did not start within ${bootTimeoutMs} ms.`, 'timeout');
  }, bootTimeoutMs);

  loadWorkerSource().then(
    (source) => {
      if (terminated) return;
      const el = createSandboxFrameElement();
      el.addEventListener(
        'load',
        () => {
          if (terminated || !el.contentWindow) return;
          // Target origin '*' is required: the frame's origin is opaque and has
          // no serialisation to name. The payload is the (public) worker source
          // and two ports; the frame's bootstrap only accepts it from its parent.
          el.contentWindow.postMessage({ type: BOOT_MESSAGE_TYPE, source }, '*', [data.port2, control.port2]);
        },
        { once: true },
      );
      frame = el;
      (container ?? document.body).appendChild(el);
    },
    (err: unknown) => {
      failBoot(err instanceof Error ? err.message : String(err), 'source-load');
    },
  );

  return host;
}
