---
"web": minor
---

Enable Stripe Tax on subscription Checkout. When `STRIPE_TAX_ENABLED=true`, the
billing checkout route turns on `automatic_tax`, collects the customer's billing
address (and an optional tax ID), and persists the address back onto the Stripe
customer. The integration is guarded so it stays inert until Stripe Tax and the
relevant tax registrations are provisioned in the dashboard — keeping CI, prod,
and existing checkout behaviour unchanged when the flag is off.
