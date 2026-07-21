/**
 * Tests for the one-time billing-meter provisioning script (PF-977 / #8969).
 *
 * The script itself runs under plain `node` (no `@/` alias resolution), so it
 * keeps its own literal copy of METER_EVENT_NAME instead of importing
 * meterEvents.ts. That duplication is only safe if the two literals can never
 * silently drift — the first test below is the parity check that guarantees
 * that, importing meterEvents.ts via the `@/` alias (which vitest, unlike
 * plain node, does resolve).
 */

// @vitest-environment node

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
  queryWithResilience: vi.fn(),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

import { describe, it, expect, vi, afterEach } from 'vitest';
import { pathToFileURL } from 'node:url';
import {
  METER_EVENT_NAME,
  resolveStripeMode,
  ensureMeterProvisioned,
  isMainModule,
  main,
} from '../provision-billing-meter';
import { METER_EVENT_NAME as REPORTER_METER_EVENT_NAME } from '@/lib/billing/meterEvents';

describe('METER_EVENT_NAME parity', () => {
  it('matches the constant used by the usage reporter (meterEvents.ts)', () => {
    expect(METER_EVENT_NAME).toBe(REPORTER_METER_EVENT_NAME);
  });

  it('is the literal Stripe event name the spec commits to', () => {
    expect(METER_EVENT_NAME).toBe('generation_tokens');
  });
});

describe('resolveStripeMode', () => {
  it.each([
    ['sk_test_abc123', 'test'],
    ['rk_test_abc123', 'test'],
    ['sk_live_abc123', 'live'],
    ['rk_live_abc123', 'live'],
  ] as const)('maps %s to %s', (key, mode) => {
    expect(resolveStripeMode(key)).toBe(mode);
  });

  it('is unknown when unset', () => {
    expect(resolveStripeMode(undefined)).toBe('unknown');
  });

  it.each(['', 'not_a_key', 'pk_test_abc123', 'sk_bogus_abc123'])(
    'is unknown for malformed key %j',
    (key) => {
      expect(resolveStripeMode(key)).toBe('unknown');
    }
  );
});

describe('ensureMeterProvisioned', () => {
  function makeStripeStub(existingMeters: { id: string; event_name: string }[]) {
    const create = vi.fn(async (params: { event_name: string }) => ({
      id: 'mtr_new',
      event_name: params.event_name,
    }));
    return {
      stripe: {
        billing: {
          meters: {
            list: async function* list() {
              for (const meter of existingMeters) yield meter;
            },
            create,
          },
        },
      } as unknown as Parameters<typeof ensureMeterProvisioned>[0],
      create,
    };
  }

  it('returns the existing meter without creating one when event_name already matches', async () => {
    const { stripe, create } = makeStripeStub([
      { id: 'mtr_other', event_name: 'some_other_event' },
      { id: 'mtr_existing', event_name: METER_EVENT_NAME },
    ]);

    const result = await ensureMeterProvisioned(stripe);

    expect(result).toEqual({ created: false, meterId: 'mtr_existing' });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates the meter with the spec shape when none exists yet', async () => {
    const { stripe, create } = makeStripeStub([]);

    const result = await ensureMeterProvisioned(stripe);

    expect(result).toEqual({ created: true, meterId: 'mtr_new' });
    expect(create).toHaveBeenCalledWith({
      display_name: 'Generation Tokens',
      event_name: METER_EVENT_NAME,
      default_aggregation: { formula: 'sum' },
      value_settings: { event_payload_key: 'value' },
      customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
    });
  });
});

describe('isMainModule', () => {
  it('is true when metaUrl is the file:// URL for argv1 (POSIX path)', () => {
    const argv1 = '/home/runner/work/project-forge/web/scripts/provision-billing-meter.ts';
    const metaUrl = pathToFileURL(argv1).href;

    expect(isMainModule(metaUrl, argv1)).toBe(true);
  });

  it('is false when metaUrl does not match the file:// URL for argv1', () => {
    const argv1 = '/home/runner/work/project-forge/web/scripts/provision-billing-meter.ts';

    expect(isMainModule('file:///something/else.ts', argv1)).toBe(false);
  });

  it('is false when argv1 is undefined (imported as a library, not run directly)', () => {
    expect(isMainModule('file:///whatever/provision-billing-meter.ts', undefined)).toBe(false);
  });

  it('matches a Windows-style argv1 (backslashes, drive letter) via pathToFileURL, not naive string concatenation', async () => {
    vi.resetModules();
    vi.doMock('node:url', () => ({
      // Stand-in for Node's real (platform-dependent) pathToFileURL: on an
      // actual Windows host it normalizes backslashes to forward slashes and
      // prefixes the drive letter, producing a URL that matches Node's own
      // import.meta.url for that same file. We can't exercise the real
      // win32 branch on this (POSIX) test runner, so this fake reproduces
      // just that normalization to prove isMainModule delegates to
      // pathToFileURL(argv1).href rather than the old buggy
      // `file://${argv1}` template (which a raw backslash path would never
      // match).
      pathToFileURL: (p: string) =>
        new URL('file:///' + p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:')),
    }));

    const mod = await import('../provision-billing-meter');
    const argv1 = 'C:\\Users\\dev\\project-forge\\web\\scripts\\provision-billing-meter.ts';
    const metaUrl = 'file:///C:/Users/dev/project-forge/web/scripts/provision-billing-meter.ts';

    expect(mod.isMainModule(metaUrl, argv1)).toBe(true);
    // The old naive comparison would never have matched here — pinning that
    // down directly documents the bug this test guards against.
    expect(`file://${argv1}`).not.toBe(metaUrl);

    vi.doUnmock('node:url');
    vi.resetModules();
  });
});

describe('main() safety-abort path', () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it('aborts without provisioning when STRIPE_SECRET_KEY is unset', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await main();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Aborting — refusing to guess which Stripe mode to provision.'
      )
    );
    // Refuses to proceed: exitCode is set to a failure code and nothing
    // past the abort (the "Provisioning..." log line) ever runs.
    expect(process.exitCode).toBe(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('aborts without provisioning when STRIPE_SECRET_KEY is a malformed/unrecognized key', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'pk_test_not_a_secret_key');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await main();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('not a recognized sk_test_/sk_live_/rk_test_/rk_live_ key')
    );
    expect(process.exitCode).toBe(1);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
