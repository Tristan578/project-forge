# Stripe Billing Patterns

## Configuration
- SDK: `stripe` (Node.js)
- Tiers: Starter ($9), Hobbyist ($19), Creator ($29), Studio ($79)
- Lifecycle: @web/src/lib/billing/subscription-lifecycle.ts
- Idempotency: @web/src/lib/billing/webhookIdempotency.ts (DB-backed, not in-memory)
- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (server-only)

## Webhook Events Handled
- `checkout.session.completed` -- new subscription
- `customer.subscription.updated` -- tier change (upgrade/downgrade)
- `invoice.paid` -- monthly renewal (rollover + grant tokens)
- `invoice.payment_failed` -- grace period
- `customer.subscription.deleted` -- cancellation (revert to free)
- `charge.refunded` -- reverse addon token credits

## Gotchas
1. **Idempotency is DB-backed** (not in-memory Set). Critical for Vercel cold starts -- in-memory would re-process events after function restart.
2. **Webhook timing**: Webhooks can arrive BEFORE checkout redirect completes. Handle gracefully.
3. **`handleChargeRefunded` call-site mismatch**: Known bug (PF-718, PF-724). Verify function signature matches caller.
4. **Token refund on generation failure**: Generate routes MUST refund tokens when provider call fails (PF-666, PF-743).
5. **Transaction atomicity**: Tier changes + token grants should be wrapped in DB transactions (PF-521).
6. **`reverseAddonTokens` calculation**: Must deduct from addon balance, not total balance (PF-734).

## Testing
- Mock `stripe` SDK in tests
- Test files: `web/src/lib/billing/__tests__/`
- Never hit real Stripe API in tests
