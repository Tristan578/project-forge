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

import { describe, it, expect, vi } from 'vitest';
import {
  METER_EVENT_NAME,
  resolveStripeMode,
  ensureMeterProvisioned,
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
            // eslint-disable-next-line @typescript-eslint/require-await -- async generator, no await needed for a fixed in-memory list
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
