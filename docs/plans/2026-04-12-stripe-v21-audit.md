# Stripe v21 Upgrade Audit

> **Status:** COMPLETE — Audit only, no code changes
> **Date:** 2026-04-12
> **Scope:** Document all breaking changes and migration steps for stripe@20 → stripe@21

## Summary

**Risk level: LOW.** The codebase has zero `decimal_string` field usage — all monetary
amounts are integer cents. The upgrade requires only an `apiVersion` string update
across 4 files and a package version bump.

## Breaking Changes in Stripe v21

| Change | Impact on SpawnForge |
|--------|---------------------|
| `decimal_string` fields → `Stripe.Decimal` | **None.** Zero usage found. |
| New OAuth error classes | **None.** No OAuth integration. |
| Dropped Node 16 support | **None.** We run Node 22+. |
| `constructEvent` stricter method validation | **None.** We pass `req.text()` (raw string). |
| `LatestApiVersion` type changes | **4 files** need `apiVersion` string updated. |

## Files Using Stripe (5 routes + 2 libraries)

| File | Stripe API Used | Amount Fields | Impact |
|------|----------------|---------------|--------|
| `app/api/stripe/webhook/route.ts` | `webhooks.constructEvent()` | `charge.amount_refunded` (int), `charge.amount` (int) | None |
| `app/api/billing/checkout/route.ts` | `checkout.sessions.create()`, `customers.create()` | None — passes `priceId` only | None |
| `app/api/billing/status/route.ts` | `subscriptions.retrieve()` | `subscription.status` (string) | None |
| `app/api/billing/portal/route.ts` | `billingPortal.sessions.create()` | `session.url` (string) | None |
| `app/api/tokens/purchase/route.ts` | `checkout.sessions.create()` | `session.url` (string) | None |
| `lib/tokens/pricing.ts` | None (internal constants) | `priceCents` (int) | None |
| `lib/billing/subscription-lifecycle.ts` | None (DB operations) | `amount_cents` (int) | None |

## Confirmed: No `decimal_string` Usage

```bash
# Search result: zero matches
grep -r "decimal_string\|Stripe\.Decimal\|unit_amount_decimal\|amount_decimal" web/src/
# (empty)
```

All monetary values are handled as integer cents:
- `charge.amount_refunded` / `charge.amount` — integer (webhook handler)
- `invoice.attempt_count` / `invoice.next_payment_attempt` — integer (webhook handler)
- `priceCents: 1200 | 4900 | 14900` — integer constants (pricing.ts)
- `amount_cents` — integer column in `token_purchases` table

## Migration Checklist

When ready to upgrade (currently pinned at `^20.4.1` per CLAUDE.md gotcha):

### Step 1: Bump package version
```bash
cd web && npm install stripe@21
```

### Step 2: Update apiVersion in 4 files
The `apiVersion` string and `LatestApiVersion` type will change in v21.
Remove the `as Stripe.LatestApiVersion` cast and use the new default:

| File | Current | Action |
|------|---------|--------|
| `app/api/stripe/webhook/route.ts:37` | `'2025-01-27.acacia' as Stripe.LatestApiVersion` | Update to v21 API version |
| `app/api/billing/checkout/route.ts:26` | `'2025-01-27.acacia' as Stripe.LatestApiVersion` | Update to v21 API version |
| `app/api/billing/status/route.ts:38` | `'2025-01-27.acacia' as Stripe.LatestApiVersion` | Update to v21 API version |
| `app/api/billing/portal/route.ts:9` | `'2025-01-27.acacia' as Stripe.LatestApiVersion` | Update to v21 API version |
| `app/api/tokens/purchase/route.ts:18` | `'2025-01-27.acacia' as Stripe.LatestApiVersion` | Update to v21 API version |

### Step 3: Run type check
```bash
cd web && npx tsc --noEmit
```
If any new type errors appear from `decimal_string` → `Stripe.Decimal`,
fix by using `.toString()` on the new `Stripe.Decimal` values.

### Step 4: Run tests
```bash
cd web && npx vitest run src/app/api/stripe/ src/app/api/billing/ src/app/api/tokens/
```

### Step 5: Test webhook locally
```bash
stripe listen --forward-to http://spawnforge.localhost:1355/api/stripe/webhook
stripe trigger charge.refunded
stripe trigger checkout.session.completed
```

### Step 6: Update CLAUDE.md
Remove the "Stripe v21 hold-back" gotcha entry.

## Conclusion

The upgrade is safe to perform at any time. No `decimal_string` fields are accessed,
no OAuth flows exist, and `constructEvent` uses the correct raw-body pattern.
The only required change is updating the `apiVersion` string in 5 files.
