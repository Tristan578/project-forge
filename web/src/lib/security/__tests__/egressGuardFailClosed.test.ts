/**
 * @vitest-environment node
 *
 * THE BOUNDARY ASSERTION: what the guard does when detection and rewrite
 * DISAGREE.
 *
 * Two review boards in a row found that agreement quietly false, in opposite
 * directions. The fifth found the SCAN blind to JSON escapes, so a body carrying
 * a credential was granted byte identity. The sixth found the REWRITE blind to
 * the same escapes, so five text-mode channels detected a credential, took the
 * slow path, rewrote nothing and emitted it anyway. Both fixes are real and both
 * are pinned by `egressGuard.test.ts` — and a property that has gone false twice
 * should not be the only thing standing between a credential and a client.
 *
 * So `withEgressGuard` re-scans what it is about to emit and fails closed when
 * the answer is still "candidate". This file drives that path the only way it
 * can be driven: with a redaction pass that DETECTS everything and REWRITES
 * nothing, which is the shipped defect in its most extreme form.
 *
 * Mocking the pass is deliberate, and it is not mocking the thing under test.
 * The thing under test is `egressGuard`'s DECISION, not `redactSecrets`'
 * matching — and the decision is unreachable from real inputs by construction,
 * because the whole point of the fix is that no real input produces the
 * disagreement any more. A test that could only run while the redactor is broken
 * is a test that never runs (lessons-learned #9). The positive control at the
 * bottom proves the check is not simply always failing.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { captureException, stub } = vi.hoisted(() => ({
  captureException: vi.fn(),
  /**
   * What the stubbed pass does, swapped per test. A mutable object rather than
   * a queue of `mock*Once` values, so nothing can be left armed.
   */
  stub: {
    hasCandidate: (_text: string): boolean => true,
    redactText: (text: string): string => text,
  },
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException }));

vi.mock('@/lib/security/redactSecrets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/redactSecrets')>();
  return {
    ...actual,
    createRedactionPass: () => ({
      hasCandidate: (text: string) => stub.hasCandidate(text),
      // Answers the same way as the plain scan on purpose. This file drives the
      // guard's DECISION; the extra unescape level a JSON body gets is a
      // property of DETECTION, and `egressGuard.test.ts` pins that on real
      // input. Leaving it off the stub does not weaken a case here — it makes
      // the guard call `undefined` and every case fail for the wrong reason.
      hasCandidateInParsedJson: (text: string) => stub.hasCandidate(text),
      redactText: (text: string) => stub.redactText(text),
      redactValue: <T,>(value: T): T => value,
      lastNodeCount: () => 0,
    }),
  };
});

import { withEgressGuard } from '@/lib/security/egressGuard';
import { REDACTION_PLACEHOLDER } from '@/lib/security/redactSecrets';

const SECRET = 'sk-ant-api03-0123456789abcdefghijKLMNOPQRSTUVWXYZ';

// Re-created per test, not held from module scope: the vitest config restores
// spies before each test, so a module-scoped spy is detached by the time a
// `beforeEach` tries to configure it — and the assertions below then read zero
// calls while the real console prints.
let consoleError = vi.spyOn(console, 'error');

beforeEach(() => {
  captureException.mockReset();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  // Detected, never rewritten — the shipped defect.
  stub.hasCandidate = () => true;
  stub.redactText = (text) => text;
});

afterAll(() => {
  consoleError.mockRestore();
});

describe('a BODY the rewrite could not clear is not emitted at all', () => {
  it('answers with the fixed 500 instead of the credential', async () => {
    const res = await withEgressGuard(async () =>
      new Response(`Meshy status error (401): ${SECRET}`, {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      }))();
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(text).toBe(JSON.stringify({ error: 'Internal server error' }));
    expect(text).not.toContain(SECRET);
  });

  it('does the same on a 200, where the lost response is the cost of the choice', async () => {
    // Named because it IS a cost: a success body the guard cannot clean becomes
    // an error. That is the direction that fails closed, and it is reported
    // rather than silent.
    const res = await withEgressGuard(async () =>
      new Response(JSON.stringify({ url: `https://x.test/${SECRET}` }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))();

    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(SECRET);
  });

  it('REPORTS the disagreement — it is not a silent pass', async () => {
    await withEgressGuard(async () =>
      new Response(`detail ${SECRET}`, {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      }))();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('redaction did not remove'),
      expect.objectContaining({ status: 500, json: false }),
    );
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ status: 500 }),
    );
    // Nothing derived from the response reaches the reporter — only values the
    // guard computed. A reporter that forwarded the body would be a fourth
    // egress channel wearing an observability hat.
    const [, detail] = captureException.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(JSON.stringify(detail)).not.toContain(SECRET);
  });
});

describe('an ENVELOPE value the rewrite could not clear is replaced, not emitted', () => {
  beforeEach(() => {
    // Detection narrowed to where the credential actually is, so the BODY is
    // clean and the ENVELOPE is what fails. With "everything is a candidate"
    // the body check short-circuits into the fixed 500 first and these cases
    // would assert nothing about headers at all (lessons-learned #11).
    stub.hasCandidate = (text) => text.includes(SECRET);
  });

  const withHeader = (name: string, value: string) => async (): Promise<Response> => {
    const out = new Response('{}', {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
    out.headers.set(name, value);
    return out;
  };

  it('replaces a header value wholesale with the placeholder', async () => {
    const res = await withEgressGuard(
      withHeader('x-upstream-detail', `invalid key ${SECRET}`),
    )();

    expect(res.headers.get('x-upstream-detail')).toBe(REDACTION_PLACEHOLDER);
  });

  it('replaces a Set-Cookie value wholesale', async () => {
    const res = await withEgressGuard(async () => {
      const out = new Response('{}', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
      out.headers.append('set-cookie', `sess=${SECRET}; Path=/`);
      return out;
    })();
    const cookies = res.headers.getSetCookie().join('\n');

    expect(cookies).not.toContain(SECRET);
    expect(cookies).toContain(REDACTION_PLACEHOLDER);
  });

  it('replaces the statusText reason phrase', async () => {
    const res = await withEgressGuard(async () =>
      new Response('{}', {
        status: 500,
        statusText: `upstream ${SECRET}`,
        headers: { 'content-type': 'application/json' },
      }))();

    expect(res.statusText).toBe(REDACTION_PLACEHOLDER);
  });

  it('names the CHANNEL in the report, so a real disagreement is diagnosable', async () => {
    await withEgressGuard(withHeader('x-upstream-detail', `invalid key ${SECRET}`))();

    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ channel: 'x-upstream-detail' }),
    );
  });
});

describe('the reporter cannot become the failure it reports', () => {
  it('still returns the fixed 500 when console AND Sentry both throw', async () => {
    // `reportGuardFailure` sits on the failure path of a function whose contract
    // is "never throws". A throw from the reporter would turn a fail-closed 500
    // into an unhandled rejection — the exact failure this module exists to
    // prevent, reintroduced by the code that reports it.
    consoleError.mockImplementation(() => {
      throw new Error('console is gone');
    });
    captureException.mockImplementation(() => {
      throw new Error('sentry is gone');
    });

    const res = await withEgressGuard(async () =>
      new Response(`detail ${SECRET}`, {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      }))();

    expect(res.status).toBe(500);
    expect(await res.text()).toBe(JSON.stringify({ error: 'Internal server error' }));
  });
});

describe('the positive control: the check is not simply always failing', () => {
  it('emits the rewritten response when the rewrite DID clear the candidate', async () => {
    // Without this, every assertion above would also be satisfied by a guard
    // that 500s on any response the scan flags — which would break every real
    // error body carrying a credential instead of redacting it.
    stub.redactText = (text) => text.split(SECRET).join(REDACTION_PLACEHOLDER);
    stub.hasCandidate = (text) => text.includes(SECRET);

    const res = await withEgressGuard(async () => {
      const out = new Response(`Meshy status error (401): ${SECRET}`, {
        status: 502,
        statusText: `upstream ${SECRET}`,
        headers: { 'content-type': 'text/plain' },
      });
      out.headers.set('x-upstream-detail', `invalid key ${SECRET}`);
      return out;
    })();
    const text = await res.text();

    expect(res.status).toBe(502);
    expect(text).toBe(`Meshy status error (401): ${REDACTION_PLACEHOLDER}`);
    expect(res.headers.get('x-upstream-detail')).toBe(`invalid key ${REDACTION_PLACEHOLDER}`);
    expect(res.statusText).toBe(`upstream ${REDACTION_PLACEHOLDER}`);
    expect(consoleError).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });
});
