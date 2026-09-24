---
"web": minor
---

Grant every brand-new account a one-time allocation of 50 trial tokens (`TRIAL_GRANT_TOKENS`) on the Clerk `user.created` webhook, so a signed-up user can try AI generation before subscribing. The grant is idempotent at the database (a `trial_grant` row in `credit_transactions` is the arbiter behind the existing partial unique index), never runs on `user.updated`, and a failure is captured in Sentry with `context: trial-token-grant-failure` before the webhook's existing retry path handles it. Adds the P1 alert rule and runbook section 5.9 (#7715).
