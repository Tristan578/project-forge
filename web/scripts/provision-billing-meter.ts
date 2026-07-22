/**
 * One-time provisioning script for the Stripe `generation_tokens` billing
 * meter (PF-977 / #8969).
 *
 * NOT run by any build/deploy step and NOT run automatically by an agent —
 * an owner runs it manually, once per Stripe mode (test, then live), after
 * setting STRIPE_SECRET_KEY to the matching secret key. Idempotent: looks
 * up the meter by event_name before creating, so re-running is always
 * safe and never creates a duplicate meter.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... node web/scripts/provision-billing-meter.ts
 *   STRIPE_SECRET_KEY=sk_live_... node web/scripts/provision-billing-meter.ts
 *
 * Runs under plain `node` (no tsx/ts-node) via Node's built-in TypeScript
 * type-stripping — Node 24+ only. That's why `getStripe` is imported by
 * relative path below instead of the `@/` alias: bare type-stripping does
 * not consult tsconfig.json path mappings, only a bundler/resolver would.
 * The relative import also carries an explicit `.ts` extension: Node's
 * native ESM resolver (unlike vitest's bundler-style resolver, or CommonJS)
 * requires an explicit extension on every relative specifier and does not
 * try appending `.ts` itself — an extensionless import here fails with
 * `ERR_MODULE_NOT_FOUND` before any application code runs (`web/tsconfig.json`
 * sets `allowImportingTsExtensions: true` so `tsc --noEmit` accepts the
 * `.ts` suffix).
 *
 * See specs/stripe-billing-meters.md section 2 for the meter model
 * rationale (one meter, sum aggregation, customer_mapping by_id) and the
 * "Rejected alternative: per-generation-type meters" note explaining why
 * `operation` stays an analytics-only payload field rather than a second
 * meter.
 */

import Stripe from 'stripe';
import { pathToFileURL } from 'node:url';
import { getStripe } from '../src/lib/billing/stripe-client.ts';

/**
 * Must match `METER_EVENT_NAME` in web/src/lib/billing/meterEvents.ts.
 * Kept as an independent literal rather than imported: this script runs
 * under plain `node` without path-alias resolution, while meterEvents.ts
 * pulls in `@/lib/db/*` via the `@/` alias, which would fail to resolve
 * here. Parity between the two literals is enforced by
 * web/scripts/__tests__/provision-billing-meter.test.ts (run via vitest,
 * which does resolve `@/`).
 */
export const METER_EVENT_NAME = 'generation_tokens';

export type StripeMode = 'test' | 'live' | 'unknown';

/** Infer which Stripe mode a secret (or restricted) key targets from its prefix. */
export function resolveStripeMode(secretKey: string | undefined): StripeMode {
  if (!secretKey) return 'unknown';
  if (secretKey.startsWith('sk_test_') || secretKey.startsWith('rk_test_')) return 'test';
  if (secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_')) return 'live';
  return 'unknown';
}

/**
 * Idempotently ensure the `generation_tokens` meter exists in whichever
 * Stripe mode `stripe` is scoped to. Stripe's meters.list endpoint has no
 * event_name filter, so this pages through meters looking for a match
 * before falling back to create.
 */
export async function ensureMeterProvisioned(
  stripe: Pick<Stripe, 'billing'>
): Promise<{ created: boolean; meterId: string }> {
  for await (const meter of stripe.billing.meters.list({ status: 'active' })) {
    if (meter.event_name === METER_EVENT_NAME) {
      return { created: false, meterId: meter.id };
    }
  }

  const meter = await stripe.billing.meters.create({
    display_name: 'Generation Tokens',
    event_name: METER_EVENT_NAME,
    default_aggregation: { formula: 'sum' },
    value_settings: { event_payload_key: 'value' },
    customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
  });
  return { created: true, meterId: meter.id };
}

export async function main(): Promise<void> {
  const mode = resolveStripeMode(process.env.STRIPE_SECRET_KEY);
  if (mode === 'unknown') {
    console.error(
      'STRIPE_SECRET_KEY is unset or not a recognized sk_test_/sk_live_/rk_test_/rk_live_ key. ' +
        'Aborting — refusing to guess which Stripe mode to provision.'
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Provisioning the "${METER_EVENT_NAME}" meter in Stripe ${mode} mode...`);
  const stripe = getStripe();
  const { created, meterId } = await ensureMeterProvisioned(stripe);
  console.log(
    created
      ? `Created meter ${meterId} (${METER_EVENT_NAME}). Attach a metered Price to it in the Stripe Dashboard when ready to bill against it — this script only provisions the meter itself (shadow mode).`
      : `Meter ${meterId} (${METER_EVENT_NAME}) already exists in ${mode} mode — nothing to do.`
  );
}

/**
 * Cross-platform "is this the process entry point" check. A naive
 * `import.meta.url === \`file://${argv1}\`` comparison breaks on Windows —
 * argv1 there is a backslash path with a drive letter (e.g.
 * `C:\Users\me\script.ts`), which never equals the forward-slash
 * `file:///C:/Users/me/script.ts` form Node uses for import.meta.url — so
 * the naive check silently never runs `main()` when invoked directly on
 * Windows. `pathToFileURL` performs the same platform-aware normalization
 * Node uses internally to compute import.meta.url, so comparing through it
 * matches on every platform.
 */
export function isMainModule(metaUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  return metaUrl === pathToFileURL(argv1).href;
}

const isMain = isMainModule(import.meta.url, process.argv[1]);
if (isMain) {
  main().catch((err: unknown) => {
    console.error('Provisioning failed:', err);
    process.exitCode = 1;
  });
}
