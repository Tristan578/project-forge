# Activating Stripe billing-meter usage reporting (PF-977/PF-978)

`BILLING_METERS_ENABLED` turns on shadow-mode reporting of confirmed generation
token usage to a Stripe billing meter (`generation_tokens`), so metered-tier
revenue can eventually be reconciled against actual consumption. This is a
usage-reporting feature, not a billing feature: no metered Price is attached
in this rollout phase, so turning it on never changes what any customer is
charged (see `specs/stripe-billing-meters.md` section 7, Rollout).

Unlike the QStash callback path, this feature has a real prerequisite before
the env var can be flipped on: the `generation_tokens` meter must already
exist in the target Stripe mode (test or live). There is no auto-provisioning
on first use — `reportGenerationUsage()` only reports to a meter, it never
creates one.

## Dormant by default

- `BILLING_METERS_ENABLED` is unset in all environments by default.
- `isBillingMetersEnabled()` (`web/src/lib/billing/meterEvents.ts`) requires
  the exact string `'true'` — any other value (`'1'`, `'TRUE'`, `'false'`,
  empty string) leaves it off.
- When off, `reportGenerationUsage()` returns immediately as its first line,
  before touching the database or Stripe.
- BYOK generations (`metered: false` on the resolved key) are always skipped
  regardless of the flag — they cost the user nothing, so they must never be
  reported to the platform meter (spec section 1, Non-goals).
- No code change is needed to activate; only the env var and the one-time
  meter provisioning below.

## Activation steps (owner-only)

1. Provision the meter in Stripe **test mode** first:
   ```bash
   STRIPE_SECRET_KEY=sk_test_... node web/scripts/provision-billing-meter.ts
   ```
   This is idempotent — it looks up the `generation_tokens` meter by
   `event_name` before creating one, so re-running it is always safe. Confirm
   the script logs either "Created meter …" or "already exists" (both are
   success outcomes).
2. Set `BILLING_METERS_ENABLED=true` in Vercel for **Preview** and let it run
   against Stripe test mode for a full billing cycle before touching
   production (see the Rollout section of the spec — shadow mode should run
   end-to-end at least once before advancing).
3. Repeat step 1 in **live mode**:
   ```bash
   STRIPE_SECRET_KEY=sk_live_... node web/scripts/provision-billing-meter.ts
   ```
4. Set `BILLING_METERS_ENABLED=true` in Vercel for **Production**:
   ```bash
   vercel env add BILLING_METERS_ENABLED production --scope tnolan
   # value: true
   ```
5. Redeploy — this is a server-only env var read at request time (not build
   time), so a redeploy isn't strictly required for the flag itself, but
   deploy anyway if step 3/4 landed alongside other changes.

## Verifying it is live

- Trigger a metered (non-BYOK) generation on a paid tier, then check the
  Stripe Dashboard's meter event stream (Billing → Meters →
  `generation_tokens` → Recent events) for a new event with the expected
  `payload.value` (the generation's token cost) and `payload.stripe_customer_id`.
- Query `token_usage` for the row: `metered_at` should be set shortly after
  `meter_attempted_at`. A row with `meter_attempted_at` set but `metered_at`
  still null after a few minutes indicates the Stripe call failed — check
  Sentry for a `meter_event` breadcrumb/exception tagged with that `usageId`.
- Misconfiguration symptom: if the flag is on but the meter was never
  provisioned in that mode, every emission fails with a Stripe "no such
  meter" error, captured via `captureException` with `action: 'meter_event'`
  — `meter_attempted_at` gets claimed then cleared on every attempt (the
  best-effort release), so rows never advance to `metered_at`. Run the
  provisioning script for that mode to fix.

## Rolling back

- Unset `BILLING_METERS_ENABLED` (or set it to anything other than the exact
  string `'true'`) and redeploy. `reportGenerationUsage()` no-ops immediately
  on its first line — no in-flight state to reconcile.
- `token_usage.meter_attempted_at` and `metered_at` are purely additive,
  nullable columns (migration `web/drizzle/0009_token_usage_meter_columns.sql`)
  — disabling the flag leaves existing rows untouched and requires no data
  migration to reverse.
- The Stripe meter itself is not deleted by rolling back; it simply stops
  receiving new events. Leaving an idle meter in Stripe is harmless.

## Maintenance note

`web/scripts/provision-billing-meter.ts` runs under plain `node` (Node 24's
built-in TypeScript type-stripping, no bundler), which cannot resolve the
`@/` path alias that `meterEvents.ts` depends on for its DB and Sentry
imports. Because of that, the script keeps its own literal copy of the
`generation_tokens` event name rather than importing `METER_EVENT_NAME` from
`meterEvents.ts`. The two literals are kept in sync by a parity test —
`web/scripts/__tests__/provision-billing-meter.test.ts` imports both copies
(the script's directly, `meterEvents.ts`'s via the `@/` alias, which vitest
does resolve) and asserts they're equal. If you ever rename the Stripe event,
update both literals — the parity test will fail loudly if you only update
one.

Wiring `ResolvedKey.stripeCustomerId` into `createGenerationHandler`'s
`after()` hook so `reportGenerationUsage()` is actually called from the
request path is a separate, later ticket (spec section 8, slice 3) — this
runbook only covers provisioning the meter and flipping the flag on, not
integrating the call site.
