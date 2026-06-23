---
"web": minor
---

Add Stripe Radar fraud-review handling for token-pack purchases. When Radar flags a one-time token-pack payment for manual review, the token credit grant is now held until the review clears: tokens are released only when Stripe closes the review as approved, and a refunded/fraud close or a dispute grants nothing (and reverses any credit that did land). Gated behind the `STRIPE_RADAR_REVIEW_HOLD` env flag — inert (credit-immediately, pre-existing behaviour) until enabled and the Dashboard Radar rules are provisioned.
