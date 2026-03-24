# Spec: Stripe Connect for Creator Revenue Sharing

> **Status:** DRAFT — Awaiting Approval
> **Date:** 2026-03-24
> **Ticket:** PF-644
> **Scope:** Integrate Stripe Connect to enable game creators to receive payouts from game revenue (ads, in-app purchases, marketplace sales).

## Problem

SpawnForge is a two-sided marketplace: creators build games, players play them. Creators should earn revenue from their published games. The platform needs to:
1. Let creators connect a payout destination (bank account or debit card)
2. Track revenue per game (ad impressions, potential IAP, marketplace asset sales)
3. Calculate platform fees and creator shares
4. Schedule and execute payouts
5. Provide revenue dashboards for creators and platform admins

PF-574 (monetization toolkit) is blocked on having a payment split infrastructure.

## Technology Evaluation

### Stripe Connect Account Types

| Type | Description | Fit for SpawnForge |
|------|-------------|-------------------|
| **Standard** | Creator manages their own Stripe Dashboard. Full Stripe account. Lowest platform liability. | Poor — too much friction. Creators are not merchants. |
| **Express** | Stripe-hosted onboarding. Creator has limited Stripe Dashboard. Platform controls payouts. | Best — minimal friction, Stripe handles KYC/tax, platform controls timing. |
| **Custom** | Platform builds all UI. Maximum control, maximum compliance burden. | Overkill — we are not a fintech product. |

### Recommendation: Express Accounts

**Rationale:** Express accounts provide the right balance. Stripe handles identity verification (KYC), tax form collection (1099-K in the US), and provides a lightweight dashboard for creators to see their earnings. SpawnForge controls when payouts happen and what percentage goes to the platform. Onboarding is a Stripe-hosted flow that takes 5-10 minutes.

### Revenue Model

| Revenue Source | Platform Fee | Creator Share | Status |
|---------------|-------------|--------------|--------|
| Ad revenue (future, PF-574) | 30% | 70% | Not yet implemented |
| Marketplace asset sales | 20% | 80% | Marketplace exists (schema), no real money yet |
| In-app purchases (future) | 30% | 70% | Not yet implemented |
| Token-based tips (future) | 15% | 85% | Not yet implemented |

Platform fees are configurable per revenue source via the admin dashboard.

## Solution

### Architecture Overview

```
Creator
  |
  | "Connect Stripe Account" button in Creator Dashboard
  |
  v
/api/connect/onboard  →  Stripe Account Link (Express)
  |                         |
  |                         v
  |                     Stripe-hosted KYC flow
  |                         |
  |                         v
/api/connect/callback  ←  redirect back
  |
  | Store connected account ID in DB
  |
  v
Revenue Events (ads, sales, tips)
  |
  | Recorded in revenue_events table
  |
  v
Payout Cron (weekly, configurable)
  |
  | Calculate creator share
  | Create Stripe Transfer to connected account
  | Record in payout_history table
  |
  v
Creator Revenue Dashboard
  |
  | GET /api/connect/earnings
  | GET /api/connect/payouts
  |
  v
Admin Platform Revenue Dashboard
  |
  | GET /api/admin/revenue (existing admin area)
```

### Data Model (Drizzle Schema)

```typescript
// Creator's connected Stripe account
export const creatorConnectAccounts = pgTable(
  'creator_connect_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id).unique(),
    stripeAccountId: text('stripe_account_id').notNull().unique(),
    chargesEnabled: integer('charges_enabled').notNull().default(0),
    payoutsEnabled: integer('payouts_enabled').notNull().default(0),
    detailsSubmitted: integer('details_submitted').notNull().default(0),
    country: text('country'), // ISO 3166-1 alpha-2
    defaultCurrency: text('default_currency').default('usd'),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_cca_stripe_account').on(table.stripeAccountId),
  ]
);

export const revenueSourceEnum = pgEnum('revenue_source', [
  'ad_impression', 'ad_click', 'marketplace_sale', 'iap', 'tip',
]);

// Individual revenue events (immutable ledger)
export const revenueEvents = pgTable(
  'revenue_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id').references(() => publishedGames.id),
    creatorId: uuid('creator_id').notNull().references(() => users.id),
    source: revenueSourceEnum('source').notNull(),
    grossAmountCents: integer('gross_amount_cents').notNull(),
    platformFeeCents: integer('platform_fee_cents').notNull(),
    creatorShareCents: integer('creator_share_cents').notNull(),
    currency: text('currency').notNull().default('usd'),
    referenceId: text('reference_id'), // external ID (ad network impression ID, asset purchase ID)
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_re_creator_date').on(table.creatorId, table.createdAt),
    index('idx_re_game_date').on(table.gameId, table.createdAt),
    index('idx_re_source').on(table.source),
  ]
);

export const payoutStatusEnum = pgEnum('payout_status', [
  'pending', 'processing', 'paid', 'failed', 'cancelled',
]);

// Payout batches (one per creator per payout cycle)
export const payoutHistory = pgTable(
  'payout_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: uuid('creator_id').notNull().references(() => users.id),
    stripeTransferId: text('stripe_transfer_id'),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('usd'),
    status: payoutStatusEnum('status').notNull().default('pending'),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    revenueEventCount: integer('revenue_event_count').notNull().default(0),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_ph_creator_date').on(table.creatorId, table.createdAt),
    index('idx_ph_status').on(table.status),
  ]
);

// Platform fee configuration (admin-editable)
export const platformFeeConfig = pgTable(
  'platform_fee_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: revenueSourceEnum('source').notNull().unique(),
    feePercentBps: integer('fee_percent_bps').notNull(), // basis points, e.g. 3000 = 30%
    minPayoutCents: integer('min_payout_cents').notNull().default(1000), // $10 minimum
    payoutSchedule: text('payout_schedule').notNull().default('weekly'), // weekly | biweekly | monthly
    active: integer('active').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }
);
```

### API Design

#### Connect Onboarding

```
POST /api/connect/onboard
Auth: Clerk (creator tier or higher)
Body: (none)
Response: 302 redirect to Stripe Account Link URL

Flow:
1. Check if user already has a connected account
2. If not, create Express account via Stripe API
3. Generate Account Link with return_url and refresh_url
4. Redirect user to Stripe-hosted onboarding
```

```
GET /api/connect/callback
Auth: Clerk
Query: (Stripe redirects here after onboarding)
Response: 302 redirect to /dashboard/earnings

Flow:
1. Retrieve account from Stripe
2. Update chargesEnabled, payoutsEnabled, detailsSubmitted
3. Redirect to creator earnings dashboard
```

```
GET /api/connect/status
Auth: Clerk
Response: {
  connected: boolean,
  chargesEnabled: boolean,
  payoutsEnabled: boolean,
  detailsSubmitted: boolean,
  stripeLoginUrl?: string  // Link to Express Dashboard
}
```

#### Revenue & Payouts

```
GET /api/connect/earnings?period=30d
Auth: Clerk (own earnings only)
Response: {
  totalGross: number,
  totalFees: number,
  totalNet: number,
  bySource: { ad_impression: number, marketplace_sale: number, ... },
  daily: [{ date: string, gross: number, net: number }]
}
```

```
GET /api/connect/payouts
Auth: Clerk (own payouts only)
Response: {
  payouts: [{ id, amount, status, periodStart, periodEnd, paidAt }],
  nextPayoutDate: string,
  pendingAmount: number
}
```

#### Admin Endpoints

```
GET /api/admin/revenue/overview
Auth: Clerk (admin role)
Response: {
  totalPlatformRevenue: number,
  totalCreatorPayouts: number,
  activeConnectedAccounts: number,
  pendingPayouts: number,
  bySource: { ... }
}
```

```
PUT /api/admin/revenue/fees
Auth: Clerk (admin role)
Body: { source: string, feePercentBps: number, minPayoutCents: number }
Response: { updated: true }
```

#### Webhook Events (Stripe Connect)

Add to existing `/api/stripe/webhook/route.ts`:

```
account.updated → Update chargesEnabled/payoutsEnabled/detailsSubmitted
transfer.created → Update payout status to 'processing'
transfer.paid → Update payout status to 'paid', set paidAt
transfer.failed → Update payout status to 'failed', set errorMessage
```

### Payout Cron Job

A Vercel Cron Job runs weekly (Monday 06:00 UTC) to:

1. Query all creators with `payoutsEnabled = true` and unpaid revenue events (`payoutId IS NULL`)
2. For each creator:
   a. Create a `payout_history` record with status `'pending'` and a unique `idempotencyKey` (e.g. `payout:{creatorId}:{periodEnd}`)
   b. Atomically mark matching `revenue_events` with the new `payoutId` (`UPDATE revenue_events SET payout_id = ? WHERE creator_id = ? AND payout_id IS NULL AND created_at < ?`)
   c. Sum `creator_share_cents` from the now-claimed events
   d. Skip if below `min_payout_cents` threshold ($10 default) — reset `payoutId` on claimed events
   e. Create a Stripe Transfer with `idempotency_key` matching the payout record
   f. Update `payout_history` status to `'completed'` with the Stripe transfer ID
3. On retry: events already claimed by a `payoutId` are excluded from re-summation. The Stripe `idempotency_key` prevents duplicate transfers even if the cron fires twice.
4. Send notification to creators with successful payouts (future: email via Clerk)

### Creator Dashboard UI

A new `/dashboard/earnings` page with:
- Revenue overview (gross, fees, net)
- Revenue by source breakdown (pie chart)
- Daily revenue trend (line chart)
- Payout history table
- "Connect Stripe Account" button (if not connected)
- Link to Stripe Express Dashboard (if connected)

This page is gated behind the `creator` or `pro` tier. Starter and hobbyist users see an upgrade prompt.

## Cost Estimate

| Component | Cost | Notes |
|-----------|------|-------|
| Stripe Connect fees | 0.25% + $0.25 per payout | Paid by platform (deducted from platform fee) |
| Stripe transfer fees | $0 for Standard pricing | Transfers to connected accounts are free |
| Neon storage | $0 (included) | 4 new tables, minimal row count initially |
| Vercel Cron | $0 (included) | 1 weekly cron |
| **Total Phase 1** | **~$0.25 per payout** | Effectively free until creators generate revenue |

At scale with 1000 weekly payouts: ~$500/month in Stripe fees, covered by the 20-30% platform fee.

## Security Considerations

1. **Stripe secret key isolation** — Connect operations use the same `STRIPE_SECRET_KEY` with `stripeAccount` parameter for connected account scoping
2. **Webhook signature verification** — All Connect webhooks verified against `STRIPE_WEBHOOK_SECRET` (existing pattern)
3. **Idempotent payouts** — Use existing `webhookEvents` table for transfer event deduplication
4. **Creator can only see own data** — All earnings/payout endpoints filter by authenticated user's ID
5. **Admin-only fee configuration** — Fee changes require admin role verification
6. **Minimum payout threshold** — Prevents micro-transfers that erode margins to fees
7. **No direct access to connected account credentials** — Express accounts are managed entirely through Stripe's API
8. **Audit trail** — `revenue_events` table is append-only (immutable ledger). No UPDATE/DELETE operations.

## Phased Implementation Plan

### Phase 1: Connect Onboarding + Revenue Tracking (this ticket)
1. Add Drizzle schema tables (4 tables, 2 enums)
2. Implement Connect onboarding flow (3 API routes)
3. Implement Connect webhook handlers (4 event types)
4. Implement revenue event recording (internal service, not exposed as API)
5. Implement creator earnings dashboard (2 API routes + page)
6. Add platform fee configuration to admin dashboard
7. Tests: onboarding flow, revenue calculation, fee splitting, webhook handling

### Phase 2: Automated Payouts (after ad revenue exists)
8. Implement payout cron job
9. Implement Stripe Transfer creation
10. Implement payout history API and UI
11. Payout failure handling and retry logic

### Phase 3: Advanced Revenue Features (future)
12. In-app purchase integration (PF-574)
13. Creator tax document management (Stripe handles 1099-K)
14. Revenue analytics in AI chat (MCP commands for revenue queries)
15. Tiered fee structures (lower fees for higher-volume creators)
16. Instant payouts (Stripe Instant Payouts, additional fee)

## Acceptance Criteria

- Given a creator-tier user, When they click "Connect Stripe Account", Then they are redirected to Stripe's Express onboarding flow
- Given a creator completing onboarding, When Stripe redirects back, Then their connected account status is stored and displayed correctly
- Given a marketplace asset sale, When the purchase completes, Then a revenue event is created with the correct platform fee and creator share
- Given a creator with $15 in unpaid earnings, When the weekly payout cron runs, Then a Stripe Transfer is created for $15 to their connected account
- Given a creator with $5 in unpaid earnings (below $10 threshold), When the weekly payout cron runs, Then no payout is created and the balance carries forward
- Given the admin dashboard, When viewing platform revenue, Then total revenue, creator payouts, and platform fees are visible and accurate

## Alternatives Considered

1. **PayPal Payouts** — Rejected. We already use Stripe for subscriptions and token purchases. Adding PayPal doubles payment provider complexity. Stripe Connect is the natural extension of our existing Stripe integration.

2. **Manual payouts** — Rejected. Does not scale. Manual bank transfers require manual accounting, tax document collection, and introduce operational risk.

3. **Platform token payouts (internal currency)** — Rejected for primary payouts. Creators want real money, not platform credits. However, token-based tips could supplement real-money payouts as a separate feature.

4. **Custom Connect (build all UI ourselves)** — Rejected. The compliance burden (KYC, sanctions screening, tax reporting) is enormous. Express accounts delegate this entirely to Stripe.
