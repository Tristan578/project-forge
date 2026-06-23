---
"web": minor
---

Add server-side step-up re-verification enforcement for sensitive routes (PF-910). A new `requireStepUp()` guard (`web/src/lib/auth/step-up.ts`) demands a recent Clerk re-verification (via `auth().has({ reverification })`) before account deletion, BYOK key writes, and billing checkout/portal actions, returning a 403 with a `REVERIFICATION_REQUIRED` hint otherwise. The per-route policy and the expected Clerk Dashboard protections (MFA/passkeys/bot-protection) are declared as code in `web/src/lib/auth/security-policy.ts`, with an operator runbook at `docs/security/clerk-account-protection.md`. The guard no-ops when Clerk keys are absent, so CI/dev/E2E are unaffected.
