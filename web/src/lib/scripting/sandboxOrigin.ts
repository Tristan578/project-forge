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
 *   frame gets an opaque origin: no cookies, no storage, no Clerk session, even
 *   for code that escapes every in-realm control. Adding `allow-same-origin`
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
  '    try {',
  "      var url = URL.createObjectURL(new Blob([d.source], { type: 'text/javascript' }));",
  '      worker = new Worker(url);',
  '      URL.revokeObjectURL(url);',
  '    } catch (err) {',
  "      control.postMessage({ type: 'boot-error', message: String((err && err.message) || err) });",
  '      return;',
  '    }',
  '    worker.onmessage = function (e) { data.postMessage(e.data); };',
  '    worker.onerror = function (e) {',
  "      control.postMessage({ type: 'worker-error', message: String((e && e.message) || 'worker error') });",
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
export const SANDBOX_BOOTSTRAP_SHA256 = 'VRk54nRLOZan0qlEJAhyPTP20hyyCeXM+FtlOVgc/64=';

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

export interface SandboxedScriptHostOptions {
  /** Defaults to {@link loadSandboxWorkerSource}. */
  loadWorkerSource?: () => Promise<string>;
  /** Boot and uncaught worker errors. Never protocol messages. */
  onError?: (message: string) => void;
  /** Where the hidden frame is attached. Defaults to `document.body`. */
  container?: HTMLElement;
  /** How long to wait for the frame to report `ready` before calling `onError`. */
  bootTimeoutMs?: number;
}

export const SANDBOX_BOOT_TIMEOUT_MS = 10_000;

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
export function createSandboxedScriptHost(options: SandboxedScriptHostOptions = {}): SandboxedScriptHost {
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

  const report = (message: string) => {
    if (terminated) return;
    if (onError) onError(message);
    else console.error(`[ScriptSandbox] ${message}`);
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

  data.port1.onmessage = (event: MessageEvent) => {
    if (terminated) return;
    host.onmessage?.(event);
  };
  control.port1.onmessage = (event: MessageEvent) => {
    const msg = event.data as { type?: unknown; message?: unknown } | null;
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'ready') {
      if (bootTimer) clearTimeout(bootTimer);
      bootTimer = null;
      return;
    }
    if (msg.type === 'boot-error' || msg.type === 'worker-error') {
      report(`Script sandbox ${msg.type}: ${typeof msg.message === 'string' ? msg.message : 'unknown error'}`);
    }
  };

  bootTimer = setTimeout(() => {
    bootTimer = null;
    report(`Script sandbox did not start within ${bootTimeoutMs} ms.`);
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
      report(err instanceof Error ? err.message : String(err));
    },
  );

  return host;
}
