/**
 * Tests for the infinite loop watchdog (PF-479).
 *
 * Coverage targets:
 *   - injectLoopGuards: transforms while/for/do-while loops with iteration guards
 *   - Script compilation: guarded source is used in sandbox
 *   - Hook invocation: infinite loop errors produce script_timeout messages
 *   - set_limits: loopIterationLimit is configurable at runtime
 *   - Normal scripts: finish without triggering the watchdog
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Worker harness — mirrors scriptWorker.test.ts setup pattern
// ---------------------------------------------------------------------------

const mockPostMessage = vi.fn();
const globalScope = globalThis as Record<string, unknown>;

type MessageHandler = (e: { data: Record<string, unknown> }) => void | Promise<void>;

async function setupWorker(): Promise<MessageHandler> {
  vi.resetModules();
  globalScope.self = { postMessage: mockPostMessage };
  // @ts-expect-error scriptWorker is a web worker with no module exports
  await import('../scriptWorker');
  return (globalScope.self as Record<string, unknown>).onmessage as MessageHandler;
}

function initMsg(
  scripts: { entityId: string; enabled: boolean; source: string }[],
  extras?: Record<string, unknown>,
) {
  return {
    data: {
      type: 'init',
      scripts,
      entities: {},
      entityInfos: {},
      ...extras,
    },
  };
}

function tickMsg(dt = 0.016) {
  return { data: { type: 'tick', dt, entities: {} } };
}

function stopMsg() {
  return { data: { type: 'stop' } };
}

function setLimitsMsg(limits: Record<string, unknown>) {
  return { data: { type: 'set_limits', ...limits } };
}

function getMessages(type: string) {
  return mockPostMessage.mock.calls
    .map(c => c[0] as Record<string, unknown>)
    .filter(m => m.type === type);
}

describe('infinite loop watchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalScope.self = { postMessage: mockPostMessage };
  });

  afterEach(() => {
    delete globalScope.self;
    vi.resetModules();
  });

  // ─── Normal scripts complete without triggering watchdog ─────────

  it('allows a normal for loop to complete without error', async () => {
    const handler = await setupWorker();
    const code = `
      function onUpdate(dt) {
        let sum = 0;
        for (let i = 0; i < 100; i++) { sum += i; }
        forge.log("sum=" + sum);
      }
    `;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));
    mockPostMessage.mockClear();
    await handler(tickMsg());

    const logs = getMessages('log');
    expect(logs.some(m => (m.message as string).includes('sum=4950'))).toBe(true);
    const timeouts = getMessages('script_timeout');
    expect(timeouts).toHaveLength(0);
  });

  it('allows a normal while loop to complete without error', async () => {
    const handler = await setupWorker();
    const code = `
      function onStart() {
        let count = 0;
        while (count < 50) { count++; }
        forge.log("count=" + count);
      }
    `;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const logs = getMessages('log');
    expect(logs.some(m => (m.message as string).includes('count=50'))).toBe(true);
    const timeouts = getMessages('script_timeout');
    expect(timeouts).toHaveLength(0);
  });

  // ─── Infinite loop detection in onStart ──────────────────────────

  it('detects infinite while loop in onStart and posts script_timeout', async () => {
    const handler = await setupWorker();
    // Set a low iteration limit so the test completes quickly
    await handler(setLimitsMsg({ loopIterationLimit: 100 }));

    const code = `
      function onStart() {
        while (true) { /* infinite */ }
      }
    `;

    await handler(initMsg([{ entityId: 'loop-entity', enabled: true, source: code }]));

    const timeouts = getMessages('script_timeout');
    expect(timeouts.length).toBeGreaterThanOrEqual(1);
    const timeout = timeouts[0];
    expect(timeout.entityId).toBe('loop-entity');
    expect(timeout.hookName).toBe('onStart');
    expect(timeout.message).toContain('Infinite loop detected');
  });

  // ─── Infinite loop detection in onUpdate ─────────────────────────

  it('detects infinite for loop in onUpdate and posts script_timeout', async () => {
    const handler = await setupWorker();
    await handler(setLimitsMsg({ loopIterationLimit: 50 }));

    const code = `
      function onUpdate(dt) {
        for (;;) { /* infinite */ }
      }
    `;

    await handler(initMsg([{ entityId: 'update-loop', enabled: true, source: code }]));
    mockPostMessage.mockClear();
    await handler(tickMsg());

    const timeouts = getMessages('script_timeout');
    expect(timeouts.length).toBeGreaterThanOrEqual(1);
    expect(timeouts[0].entityId).toBe('update-loop');
    expect(timeouts[0].hookName).toBe('onUpdate');
    expect(timeouts[0].message).toContain('Infinite loop detected');
  });

  it('removes script from active list after infinite loop in onUpdate', async () => {
    const handler = await setupWorker();
    await handler(setLimitsMsg({ loopIterationLimit: 50 }));

    const code = `
      function onUpdate(dt) {
        while (true) {}
      }
    `;

    await handler(initMsg([{ entityId: 'e-remove', enabled: true, source: code }]));
    mockPostMessage.mockClear();

    // First tick: triggers watchdog, script removed
    await handler(tickMsg());
    const timeouts1 = getMessages('script_timeout');
    expect(timeouts1).toHaveLength(1);

    mockPostMessage.mockClear();

    // Second tick: script should not run (removed)
    await handler(tickMsg());
    const timeouts2 = getMessages('script_timeout');
    expect(timeouts2).toHaveLength(0);
  });

  // ─── Infinite loop detection in onDestroy ────────────────────────

  it('detects infinite loop in onDestroy and posts script_timeout', async () => {
    const handler = await setupWorker();
    await handler(setLimitsMsg({ loopIterationLimit: 50 }));

    const code = `
      function onDestroy() {
        do { /* infinite */ } while (true);
      }
    `;

    await handler(initMsg([{ entityId: 'destroy-loop', enabled: true, source: code }]));
    mockPostMessage.mockClear();
    await handler(stopMsg());

    const timeouts = getMessages('script_timeout');
    expect(timeouts.length).toBeGreaterThanOrEqual(1);
    expect(timeouts[0].entityId).toBe('destroy-loop');
    expect(timeouts[0].hookName).toBe('onDestroy');
    expect(timeouts[0].message).toContain('Infinite loop detected');
  });

  // ─── script_timeout message format ───────────────────────────────

  it('script_timeout message has correct format', async () => {
    const handler = await setupWorker();
    await handler(setLimitsMsg({ loopIterationLimit: 10 }));

    const code = `
      function onStart() {
        while (true) {}
      }
    `;

    await handler(initMsg([{ entityId: 'fmt-test', enabled: true, source: code }]));

    const timeouts = getMessages('script_timeout');
    expect(timeouts.length).toBeGreaterThanOrEqual(1);
    const msg = timeouts[0];
    expect(msg).toEqual(expect.objectContaining({
      type: 'script_timeout',
      entityId: 'fmt-test',
      hookName: 'onStart',
      message: expect.stringContaining('Infinite loop detected'),
    }));
  });

  // ─── Configurable loop iteration limit ───────────────────────────

  it('respects custom loopIterationLimit via set_limits', async () => {
    const handler = await setupWorker();
    // Set very low limit
    await handler(setLimitsMsg({ loopIterationLimit: 5 }));

    const code = `
      function onUpdate(dt) {
        let i = 0;
        while (i < 1000) { i++; }
      }
    `;

    await handler(initMsg([{ entityId: 'limit-test', enabled: true, source: code }]));
    mockPostMessage.mockClear();
    await handler(tickMsg());

    // With limit=5, the loop should be interrupted before completing 1000 iterations
    const timeouts = getMessages('script_timeout');
    expect(timeouts.length).toBeGreaterThanOrEqual(1);
    expect(timeouts[0].message).toContain('exceeded 5 iterations');
  });

  // ─── Non-loop errors still reported as regular errors ────────────

  it('non-loop errors in onStart still produce regular error messages', async () => {
    const handler = await setupWorker();

    const code = `
      function onStart() {
        throw new Error("custom error");
      }
    `;

    await handler(initMsg([{ entityId: 'err-test', enabled: true, source: code }]));

    const errors = getMessages('error');
    expect(errors.some(m => (m.message as string).includes('custom error'))).toBe(true);
    const timeouts = getMessages('script_timeout');
    expect(timeouts).toHaveLength(0);
  });

  it('non-loop errors in onUpdate still produce regular error messages', async () => {
    const handler = await setupWorker();

    const code = `
      function onUpdate(dt) {
        throw new Error("update error");
      }
    `;

    await handler(initMsg([{ entityId: 'err-update', enabled: true, source: code }]));
    mockPostMessage.mockClear();
    await handler(tickMsg());

    const errors = getMessages('error');
    expect(errors.some(m => (m.message as string).includes('update error'))).toBe(true);
    const timeouts = getMessages('script_timeout');
    expect(timeouts).toHaveLength(0);
  });

  // ─── Loop guards in string literals are not injected ─────────────

  it('does not inject guards into loop keywords inside strings', async () => {
    const handler = await setupWorker();

    const code = `
      function onStart() {
        const msg = "while (true) { for (;;) { do {} while(1) } }";
        forge.log(msg);
      }
    `;

    await handler(initMsg([{ entityId: 'str-test', enabled: true, source: code }]));

    const logs = getMessages('log');
    expect(logs.some(m => (m.message as string).includes('while (true)'))).toBe(true);
    const timeouts = getMessages('script_timeout');
    expect(timeouts).toHaveLength(0);
  });

  // ─── Multiple scripts: one infinite doesn't block others' init ───

  it('terminates only the offending script, others still run', async () => {
    const handler = await setupWorker();
    await handler(setLimitsMsg({ loopIterationLimit: 50 }));

    const goodCode = `function onUpdate(dt) { forge.log("good"); }`;
    const badCode = `function onUpdate(dt) { while(true) {} }`;

    await handler(initMsg([
      { entityId: 'good', enabled: true, source: goodCode },
      { entityId: 'bad', enabled: true, source: badCode },
    ]));
    mockPostMessage.mockClear();
    await handler(tickMsg());

    const timeouts = getMessages('script_timeout');
    expect(timeouts.some(m => m.entityId === 'bad')).toBe(true);

    // The good script should still produce its log
    const logs = getMessages('log');
    expect(logs.some(m => m.entityId === 'good' && m.message === 'good')).toBe(true);
  });
});
