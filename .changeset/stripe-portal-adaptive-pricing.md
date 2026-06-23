---
"web": minor
---

Deepen the Stripe Customer Portal billing route: support pinning a portal
configuration via `STRIPE_PORTAL_CONFIGURATION_ID` (plan switching across the
4 tiers, payment-method update, cancellation retention coupon) and a
`?flow=cancel` deep-link into the cancellation/retention flow. All additions
are env- and subscription-guarded, so the portal keeps working against the
Stripe Dashboard default configuration with no provisioning.
