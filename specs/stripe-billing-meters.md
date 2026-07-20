# Spec: Stripe Billing Meters atop the Credit Ledger

> **Status:** DRAFT — Awaiting Approval
> **Date:** 2026-07-20
> **Ticket:** PF-966 / GH #8957
> **Milestone:** billing / instrumentation
> **Scope:** Layer Stripe Billing Meters onto the existing Postgres token-credit ledger as an async, non-blocking usage mirror. Deliverable is this approved spec; implementation is sliced into follow-up tickets. No SDK bump, no API-version change.

---

## Problem

We sell AI generation credits through a hand-rolled Postgres ledger. The real-time gate lives in `web/src/lib/tokens/service.ts` (`deductTokens` / `refundTokens` / `refundTokenAmount`), reached through `resolveApiKey` (`web/src/lib/keys/resolver.ts`) and wired into all 12 `/api/generate/*` routes by the `createGenerationHandler` factory (`web/src/lib/api/createGenerationHandler.ts`). Stripe today sees only subscription invoices and one-time token-pack payments — it has zero visibility into per-generation usage.

Stripe Billing Meters (GA since API `2025-03-31.basil`, which predates our pinned `2026-06-24.dahlia`) let us report usage to Stripe as first-class metered events. That unlocks:

- Stripe-native usage dashboards and per-customer usage summaries.
- The option of metered overage billing beyond a tier's included credits, without building our own invoicing.
- Less bespoke reconciliation code long-term.

The shape this spec adopts is to report usage asynchronously and non-blocking on top of the existing real-time ledger gate, never touching the latency-sensitive deduction path, with the ledger remaining the source of truth.

## Goal

Emit one Stripe meter event per net-confirmed, platform-billed AI generation so Stripe Billing can aggregate usage per customer — without ever placing a Stripe network call on the generation critical path, without changing any user-visible response or balance, and fully dormant until an owner sets one env var and creates the meter (no code change to activate).

Non-goals: replacing the ledger; metering BYOK generations (they cost the user nothing and must not be billed); metering `tokenCost === 0` / free operations; invoicing customers in the first rollout phase (shadow mode only); subscription or token-pack payment flows (already handled by the webhook).

---

## Design Framework Compliance

This is a web/billing feature; the engine "sandwich" and render-backend questions do not apply. The load-bearing framework answers:

- **Works in exported games?** N/A — server-only billing path; exported runtimes never call generate routes.
- **AI parity?** N/A — no UI action / MCP command surface; this is a server-side side effect of existing generation.
- **Scales O(n)?** Yes — one fire-and-forget meter event per successful generation, off the request path via `after()`. Reconciliation is O(customers-with-usage-in-window), run on a cron, not per request.
- **Undo?** N/A — no editor state; refund symmetry is handled by the metering lifecycle (see Refund Semantics).

---

## 1. Current-State Map

> The ticket's file references were written against an older layout. The authoritative paths, verified against the current tree, are below. In particular, the metered generation path lives in `lib/tokens/service.ts`, not `lib/tokens/creditManager.ts` (which does not exist); a separate 3-pool balance module exists at `lib/credits/creditManager.ts` and is not the path the generate routes bill through.

### Deduction (the metered path)

- **`web/src/lib/tokens/service.ts` → `deductTokens(userId, operation, tokenCost, provider, metadata)`** — the real-time charge. A single WHERE-guarded `UPDATE … users` folded into one atomic CTE with the `INSERT … token_usage` (PF-839), so a user is never charged without a `token_usage` row. Returns `{ success, usageId, remaining }`. The `usageId` is the `token_usage.id` uuid PK and is the natural upstream idempotency key for metering.
- **`web/src/lib/keys/resolver.ts` → `resolveApiKey(...)`** — decides BYOK vs platform. Only the platform branch calls `deductTokens` and returns `{ type: 'platform', metered: true, usageId }`. The BYOK branch returns `{ metered: false }` with no `usageId`. Metering must key off `metered === true`. The resolver has already read the full `users` row, so `stripeCustomerId` is available here.
- **`web/src/lib/api/createGenerationHandler.ts`** — the single factory behind all generate routes (a documented single point of failure). It calls `resolveApiKey` → `execute(provider)` → refunds via `refundTokens` on failure, and already uses `after()` to run post-response work (the QStash durable callback, PF-906). This `after()` seam is where net-success metering hooks.

### Refund

- **`web/src/lib/tokens/service.ts` → `refundTokens(userId, usageId)`** — full reversal on provider failure. Idempotent via the UNIQUE partial index on `(user_id, operation, (metadata->>'refundedUsageId'))` (`operation = 'refund'`), `ON CONFLICT DO NOTHING`.
- **`refundTokenAmount(userId, tokens, reason, usageId?)`** — partial reversal (e.g. voice batch where some items fail). Separate idempotency namespace (`operation = 'partial_refund'`). Full and partial refunds for one `usageId` are mutually exclusive by contract.

### Grant / purchase / webhook

- **`web/src/app/api/stripe/webhook/route.ts`** — subscription lifecycle + one-time token packs. Event-level idempotency via claim/finalize. Token-pack credit via `creditAddonTokens` (idempotent on the payment intent). This is where a subscription's metered Price, if ever attached, would surface on `invoice.paid`.
- **`web/src/app/api/billing/checkout/route.ts`** — creates the Stripe Customer (persists `stripeCustomerId`) and the subscription Checkout session. The Customer id that metering maps to is created here.

### Schema (`web/src/lib/db/schema.ts`)

- `users`: `stripeCustomerId` (nullable until first checkout), `tier`, `monthlyTokens`/`monthlyTokensUsed`/`addonTokens`/`earnedCredits`.
- `tokenUsage`: `id` uuid PK (the `usageId`), `userId`, `operation`, `tokens`, `source` (`monthly|addon|mixed`), `provider`, `metadata` jsonb, `createdAt`. Refund rows are negative-`tokens` entries with `operation IN ('refund','partial_refund')` and `metadata->>'refundedUsageId'`.
- `tokenPurchases`: prepaid add-on packs, idempotent on the payment intent.

### Client

- **`web/src/stores/userStore.ts`** fetches `/api/tokens/balance` (ledger-derived) for display and gates `canUseAI` off tier/entitlements. Metering does not touch this — the balance the user sees is the ledger, unchanged.

### Pricing constants (`web/src/lib/tokens/pricing.ts`)

- `TOKEN_COSTS` (per-operation cost), `TIER_MONTHLY_TOKENS` (`starter 50 / hobbyist 300 / creator 1000 / pro 3000`), `TOKEN_PACKAGES` (prepaid add-on packs). These define the "included credits" a metered overage Price would sit above.

---

## 2. Meter Model

### Recommendation: one meter, `generation_tokens`, sum aggregation

Verified against the installed SDK (`stripe@22.3.1`, `stripe.billing.meters.create`) and the live docs (`https://docs.stripe.com/api/billing/meter/create`).

```ts
// one-time provisioning (script or Stripe Dashboard), NOT in the request path
stripe.billing.meters.create({
  display_name: 'Generation Tokens',
  event_name: 'generation_tokens',
  default_aggregation: { formula: 'sum' },      // enum: 'sum' | 'count' | 'last'
  value_settings: { event_payload_key: 'value' },
  customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
});
```

- **`formula: 'sum'`** — invoice value is the sum of each event's `value` (our per-generation `tokenCost`), matching how the ledger charges.
- **`customer_mapping.type: 'by_id'`** with payload key `stripe_customer_id` — maps each event to a Stripe Customer by its id. We already persist `stripeCustomerId`.
- **`value_settings.event_payload_key: 'value'`** — the meter reads the numeric usage from `payload.value`.

### Rejected alternative: per-generation-type meters

One meter per operation family (`generation_3d`, `generation_voice`, …) would let Stripe price each type differently, but:

- It multiplies provisioning, reconciliation, and Price-attachment surface by ~12.
- Our tokens are already a normalized unit (`TOKEN_COSTS` bakes per-type cost into a single "token" currency), so a single `sum` meter over tokens is the correct billing grain.
- Per-type analytics is still available without extra meters: attach a non-billing dimension field (e.g. `payload.operation`) to each event for Stripe's usage breakdowns, while billing stays on the one meter.

**Decision: one `generation_tokens` meter; carry `operation` as an analytics-only payload dimension.**

### Metered overage Prices (a later rollout phase)

For overage beyond included credits: a graduated metered Price per tier whose first-N units (N = `TIER_MONTHLY_TOKENS[tier]`) cost nothing and units beyond are priced. The first rollout does not attach any Price — see Rollout, and the prepaid-vs-postpaid tension in Open Questions. Shadow mode attaches no Price at all.

---

## 3. Reporting Pipeline

### Where it hooks: `after()` in `createGenerationHandler`, on net-confirmed success

New module **`web/src/lib/billing/meterEvents.ts`** exporting `reportGenerationUsage(args)`. Fire-and-forget, never throws, never awaited on the response path. Wired at the existing `after()` seam(s) in `createGenerationHandler` — the same mechanism already used for the QStash callback, so it adds zero latency to the generation and cannot fail the user's request.

```ts
// web/src/lib/billing/meterEvents.ts (design sketch — not final code)
export async function reportGenerationUsage(args: {
  stripeCustomerId: string | null;
  usageId: string | undefined;   // token_usage.id
  tokenCost: number;
  operation: string;
  metered: boolean;              // ResolvedKey.metered
  createdAt?: Date;              // event timestamp; defaults to now
}): Promise<void> {
  if (!isBillingMetersEnabled()) return;          // env flag → fully dormant
  if (!args.metered || !args.usageId) return;      // BYOK / free → never meter
  if (args.tokenCost <= 0) return;
  if (!args.stripeCustomerId) {                    // paid user without a customer id: anomaly
    captureException(new Error('metered usage without stripe_customer_id'),
      { action: 'meter_event', usageId: args.usageId });
    return;
  }
  try {
    await getStripe().billing.meterEvents.create({
      event_name: 'generation_tokens',
      identifier: args.usageId,                    // upstream idempotency key
      timestamp: toUnixWithin35d(args.createdAt),  // clamp to allowed window
      payload: {
        value: String(args.tokenCost),
        stripe_customer_id: args.stripeCustomerId,
        operation: args.operation,                 // analytics dimension only
      },
    });
  } catch (err) {
    captureException(err, { action: 'meter_event', usageId: args.usageId });
    // Dropped events are recovered by reconciliation (section 6), never by blocking or retrying inline.
  }
}
```

Verified shape (`stripe.billing.meterEvents.create`, live doc `https://docs.stripe.com/api/billing/meter-event/create`): `event_name` (≤100 chars), `payload` (must contain the value + customer keys), optional `identifier` (≤100 chars), optional `timestamp`.

### Why "net-confirmed success", not "at deduction"

The ledger deducts before `execute` and refunds on failure. If we metered at deduction time we would over-count every failed-then-refunded generation and have to emit a compensating event for each. Instead we meter at the point the charge becomes final:

- **Synchronous routes** (SFX, texture, image inline, chat-style): emit from `after()` in `createGenerationHandler` only when `execute` resolves. A provider failure refunds and never reaches the emit — no meter event, no reversal needed.
- **Asynchronous routes** (Meshy 3D, Suno music, Replicate — provider job id + status route + QStash callback): the charge is not final at submission; the job can still fail and refund hours later via the poller/callback. Emit at the finalization path (the QStash callback handler / `…/status` route) when the job resolves as truly succeeded (`succeededButEmpty === false`), for the net tokens kept after any partial refund. This keeps the meter aligned with the exact lifecycle point at which the ledger stops being able to refund.

The result: at most one positive meter event per `usageId`, for the net amount actually kept. In the common paths, no negative/compensating events are ever needed.

### Metered vs BYOK vs free

Only `ResolvedKey.metered === true` (platform key, paid tier, real deduction with a `usageId`) is reported. BYOK (`metered: false`, no `usageId`) and free ops (`tokenCost === 0`) are skipped at the top of `reportGenerationUsage`.

---

## 4. Idempotency & Timestamp Constraints

### Stripe's guarantees (verified, live docs)

- **`identifier` uniqueness is enforced only over a rolling period of at least 24 hours.** It exists to absorb accidental retries within extremely brief intervals — it is not a durable dedupe key.
- **`timestamp` must be within the past 35 calendar days or up to 5 minutes in the future.**

### Our rules

1. **`identifier = usageId`.** The `token_usage.id` uuid is globally unique and permanent, so within Stripe's 24h window it perfectly dedupes a same-request retry (e.g. two `after()` fires, a QStash redelivery). Uniqueness beyond 24h is our concern, handled by rule 2.

2. **At-most-once emission at the source — no blind backfill.** Because Stripe only dedupes for 24h, re-emitting an old `usageId` after 24h would double-count. Emission therefore happens exactly once, inline at the finalization lifecycle point. We add a durable "already metered" marker so no path re-emits:
   - Add **`token_usage.metered_at timestamptz null`** (new nullable column, additive migration). Set it in the same fire-and-forget path after a successful `meterEvents.create`. Any repair/backfill (rule 4) filters `WHERE metered_at IS NULL`, so a row is metered at most once regardless of how many times a repair runs.

3. **`timestamp = token_usage.createdAt`, clamped.** Use the deduction time as the event time so the meter reflects when usage occurred, not when we happened to report it. Clamp into the allowed window: never older than 34 days (one-day margin under the 35-day limit) and never more than 4 minutes in the future (margin under 5). A row older than 34 days cannot be reported at its true time — see rule 4.

4. **Backfill / replay rules.** A reconciliation-driven repair (section 6) may emit only for rows with `metered_at IS NULL` and `createdAt` within the last 34 days, using `identifier = usageId` and `timestamp = createdAt`. Rows older than 34 days fall outside Stripe's timestamp rule and must be recorded as permanent drift (logged, surfaced in reconciliation), never force-emitted with a "now" timestamp (that would misattribute usage to the wrong billing period). This bounds the maximum recoverable drift window to 34 days — which is why reconciliation must run daily, well inside that window.

---

## 5. Refund Semantics

Because we meter the net-confirmed amount (section 3), the dominant refund cases need no meter reversal:

- **Provider failure on a sync route** → `refundTokens` runs before response; the success emit never fires. No meter event, nothing to reverse.
- **Async job fails / empty artifact** → finalization sees failure, refunds, and does not emit.
- **Partial batch failure** (`refundTokenAmount`) → the async finalization emits the net kept tokens (`tokenCost − refundedAmount`), so the meter is already correct.

The one residual case: a refund that lands after a meter event was already emitted — e.g. the poller's `handleCompletion` catch refunds on a post-success download/import failure (expired URL, invalid GLB), potentially minutes-to-hours later. Handling:

- **Preferred: compensating negative-value meter event**, `identifier = ${usageId}:refund`, `payload.value = String(-refundedTokens)`. A `sum` meter nets it against the original. This works regardless of elapsed time (within the 35-day timestamp window).
- **Not used for refunds: `meterEventAdjustments.create` (cancel).** Verified in the installed SDK (`stripe.billing.meterEventAdjustments`, param doc): you can only cancel events within 24 hours of Stripe receiving them. That window is too short to guarantee a late refund can be reversed, so adjustments are at best a same-day optimization, never the mechanism of record.

> **Open question (must be de-risked before any metered Price is attached):** does a `sum` billing meter accept negative `payload.value` and net it correctly on the invoice, or does it clamp/reject? Stripe's usage meters are designed around non-negative usage. This must be validated with a test-mode spike. In shadow mode nothing is invoiced, so even if negative events are imperfect the only impact is a reconciliation discrepancy we already detect — which is why shadow mode must run a full cycle first.

---

## 6. Reconciliation Job

A scheduled job (Vercel cron or QStash schedule) compares the ledger against Stripe's aggregation per customer per window and alerts on drift.

- **Ledger net (source of truth):** `SUM(token_usage.tokens)` over the window for platform deductions minus refund rows (`operation IN ('refund','partial_refund')`, whose `tokens` are negative and already sum in). Grouped by `stripeCustomerId`.
- **Stripe aggregate:** `stripe.billing.meters.listEventSummaries(meterId, { customer, start_time, end_time, value_grouping_window })` — verified in the installed SDK (`stripe.billing.meters.listEventSummaries`) and live docs. Returns `MeterEventSummary { aggregated_value, start_time, end_time, meter, … }`. Constraint: `start_time`/`end_time` must align to hour or day boundaries per `value_grouping_window` — align the reconciliation window to UTC day boundaries.
- **Drift check:** if `abs(ledgerNet − aggregatedValue) > max(absoluteFloor, driftRatio × ledgerNet)`, `captureException` a Sentry alert tagged with `stripeCustomerId`, window, both totals, and the count of `metered_at IS NULL` rows in-window (the likely dropped events). Thresholds live in config, not hard-coded.
- **Self-repair (bounded):** for in-window rows with `metered_at IS NULL` and `createdAt` within 34 days, re-emit per section 4 rule 4 and set `metered_at`. Rows beyond 34 days are logged as permanent drift.

Cadence: daily, over the trailing UTC day, so drift is always caught inside the 34-day backfill window.

---

## 7. Rollout

Env flag **`BILLING_METERS_ENABLED`** (or equivalent) gates every emission; unset → the entire feature is dormant and the code path is a single early `return`.

- **Phase 0 — Shadow (report, never invoice).** Create the `generation_tokens` meter in test then live. Turn on emission. Attach no Price to any tier. No customer is billed a cent. Run the daily reconciliation. Duration: one full billing cycle (≥30 days).
  - **No-go criteria (any one blocks advancement):** reconciled drift > threshold on any day; observed meter-event drop rate > threshold; any measurable latency regression on `/api/generate/*` (metering must be invisible on the request path); any `meterEvents.create` error that escapes the fire-and-forget swallow; negative-value meter behavior (section 5) unverified.
- **Phase 1 — Verify.** Confirm `listEventSummaries` matches the ledger across the full cycle and that Stripe usage dashboards render as expected. Resolve the negative-value open question in test mode.
- **Phase 2 — Invoice (only after Phase 1 passes + business sign-off).** Attach a graduated metered overage Price (free allotment = tier allocation) to tiers, after resolving the prepaid-add-on vs postpaid-overage tension (Open Questions) and confirming the >100M-events "contact sales" caveat is irrelevant at our volume. The ledger remains the real-time gate throughout — metered overage changes only what Stripe invoices, never how a request is authorized.

---

## 8. Decision: Augment, Not Replace

**Recommendation: augment.** Keep the Postgres ledger as the source of truth for real-time gating; add Stripe meters as an eventually-consistent billing/analytics mirror.

| Dimension | Ledger stays authoritative (AUGMENT — recommended) | Stripe meters replace the ledger |
|---|---|---|
| Real-time gate latency | Atomic SQL UPDATE, sub-ms, in-request (< 1ms budget) | A Stripe API round-trip on the critical generation path — breaks the latency budget |
| Atomicity | `deduct + token_usage` insert is one CTE — never charge without a record | Meter event + local state are two systems; no cross-system transaction |
| Idempotency horizon | Durable UNIQUE index, permanent | Stripe `identifier` dedupes only ~24h — unusable as the idempotency source |
| Refund model | Battle-tested full/partial refund with per-namespace idempotency | Negative events / 24h-limited adjustments; weaker, unproven for our cases |
| 3-pool waterfall + rollover | Encoded in SQL (`monthly → addon → earned`, tier rollover caps) | No Stripe primitive for prepaid multi-pool waterfall |
| Offline / Stripe outage | Generation still gated correctly from local balance | Stripe unavailability would block or mis-gate generations |
| Overage invoicing | Add a metered Price in a later phase without moving the gate | Native, but at the cost of everything above |
| Blast radius | Additive, dormant-by-default, reversible | Rewrites the most safety-critical money path |

**Rationale:** the ledger's real-time balance gate, atomic deduct+record, refund idempotency, multi-pool waterfall, and rollover are all latency-critical and already hardened through multiple incident fixes. Stripe meters are eventually consistent, cannot gate a request synchronously, and dedupe for only 24h. Replacing would put a network call on the generation critical path and forfeit the atomic charge guarantee. Augmenting gets Stripe usage dashboards and optional overage billing at near-zero risk, fully reversible via one env flag.

---

## Cost Model

- **$0 incremental at our volume.** Meter events are included in the Billing fee we already pay on subscriptions; the plan includes up to 100M meter events/month. We emit one event per successful platform generation — orders of magnitude below 100M even at aggressive growth (1M generations/mo ≈ 1% of the allotment).
- **>100M-events "contact sales" overage:** not a concern at current or near-term scale. Revisit only if monthly platform generations approach 8 figures.
- **No SDK/infra cost:** `stripe@22.3.1` already ships `billing.meters`, `billing.meterEvents`, `billing.meterEventSummaries`, and `billing.meterEventAdjustments`. No dependency change → no lockfile/relock exposure.

---

## Acceptance Criteria (for the eventual implementation)

- **Given** a paid-tier user with a `stripeCustomerId` who triggers a platform generation that succeeds, **When** the response returns, **Then** exactly one `generation_tokens` meter event is emitted with `identifier = usageId`, `payload.value = tokenCost`, `payload.stripe_customer_id = stripeCustomerId`, and `token_usage.metered_at` is set — and the response latency shows no measurable regression vs. the pre-metering baseline.
- **Given** a BYOK generation or a free (`tokenCost === 0`) operation, **When** it completes, **Then** no meter event is emitted.
- **Given** a provider failure that triggers `refundTokens`, **When** the request returns, **Then** no positive meter event exists for that `usageId`.
- **Given** a post-success refund (poller `handleCompletion` catch), **When** the refund lands, **Then** a compensating negative event `${usageId}:refund` nets the original to zero on a `sum` meter (pending the negative-value verification).
- **Given** two rapid retries of the same emission within 24h, **When** both call `meterEvents.create` with the same `usageId` identifier, **Then** Stripe records the usage once.
- **Given** `meterEvents.create` throws (Stripe 5xx/timeout), **When** the emit fails, **Then** the user's generation still succeeds, the error is captured to Sentry, and `metered_at` stays null so reconciliation can repair it.
- **Given** a day's ledger net and Stripe `listEventSummaries` for a customer, **When** the reconciliation job runs, **Then** matching totals pass silently and a drift beyond threshold fires a Sentry alert naming the customer and both totals.
- **Given** `BILLING_METERS_ENABLED` is unset, **When** any generation runs, **Then** no Stripe meter call is made and behavior is byte-identical to today.
- **Given** a `token_usage` row older than 34 days with `metered_at IS NULL`, **When** reconciliation repair runs, **Then** it is not re-emitted (timestamp window) and is logged as permanent drift.

---

## Constraints

- **No SDK bump, no `apiVersion` change** — `stripe@22.3.1` / `2026-06-24.dahlia` already covers Billing Meters. Do not touch `web/src/lib/billing/stripe-client.ts`'s pinned version.
- **neon-http:** the `metered_at` write is a single `UPDATE`; no `db.transaction()`. Any multi-statement reconciliation write uses `getNeonSql().transaction([...])`. Follow the `queryWithResilience(() => getNeonSql()…)` pattern; never `const db = getDb()`.
- **Latency:** metering must be off the request path (`after()`), never awaited before the response, never inside the deduction CTE. Command/gate latency budget < 1ms must be unaffected.
- **`createGenerationHandler` is a single point of failure** — all 12 generate routes flow through it. Any change there must run the full `createGenerationHandler` integration suite.
- **Timestamp window:** clamp to 34 days past / 4 min future (margins under Stripe's 35 day / 5 min).
- **Additive, dormant, reversible:** new nullable column, new module, env-flag-gated; no change to existing responses, balances, or the webhook when the flag is off.

---

## Follow-up Ticket Slices (titles + one-liners — not created as part of PF-966)

1. **Provision `generation_tokens` meter (test + live) + env flag** — one-time `meters.create` script/runbook; add `BILLING_METERS_ENABLED` gate; dormant by default.
2. **`meterEvents.ts` reporter + `metered_at` migration** — fire-and-forget `reportGenerationUsage`, additive nullable `token_usage.metered_at` column, unit tests for the skip/emit matrix (BYOK, free, no-customer, disabled).
3. **Wire net-success metering into sync generate routes** — emit via `after()` in `createGenerationHandler` on `execute` success; integration tests through the factory.
4. **Wire metering into async finalization (QStash callback + status routes)** — emit net-kept tokens at true job success; cover partial-refund netting.
5. **Late-refund compensating events + negative-value spike** — `${usageId}:refund` negative events on post-success refund; test-mode verification that a `sum` meter nets negatives (gate for Phase 2).
6. **Daily reconciliation job + Sentry drift alert** — cron/QStash schedule comparing ledger net vs `listEventSummaries`; bounded self-repair of `metered_at IS NULL` rows within 34 days.
7. **Shadow-mode rollout + one-cycle verification runbook** — enable emission with no Price attached; dashboards; no-go checklist; sign-off gate.
8. **Graduated metered overage Price attachment (Phase 2, gated)** — free allotment = tier allocation; resolve prepaid-vs-postpaid tension; webhook handling of metered invoice lines.

---

## Open Questions (need user judgment)

1. **Prepaid add-on packs vs postpaid metered overage.** Today, over-allocation usage is funded by prepaid `TOKEN_PACKAGES`. Metered overage is postpaid (billed in arrears). Phase 2 must choose: keep add-ons and meter only for analytics; replace add-ons with postpaid overage; or run both (prepaid drawn first, meter only truly-postpaid units). This is a pricing/product decision, not a technical one.
2. **Negative-value meter events on a `sum` meter** — must be verified in test mode before Phase 2 (section 5). If Stripe rejects negatives, late refunds need a separate credit-meter or invoice-time credit note instead.
3. **Which lifecycle point counts as "final" for each async provider** — confirm the exact finalization hook per provider (Meshy/Suno/Replicate) so metering fires once, after the last possible refund.
