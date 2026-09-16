# Staging and preview verification

Issue #10102 covers previews that Vercel marked ready even though application startup returned HTTP 500, and staging Stripe health that rejected an intentional test-mode account.

The dedicated Vercel project is spawnforge-staging (team tnolan). Its production target serves stable staging; its preview target serves PR deployments. Both must set NEXT_PUBLIC_ENVIRONMENT=staging and retain test Clerk credentials. STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and ENCRYPTION_MASTER_KEY must also include preview in their existing target metadata. Preserve each encrypted or sensitive value and its type; change targets only. Preview DATABASE_URL continues to use the workflow's isolated Neon branch.

Staging startup requires a Stripe secret or restricted key with a test-mode prefix. Production still rejects test-mode Stripe health. A successful test-mode balance read is healthy on staging; HTTP 401 remains down and HTTP 403 remains degraded because balance:read is required for verification. The health request reads balance and never creates a payment.

Create a Protection Bypass for Automation key on spawnforge-staging only and store it as the GitHub repository secret VERCEL_AUTOMATION_BYPASS_STAGING. During provisioning, keep it out of command arguments, files, URLs and logs; use protected input or the GitHub settings UI. At runtime the health script supplies the bypass HTTP header through curl arguments on the isolated CI runner. It never puts the key in a URL or prints it. When rotating, store the new secret before revoking the old project key. Keep Deployment Protection enabled.

CI preview and CD staging fail before deployment if the secret is absent. After deployment they run scripts/post-deploy-health-check.sh against the emitted deployment URL. The bypass header is allowed only when VERCEL_AUTOMATION_BYPASS_ORIGIN matches that exact HTTPS origin; curl never follows redirects. Verification requires application HTTP 200, the expected commit's first eight characters, environment staging, Payments (Stripe) status up or healthy, and the existing engine reachability checks. SSO responses, wrong builds, missing services and degraded Stripe fail. CI posts a verified preview link only after this gate passes.

Run the regression suite with:

~~~bash
bash scripts/__tests__/post-deploy-health-check.test.sh
cd web
npx vitest run src/lib/config/__tests__/validateEnv.test.ts src/lib/monitoring/__tests__/healthChecks.test.ts
~~~

The shell suite also executes scripts/__tests__/staging-env-wiring.test.mjs to verify both workflow gates remain mandatory. If startup fails, inspect variable target metadata and runtime validation messages without printing credential values. If Stripe is unauthorized or lacks balance:read, replace the staging test credential through the secret provider; do not substitute production credentials or relax the gate. These checks do not exercise authenticated checkout or webhook delivery.
