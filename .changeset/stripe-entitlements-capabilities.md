---
"web": minor
---

Adopt the Stripe Entitlements API for product capability gating. The
`entitlements.active_entitlement_summary.updated` webhook now persists each
customer's active feature lookup_keys to `users.active_features`, and the web
client maps those features onto `canUseAI` / `canUseMCP` / `canPublish`. When no
entitlement summary has been synced (or Entitlements is not configured in the
Stripe dashboard), gating falls back to the existing tier-derived defaults, so
the change is purely additive and never strips access from an existing user.
