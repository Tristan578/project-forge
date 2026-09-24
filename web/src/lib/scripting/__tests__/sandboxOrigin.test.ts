// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SANDBOX_BOOTSTRAP,
  SANDBOX_BOOTSTRAP_SHA256,
  buildSandboxFrameSrcdoc,
  createSandboxFrameElement,
  createSandboxedScriptHost,
  loadSandboxWorkerSource,
  type SandboxedScriptHost,
  type SandboxedScriptHostOptions,
} from '../sandboxOrigin';
import { buildSandboxFrameContentSecurityPolicy } from '@/lib/security/csp';

/*
 * The browser-enforced half of this boundary (null origin, CSP inherited by the
 * blob worker, no request leaving the page) cannot be observed in jsdom — jsdom
 * enforces neither `sandbox` nor CSP. That half is proven in a real Chromium by
 * e2e/tests/script-sandbox-isolation.spec.ts. What is asserted here is the
 * CONFIGURATION the browser acts on, read back off the element this module
 * builds, plus the relay logic, run for real: the bootstrap string below is the
 * one that ships, executed in a vm realm against a fake Worker, over real
 * MessageChannels.
 */

function sandboxTokens(frame: HTMLIFrameElement): string[] {
  return (frame.getAttribute('sandbox') ?? '').split(/\s+/).filter(Boolean);
}

/** The srcdoc the element carries, parsed the way a browser would. */
function parseSrcdoc(frame: HTMLIFrameElement) {
  const srcdoc = frame.getAttribute('srcdoc');
  expect(srcdoc).toBeTruthy();
  const doc = new DOMParser().parseFromString(srcdoc as string, 'text/html');
  const meta = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
  const scripts = Array.from(doc.querySelectorAll('script'));
  expect(meta).not.toBeNull();
  const directives = new Map<string, string[]>();
  for (const part of (meta?.getAttribute('content') ?? '').split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), values);
  }
  return { doc, meta: meta as HTMLMetaElement, scripts, directives };
}

// --- a fake frame realm running the REAL bootstrap -------------------------

class FakeWorker {
  static created: FakeWorker[] = [];
  static throwOnConstruct = false;
  posted: unknown[] = [];
  terminated = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  constructor(public url: string) {
    if (FakeWorker.throwOnConstruct) throw new Error('Worker blocked by policy');
    FakeWorker.created.push(this);
  }
  postMessage(message: unknown) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data });
  }
}

interface FakeFrame {
  contentWindow: { postMessage: ReturnType<typeof vi.fn> };
  parentWindow: object;
  deliver: (event: { source: unknown; data: unknown; ports: unknown[] }) => void;
  blobs: Map<string, Blob>;
  revoked: string[];
}

const openPorts: MessagePort[] = [];

/**
 * A frame-side data port whose outgoing messages are held until release(), so
 * a test can make the control port's message reach the host first. Two
 * MessagePorts have no ordering guarantee between them, so the host must not
 * depend on one; this forces the order the spec allows.
 */
interface HeldDataPort {
  release: () => void;
  /** Hold the control port instead of the data port. */
  control?: boolean;
}

/** Run SANDBOX_BOOTSTRAP in its own realm, as the srcdoc frame would. */
function bootFakeFrame(frameOptions: { holdData?: HeldDataPort } = {}): FakeFrame {
  const listeners: Array<(event: unknown) => void> = [];
  const parentWindow = {};
  const blobs = new Map<string, Blob>();
  const revoked: string[] = [];
  const frameGlobals = {
    window: {
      parent: parentWindow,
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        if (type === 'message') listeners.push(fn);
      },
    },
    URL: {
      createObjectURL: (blob: Blob) => {
        const url = `blob:null/${blobs.size}`;
        blobs.set(url, blob);
        return url;
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    },
    Blob,
    Worker: FakeWorker,
  };
  vm.runInNewContext(SANDBOX_BOOTSTRAP, frameGlobals);
  expect(listeners).toHaveLength(1);
  const deliver = (event: { source: unknown; data: unknown; ports: unknown[] }) => {
    for (const port of event.ports) openPorts.push(port as MessagePort);
    let ports = event.ports;
    if (frameOptions.holdData && ports.length === 2) {
      const which = frameOptions.holdData.control ? 1 : 0;
      const real = ports[which] as MessagePort;
      const held: unknown[] = [];
      const proxy = {
        postMessage: (message: unknown) => held.push(message),
        close: () => real.close(),
        set onmessage(fn: ((e: MessageEvent) => void) | null) {
          real.onmessage = fn;
        },
      };
      frameOptions.holdData.release = () => {
        for (const message of held.splice(0)) real.postMessage(message);
      };
      ports = which === 0 ? [proxy, ports[1]] : [ports[0], proxy];
    }
    for (const listener of listeners) listener({ ...event, ports });
  };
  const contentWindow = {
    postMessage: vi.fn((data: unknown, _targetOrigin: string, transfer: unknown[] = []) => {
      deliver({ source: parentWindow, data, ports: transfer });
    }),
  };
  return { contentWindow, parentWindow, deliver, blobs, revoked };
}

/**
 * Failure reports from hosts whose test did not ask for them. `onError` is a
 * required option (an unbounded fallback logger is exactly what it replaced),
 * so every host here gets one; a report nobody expected fails the test in
 * afterEach instead of vanishing into a no-op spy.
 */
let unexpectedReports: string[] = [];
const unexpectedReport: SandboxedScriptHostOptions['onError'] = (...report) => {
  const [detail, phase, reason] = report;
  unexpectedReports.push(`${phase}${reason ? ` (${reason})` : ''}: ${detail}`);
};

/** Start a host whose frame is the fake realm above. */
async function startHost(
  options: Partial<SandboxedScriptHostOptions> = {},
  frameOptions: { holdData?: HeldDataPort } = {},
) {
  const frame = bootFakeFrame(frameOptions);
  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(
    frame.contentWindow as unknown as Window,
  );
  const container = document.createElement('div');
  document.body.appendChild(container);
  const host = createSandboxedScriptHost({
    loadWorkerSource: async () => 'WORKER_SOURCE_TEXT',
    container,
    onError: unexpectedReport,
    ...options,
  });
  await vi.waitFor(() => expect(host.frame).not.toBeNull());
  host.frame?.dispatchEvent(new Event('load'));
  return { host, frame, container };
}

let hosts: SandboxedScriptHost[] = [];

beforeEach(() => {
  FakeWorker.created = [];
  FakeWorker.throwOnConstruct = false;
  hosts = [];
  unexpectedReports = [];
});

afterEach(() => {
  for (const host of hosts) host.terminate();
  expect(unexpectedReports).toEqual([]);
  for (const port of openPorts.splice(0)) port.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('sandbox frame element', () => {
  it('carries exactly one sandbox token, allow-scripts — never allow-same-origin', () => {
    const frame = createSandboxFrameElement(document);
    expect(sandboxTokens(frame)).toEqual(['allow-scripts']);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('the frame the HOST attaches has the same single token (not only the factory output)', async () => {
    const { host, container } = await startHost();
    hosts.push(host);
    const attached = container.querySelector('iframe');
    expect(attached).not.toBeNull();
    expect(attached).toBe(host.frame);
    expect(sandboxTokens(attached as HTMLIFrameElement)).toEqual(['allow-scripts']);
    expect((attached as HTMLIFrameElement).style.display).toBe('none');
  });

  it('delivers its CSP inside the srcdoc, as a meta tag BEFORE the only script', () => {
    const { doc, meta, scripts, directives } = parseSrcdoc(createSandboxFrameElement(document));
    expect(scripts).toHaveLength(1);
    // A meta CSP governs only what the parser meets after it.
    expect(meta.compareDocumentPosition(scripts[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(doc.head.firstElementChild).toBe(meta);
    expect(directives.get('default-src')).toEqual(["'none'"]);
    expect(directives.get('connect-src')).toEqual(["'none'"]);
    expect(directives.get('worker-src')).toEqual(['blob:']);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(directives.get('form-action')).toEqual(["'none'"]);
  });

  it("script-src admits only the bootstrap's hash and 'unsafe-eval' — no host, 'self', blob: or inline", () => {
    const { scripts, directives } = parseSrcdoc(createSandboxFrameElement(document));
    const scriptText = scripts[0].textContent ?? '';
    // The hash is recomputed from the bytes the frame will actually parse.
    const hash = createHash('sha256').update(scriptText, 'utf8').digest('base64');
    expect(directives.get('script-src')).toEqual([`'sha256-${hash}'`, "'unsafe-eval'"]);
    expect(scriptText).toBe(SANDBOX_BOOTSTRAP);
    expect(SANDBOX_BOOTSTRAP_SHA256).toBe(hash);
  });

  it('the bootstrap can be embedded verbatim: no closing script tag, no backtick', () => {
    expect(SANDBOX_BOOTSTRAP).not.toMatch(/<\/script/i);
    expect(SANDBOX_BOOTSTRAP).not.toContain('`');
    // Any casing and any attributes: HTML tag names are case-insensitive, so
    // `<SCRIPT src=...>` would be a second script the hash does not cover.
    expect(buildSandboxFrameSrcdoc().match(/<script\b/gi)).toHaveLength(1);
  });

  it('the CSP builder refuses a hash it cannot interpolate safely', () => {
    expect(() => buildSandboxFrameContentSecurityPolicy({ bootstrapSha256: "x'; script-src *" })).toThrow();
    expect(() => buildSandboxFrameContentSecurityPolicy({ bootstrapSha256: '' })).toThrow();
  });
});

describe('MessagePort relay', () => {
  it('boots the worker from a blob of the loaded source, posted to the frame with two ports', async () => {
    const { host, frame } = await startHost();
    hosts.push(host);
    await vi.waitFor(() => expect(FakeWorker.created).toHaveLength(1));
    expect(frame.contentWindow.postMessage).toHaveBeenCalledTimes(1);
    const [payload, targetOrigin, transfer] = frame.contentWindow.postMessage.mock.calls[0];
    // The frame's origin is opaque, so '*' is the only expressible target.
    expect(targetOrigin).toBe('*');
    expect(transfer).toHaveLength(2);
    expect((payload as { source: string }).source).toBe('WORKER_SOURCE_TEXT');
    const worker = FakeWorker.created[0];
    expect(worker.url).toMatch(/^blob:/);
    expect(await (frame.blobs.get(worker.url) as Blob).text()).toBe('WORKER_SOURCE_TEXT');
    expect(frame.revoked).toEqual([worker.url]);
  });

  it('forwards main -> worker verbatim and in order, including messages posted before boot', async () => {
    const frame = bootFakeFrame();
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(
      frame.contentWindow as unknown as Window,
    );
    let release: (source: string) => void = () => {};
    const host = createSandboxedScriptHost({
      loadWorkerSource: () => new Promise<string>((resolve) => (release = resolve)),
      onError: unexpectedReport,
    });
    hosts.push(host);
    // Posted synchronously, exactly as useScriptRunner posts init + scene_info.
    const init = { type: 'init', scripts: [{ entityId: 'e1', source: 'x', enabled: true }], entities: {} };
    const sceneInfo = { type: 'scene_info', currentScene: 'Main', allSceneNames: ['Main'] };
    host.postMessage(init);
    host.postMessage(sceneInfo);
    release('SRC');
    await vi.waitFor(() => expect(host.frame).not.toBeNull());
    host.frame?.dispatchEvent(new Event('load'));
    await vi.waitFor(() => expect(FakeWorker.created[0]?.posted).toHaveLength(2));
    const worker = FakeWorker.created[0];
    const tick = { type: 'tick', dt: 0.016, elapsed: 1, asyncResponses: [{ id: 'a', ok: true }] };
    host.postMessage(tick);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(3));
    expect(worker.posted).toEqual([init, sceneInfo, tick]);
  });

  it('forwards worker -> main verbatim through onmessage', async () => {
    const { host } = await startHost();
    hosts.push(host);
    const received: unknown[] = [];
    host.onmessage = (event) => received.push(event.data);
    await vi.waitFor(() => expect(FakeWorker.created).toHaveLength(1));
    const commands = { type: 'commands', commands: [{ cmd: 'update_transform', entityId: 'e1', position: [1, 2, 3] }] };
    const log = { type: 'log', level: 'info', entityId: 'e1', message: 'hi' };
    FakeWorker.created[0].emit(commands);
    FakeWorker.created[0].emit(log);
    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received).toEqual([commands, log]);
  });

  it('terminate removes the frame and stops traffic in both directions', async () => {
    const { host, container } = await startHost();
    const received: unknown[] = [];
    host.onmessage = (event) => received.push(event.data);
    await vi.waitFor(() => expect(FakeWorker.created).toHaveLength(1));
    const worker = FakeWorker.created[0];
    host.postMessage({ type: 'tick', n: 1 });
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));

    host.terminate();

    expect(container.querySelector('iframe')).toBeNull();
    expect(host.frame).toBeNull();
    host.postMessage({ type: 'tick', n: 2 });
    worker.emit({ type: 'commands', commands: [] });
    // Prove the relay is still live on the frame side, so "nothing arrived" is
    // an effect of terminate and not of a relay that had already stopped.
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
    expect(worker.posted).toEqual([{ type: 'tick', n: 1 }]);
    expect(received).toEqual([]);
    expect(() => host.terminate()).not.toThrow();
  });

  it('the bootstrap ignores boot messages that are not from its parent, malformed, or repeated', async () => {
    const frame = bootFakeFrame();
    const ports = () => {
      const a = new MessageChannel();
      const b = new MessageChannel();
      openPorts.push(a.port1, b.port1);
      return [a.port2, b.port2];
    };
    const boot = { type: 'spawnforge:script-sandbox:boot', source: 'S' };
    frame.deliver({ source: {}, data: boot, ports: ports() }); // not the parent
    frame.deliver({ source: frame.parentWindow, data: { ...boot, type: 'other' }, ports: ports() });
    frame.deliver({ source: frame.parentWindow, data: { ...boot, source: 42 }, ports: ports() });
    frame.deliver({ source: frame.parentWindow, data: boot, ports: ports().slice(0, 1) });
    expect(FakeWorker.created).toHaveLength(0);
    frame.deliver({ source: frame.parentWindow, data: boot, ports: ports() });
    frame.deliver({ source: frame.parentWindow, data: boot, ports: ports() }); // second boot
    expect(FakeWorker.created).toHaveLength(1);
  });
});

describe('failure reporting', () => {
  it('reports a worker source that fails to load', async () => {
    const onError = vi.fn();
    hosts.push(createSandboxedScriptHost({ loadWorkerSource: () => Promise.reject(new Error('chunk 404')), onError }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('chunk 404', 'boot', 'source-load'));
  });

  it('refuses the unbundled placeholder loudly instead of starting an empty worker', async () => {
    // Vitest does not run the build-time loader, so this is the placeholder ''.
    await expect(loadSandboxWorkerSource()).rejects.toThrow(/was not bundled/);
    const onError = vi.fn();
    hosts.push(createSandboxedScriptHost({ onError }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/was not bundled/), 'boot', 'source-load'));
  });

  it('reports a worker the frame could not construct, and an uncaught worker error', async () => {
    FakeWorker.throwOnConstruct = true;
    const onError = vi.fn();
    // Not startHost(): a host that fails to boot removes its frame, and jsdom
    // fires the frame's load event by itself, so the frame can come and go
    // before startHost's wait for it. Dispatch load (once-only) while waiting.
    const frame1 = bootFakeFrame();
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(
      frame1.contentWindow as unknown as Window,
    );
    const container1 = document.createElement('div');
    document.body.appendChild(container1);
    const first = createSandboxedScriptHost({ loadWorkerSource: async () => 'WORKER_SOURCE_TEXT', container: container1, onError });
    hosts.push(first);
    await vi.waitFor(() => {
      first.frame?.dispatchEvent(new Event('load'));
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(/boot-error: Worker blocked by policy/), 'boot', 'worker-error');
    });
    expect(frame1.contentWindow.postMessage).toHaveBeenCalledTimes(1);
    // A host that could not start is finished: its frame is gone.
    expect(first.frame).toBeNull();
    expect(container1.querySelector('iframe')).toBeNull();

    FakeWorker.throwOnConstruct = false;
    vi.restoreAllMocks();
    const onError2 = vi.fn();
    const second = await startHost({ onError: onError2 });
    hosts.push(second.host);
    await vi.waitFor(() => expect(FakeWorker.created).toHaveLength(1));
    FakeWorker.created[0].onerror?.({ message: 'SyntaxError: bad bundle' });
    // Before the worker has said anything: its code never ran, so this is a
    // failure to START, not an error in a running game.
    await vi.waitFor(() => expect(onError2).toHaveBeenCalledWith(expect.stringMatching(/worker-error: SyntaxError: bad bundle/), 'boot', 'worker-error'));
  });

  it("WebKit's shape — 'ready', then an uncaught error before the first message — fails CLOSED as a boot failure, reason 'worker-error'", async () => {
    // What CI run 35997735154 recorded in WebKit: the frame constructed the
    // worker (so the bootstrap said 'ready' and the boot timer was cleared),
    // then the worker reported the sanitised "Script error." without ever
    // posting a message. The scripts never ran; the host must say so ONCE and
    // tear itself down, never relay anything, and never report again.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onError = vi.fn();
    const { host, container } = await startHost({ onError, bootTimeoutMs: 1000 });
    const received: unknown[] = [];
    host.onmessage = (event) => received.push(event.data);
    await vi.waitFor(() => expect(FakeWorker.created).toHaveLength(1));
    // 'ready' arrived: the boot timer is gone, so ONLY the error can report.
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(0));
    const worker = FakeWorker.created[0];

    worker.onerror?.({ message: 'Error: Script error.' });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith('Script sandbox worker-error: Error: Script error.', 'boot', 'worker-error');
    expect(host.frame).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    // Finished: nothing further is relayed or reported, however long we wait.
    host.postMessage({ type: 'tick', n: 1 });
    worker.emit({ type: 'commands', commands: [] });
    worker.onerror?.({ message: 'Error: Script error.' });
    vi.advanceTimersByTime(10_000);
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
    expect(worker.posted).toEqual([]);
    expect(received).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('an uncaught error in a worker that has STARTED is a runtime failure, not a boot failure', async () => {
    const onError = vi.fn();
    const { host } = await startHost({ onError });
    hosts.push(host);
    const received: unknown[] = [];
    host.onmessage = (event) => received.push(event.data);
    await vi.waitFor(() => expect(FakeWorker.created).toHaveLength(1));
    FakeWorker.created[0].emit({ type: 'commands', commands: [] });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    FakeWorker.created[0].onerror?.({ message: 'TypeError: late' });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/worker-error: TypeError: late/), 'runtime');
  });

  it('an error that overtakes the started worker\'s first message is still a runtime failure', async () => {
    // The frame relays worker messages on the data port and worker errors on
    // the control port, and two ports have no ordering guarantee: a worker
    // that posts, then throws from a later task (a setTimeout in onStart), can
    // have its error reach the host first. Whether the worker had started is
    // the frame's to say, since it sees both events from one Worker object.
    const hold: HeldDataPort = { release: () => {} };
    const onError = vi.fn();
    const { host } = await startHost({ onError }, { holdData: hold });
    hosts.push(host);
    const received: unknown[] = [];
    host.onmessage = (event) => received.push(event.data);
    await vi.waitFor(() => expect(FakeWorker.created).toHaveLength(1));
    FakeWorker.created[0].emit({ type: 'commands', commands: [] });
    FakeWorker.created[0].onerror?.({ message: 'TypeError: from a timer' });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(received).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/worker-error: TypeError: from a timer/), 'runtime');
    expect(host.frame).not.toBeNull();

    hold.release();
    await vi.waitFor(() => expect(received).toEqual([{ type: 'commands', commands: [] }]));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a later message that overtakes an earlier boot error does not turn it into a runtime failure', async () => {
    // The reverse order: the worker errors before it has said anything (a
    // boot failure), keeps running, and later posts. If that message reached
    // the host first, a host-side flag would read the error as runtime and
    // Play would carry on. The frame's verdict (started: false) must decide.
    const hold: HeldDataPort = { release: () => {}, control: true };
    const onError = vi.fn();
    const { host } = await startHost({ onError }, { holdData: hold });
    hosts.push(host);
    const received: unknown[] = [];
    host.onmessage = (event) => received.push(event.data);
    await vi.waitFor(() => expect(FakeWorker.created).toHaveLength(1));
    FakeWorker.created[0].onerror?.({ message: 'Error: Script error.' });
    FakeWorker.created[0].emit({ type: 'commands', commands: [] });
    await vi.waitFor(() => expect(received).toEqual([{ type: 'commands', commands: [] }]));
    expect(onError).not.toHaveBeenCalled();

    hold.release();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith('Script sandbox worker-error: Error: Script error.', 'boot', 'worker-error');
    expect(host.frame).toBeNull();
  });

  it('reports a boot failure ONCE: the boot timer does not report the same frame again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onError = vi.fn();
    hosts.push(
      createSandboxedScriptHost({ loadWorkerSource: () => Promise.reject(new Error('chunk 404')), onError, bootTimeoutMs: 1000 }),
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    // The boot timer is the other reporter a load failure could be followed by.
    vi.advanceTimersByTime(5000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('chunk 404', 'boot', 'source-load');
  });

  it('reports a frame that never comes up, and stays quiet once it has', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stuck = vi.fn();
    hosts.push(createSandboxedScriptHost({ loadWorkerSource: () => new Promise<string>(() => {}), onError: stuck, bootTimeoutMs: 1000 }));
    vi.advanceTimersByTime(999);
    expect(stuck).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stuck).toHaveBeenCalledWith('Script sandbox did not start within 1000 ms.', 'boot', 'timeout');

    const healthy = vi.fn();
    const { host } = await startHost({ onError: healthy, bootTimeoutMs: 1000 });
    hosts.push(host);
    // 'ready' arrives on the control port and clears the boot timer.
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(0));
    vi.advanceTimersByTime(5000);
    expect(healthy).not.toHaveBeenCalled();
  });

  it("a frame that is attached and booted but never says 'ready' is a TIMEOUT, not a worker error", async () => {
    // The other boot shape the runner must tell apart from WebKit's: here
    // nothing was ever heard, which may be transient (a busy tab), so the
    // reason is 'timeout' and the creator is told to retry. The frame is real
    // and the boot message is delivered; its window simply never answers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const silentWindow = { postMessage: vi.fn() };
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(silentWindow as unknown as Window);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onError = vi.fn();
    const host = createSandboxedScriptHost({
      loadWorkerSource: async () => 'WORKER_SOURCE_TEXT',
      container,
      onError,
      bootTimeoutMs: 1000,
    });
    hosts.push(host);
    // Not vi.waitFor: under fake timers it advances them, which would spend the
    // boot timeout this test is measuring. Flush microtasks only.
    await vi.advanceTimersByTimeAsync(0);
    expect(host.frame).not.toBeNull();
    host.frame?.dispatchEvent(new Event('load'));
    // Premise: the frame really was booted, so this is not the source-load path.
    expect(silentWindow.postMessage).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(999);
    expect(onError).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('Script sandbox did not start within 1000 ms.', 'boot', 'timeout');
    // Fail closed exactly as for every boot failure: the frame is gone.
    expect(host.frame).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });
});
