---
"web": minor
---

Grant every brand-new account a one-time allocation of 50 trial tokens (`TRIAL_GRANT_TOKENS`) on the Clerk `user.created` webhook, and let a free account spend them: while a `starter` account holds spendable tokens the AI gates (`/api/chat`, the platform-key resolver, the editor's panel gate) treat it as `hobbyist`, so chat and the hobbyist generation panels open until the balance is gone. The free plan's bullets now say "50 trial AI tokens at signup" and "No monthly AI tokens". The grant is idempotent at the database (a `trial_grant` row in `credit_transactions` is the arbiter behind the existing partial unique index), never runs on `user.updated`, and a failure is captured in Sentry with `context: trial-token-grant-failure` before the webhook's existing retry path handles it. Adds the P1 alert rule and runbook section 5.9 (#7715).
