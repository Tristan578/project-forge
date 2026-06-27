# SpawnForge — Security & Testing Audit

**Date:** 2026-05-30  
**Scope:** Full codebase (`web/`, `engine/`, `mcp-server/`, `packages/`, `apps/`) + infrastructure (Vercel, Neon, Upstash, Clerk, Stripe, Sentry, Cloudflare R2, CI/CD).  
**Method:** A single dynamic multi-agent workflow fanned out across **14 audit dimensions** — 9 security (authz, injection, secrets, API hardening, payments, dependencies, infra, script-sandbox, privacy) + 5 testing (critical-path coverage, test quality, E2E, CI/CD, contracts). Every raw finding was then **adversarially verified** by an independent skeptic agent before being kept. 83 raw findings → **59 confirmed, 24 refuted** (29% false-positive kill rate). ~98 agents, ~4.2M tokens.  
**Status:** Read-only audit. No production code was modified. This document is the remediation plan; each finding is tracked as a GitHub issue and a taskboard subtask.

---

## Executive summary

SpawnForge's security posture is mixed: the application-layer fundamentals (parameterized DB access, CORS/CSP scaffolding, IP rate limiting, server-only R2/signed URLs, AES-256-GCM BYOK encryption) are sound, but three categories of problems undermine the guarantees the product makes to users and to its own engineers. First, secret and PII hygiene in observability is broken at the source: the Sentry server config ships `includeLocalVariables: true` plus `sendDefaultPii: true` with no `beforeSend` scrubbing, so a single error in any AI/BYOK code path can exfiltrate live, decrypted third-party API keys, user emails, IPs, prompts, and session cookies into Sentry — a credential-leak vector and a GDPR data-minimization violation. Second, the money paths are not provably correct: token add-on purchases have no DB-level idempotency on the Stripe payment intent (verified: `creditAddonTokens` blindly increments and inserts), so ordinary webhook redelivery double-credits paid currency; platform-key failures deduct tokens without refunding; and the tests that are supposed to protect these paths are tautological string-matches that never run the SQL guards. Third, and most corrosively, the CI/CD merge gate is largely theater: the only required status check is a no-op `ci-gate` job (verified), coverage-threshold failures are swallowed by an exit-code workaround, the npm-audit gate only fails on `critical`, and the headline E2E/coverage numbers overstate real PR enforcement by roughly an order of magnitude. The net effect is that a regression in auth, billing, or the script sandbox can pass every PR check and reach production undetected. None of these are exotic; they are configuration and idempotency defects in the highest-blast-radius parts of the system, and they should be fixed before any cosmetic or coverage-breadth work.

### Severity (verifier-adjusted)

| Severity | Count | Phase |
|----------|------:|-------|
| 🔴 High | 4 | P0 |
| 🟠 Medium | 15 | P1 |
| 🟡 Low | 32 | P2 |
| ⚪ Info | 8 | P2 |
| **Total confirmed** | **59** | |

### Top risks

1. Sentry server config (includeLocalVariables + sendDefaultPii, no beforeSend scrubbing) can exfiltrate decrypted BYOK/platform API keys, user emails, IPs, prompts, and session cookies into Sentry on any error.
2. Token add-on purchases have no DB-level idempotency on stripe_payment_intent (creditAddonTokens blindly increments and inserts) — webhook redelivery double-credits paid tokens.
3. The required CI status check is the no-op `ci-gate` job; eslint/tsc/vitest/coverage are not enforced at branch protection, and coverage failures are separately swallowed by the vitest#3077 exit-code workaround.
4. Billing/refund/idempotency tests are tautological (assert SQL substrings or trust mocked responses), so double-credit and wrong-amount regressions ship green.
5. Editor script sandbox is escapable to real fetch under the permissive editor CSP (and the in-code 'mitigated' claim is wrong); platform-key resolution failure debits tokens with no refund path.

---

## Themes

The 59 findings collapse into 13 root-cause themes. Fixing the theme fixes the cluster.

### 🔴 Secret & PII exposure through observability/logging

The two Sentry findings describe the same root cause (includeLocalVariables: true + sendDefaultPii: true in sentry.server.config.ts lines 21-22, verified) viewed through the secret-leak and PII/GDPR lenses respectively — they collapse into one fix: a server-side beforeSend that scrubs frame locals, headers, cookies, and IP, plus sendDefaultPii: false. The logger finding is the same class of gap (no centralized redaction) and a centralized denylist/redactor protects both the Sentry path and the logger. Treated as high because the worst case is live, usable third-party credentials and user PII landing in a third-party store outside the app's retention controls.

- Sentry server config captures plaintext provider API keys via includeLocalVariables + sendDefaultPii with no scrubbing
- Sentry sendDefaultPii + includeLocalVariables leaks emails, prompts, IPs, and plaintext BYOK keys
- Structured server logger performs no secret redaction on context fields

### 🔴 Payment idempotency & billing correctness

Two of these are the same defect (no UNIQUE/ON CONFLICT on token_purchases.stripe_payment_intent — verified the transaction blindly increments and inserts) reported from the code-review and test-coverage dimensions; they share one fix (DB UNIQUE constraint + ON CONFLICT DO NOTHING gating the UPDATE, mirroring refundTokens). The other three are distinct atomicity/refund holes in the same money subsystem: pre-deduction without refund-on-failure, non-atomic purchase+balance writes, and a documented-but-uncalled self-healing path. Grouped as high because the dominant outcome is direct monetary loss or free paid entitlement, and the double-credit case is attacker-independent.

- creditAddonTokens has no DB-level idempotency on stripe_payment_intent — token add-on purchases can be double-credited on webhook redelivery
- creditAddonTokens (Stripe token-pack purchase) has no payment_intent idempotency in code or test — double-credit money-loss risk
- Platform-key resolution failure deducts tokens without refunding (silent paid-token loss + unhandled re-throw)
- Marketplace purchase row can be committed without charging the buyer if the request crashes mid-purchase, granting free download access
- Webhook in-flight claim auto-expiry safety net is non-functional — cleanupExpired() has no caller

### 🟠 Test theater — guards asserted but never executed

These all share one anti-pattern: the riskiest code (CTE idempotency guards, per-package token math, pool-selection, rate-limit comparison, ownership scoping) is 'covered' by tests that match SQL substrings or trust mocked responses and never run the real logic. They directly amplify the Payment theme — the double-credit and wrong-amount-credited regressions would ship green. Remediation is uniform: drive the money/auth paths through an ephemeral Postgres (claimable-postgres skill) and assert observable row state, demoting substring checks to at most a structural smoke test. Medium because it is false confidence rather than an active breach, but it is the multiplier that lets the high-severity billing bugs persist.

- Refund idempotency / TOCTOU tests never execute the SQL guard they claim to verify
- handleChargeRefunded tests verify SQL substrings, and 'same CTE on second call' explicitly proves idempotency is never tested
- creditAddonTokens tests never assert the per-package token amount credited
- token service deductTokens pool-spillover and retry tests don't exercise the deduction logic they name
- subscriptionLifecycle.db.test.ts is named a DB test but is fully mock-based; balanceAfter/rollover SQL never runs
- Distributed rate-limiter atomicity claims are asserted by trusting the mocked Upstash response
- game/pipeline route happy-path (reserve/release/record token mutations) only validation-tested; money logic relies on lib/budget tests
- publish [id] unpublish/DELETE — non-owner-cannot-unpublish ownership case untested (2-case test)

### 🔴 CI/CD merge gate is not actually enforced

These compound into a single systemic failure: the merge gate does not reliably block defects. Verified that the only required check is the no-op ci-gate job, so eslint/tsc/vitest/coverage block merge only by actor goodwill; coverage failures are independently swallowed by the exit-code heuristic; CD re-validation omits coverage; the documented thresholds don't even match the config; npm-audit (in two workflows) only fails on critical; and CodeQL runs post-merge while ignoring the most dangerous file. Severity is high (escalated above the individual low/medium ratings) because this theme is the reason every other fix is fragile — without a real gate, regressions in auth, billing, and the sandbox reach production undetected.

- Only the no-op `ci-gate` job is the required status check; quality gates are not enforced by branch protection
- Coverage threshold failures are silently swallowed by the vitest#3077 exit-code workaround
- CD deploy path runs vitest WITHOUT coverage, so coverage is never enforced on the deploy gate
- Coverage threshold config and the ratchet/CI comments disagree (75/65/70/77 vs 70/60/65/72)
- npm audit gate only blocks on 'critical' — high/moderate vulnerabilities never fail CI
- CD/MCP npm-audit security gate only fails on critical, so all current high/moderate advisories pass CI silently
- CodeQL runs only on push-to-main and weekly schedule — never on pull requests
- CodeQL excludes the single highest-risk file (scriptWorker.ts Function() sandbox) from all static analysis

### 🟠 Vulnerable dependencies & supply-chain monitoring gaps

Three live HIGH advisories (fast-uri path traversal, fast-xml-builder injection, hono cache leakage/bodyLimit bypass) are unmitigated because the override floors are wrong or missing — and the npm-audit gate (see CI theme) only fails on critical, so none of them block CI. The Dependabot finding explains why they accumulate silently: it watches the wrong directories (the real resolved tree lives in the root lockfile where the overrides also live). The mutable-action-tag finding is the same supply-chain class on the CI side. Grouped at medium: individually each advisory is rated low but collectively they are live HIGH CVEs with a broken detection/remediation loop, and they are cheap to fix via root overrides + reinstall.

- fast-uri@3.1.0 (HIGH, path traversal / host confusion) is unpinned by any override
- fast-xml-builder@1.1.5 (HIGH) is uncovered — only fast-xml-parser is overridden
- hono override pins ^4.12.14 -> resolves 4.12.15, below patched 4.12.18; multiple hono advisories remain
- Dependabot npm watches /web and /mcp-server (no lockfiles) but not the root single lockfile
- Third-party and first-party GitHub Actions use floating/mutable tags instead of SHA pins

### 🟠 Script sandbox escape & permissive CSP on the editor origin

The two CSP findings (next.config.ts line 20 and the lines 15-30 view) are the same global script-src policy, and the sandbox-escape finding depends on it: 'unsafe-eval' + 'unsafe-inline' on the editor origin means the documented sandbox boundary is fictional and a malicious/AI-generated script can reach real fetch with the author's session cookies. The CodeQL-exclusion finding (also in the CI theme) is the reason no static analysis catches a sandbox regression. Blast radius is the authenticated editing session only (community /play/ has the strict CSP, which proves a strict policy is achievable), so medium — but the misleading in-code 'mitigated' comments must be corrected so future changes don't trust a non-existent boundary.

- Sandbox escape (constructor-chain to real Function/fetch) is unmitigated in the editor due to permissive CSP allowing unsafe-eval
- CSP script-src allows both 'unsafe-inline' and 'unsafe-eval'
- Main-app CSP allows 'unsafe-inline' and 'unsafe-eval' in script-src
- CodeQL excludes the single highest-risk file (scriptWorker.ts Function() sandbox) from all static analysis

### 🟡 Broken access control & public-data leakage on detail endpoints

The first two findings are literally the same defect (community/games/[id] detail GET lacks status='published') reported from the authz and privacy dimensions — they collapse to one WHERE-clause fix. The marketplace asset detail finding is the identical missing-status-filter pattern on a sibling endpoint, and notably re-exposes content moderators have just removed. The moderation-appeal finding is the same family (ownership/state not verified end-to-end on attacker-supplied IDs). All are low because they leak existence/metadata of by-ID content rather than secrets, but they uniformly defeat creator/moderator intent and share a single remediation pattern: filter detail queries to published/owned state, returning 404 otherwise.

- Public community game detail endpoint leaks unpublished/processing games (missing status filter)
- Community game detail route leaks unpublished/processing games (no status filter)
- Marketplace asset detail route leaks draft/pending/rejected/removed assets (no status filter)
- Moderation appeals can be filed against arbitrary content the appellant never authored

### 🟠 GDPR right-to-erasure and right-of-access defects

Two distinct but related GDPR obligations are unmet. Erasure (Article 17) is the more serious: the advertised 'permanently delete' does not delete the Clerk identity and the local row is silently resurrected by re-sync, so a deletion request is effectively a no-op — escalated to medium because it is a compliance failure on an explicit product promise. Access (Article 15) returns an incomplete copy, omitting user-authored text and social activity. Both have a clean fix path: trigger Clerk's deleteUser (the user.deleted webhook already wires DB cleanup) for erasure, and mirror deleteUserAccount's table list in the export for access.

- Account deletion never removes the Clerk identity and is auto-undone by user re-sync
- GDPR data export omits the user's own comments, reviews, ratings, follows, listings, and appeals

### 🟡 Prompt-injection / LLM-safety control bypasses

Both are gaps in intentional content-safety controls that are trivially bypassed by an alternate input shape: the /api/chat guard skips array-typed multimodal content (wrap the same text in content:[{type:'text'}] to defeat it), and createGenerationHandler only scans the single promptField, letting negativePrompt/artStyle reach a paid third-party API unsanitized and uncapped. Low because prompt-injection defense is inherently best-effort and the generation-handler blast radius is provider-side, but an explicitly-advertised control rendered ineffective is worth fixing: normalize/iterate content parts before validating, and allow promptField to cover all free-text fields.

- Prompt-injection detection and input sanitization in /api/chat skip array-typed message content
- createGenerationHandler content-safety filter only scans a single promptField; secondary free-text fields bypass sanitizePrompt

### 🟠 Cron monitoring blocked & operational information disclosure

The health-monitor finding is the standout (medium): in production the synthetic monitor cron is 401'd by the Clerk proxy every 5 minutes, so the system the team relies on for DB/Clerk/provider outage detection is silently dead — fails closed for security but defeats incident detection. The public /api/health over-share (branch/environment metadata aids reconnaissance) and the unversioned engine-cdn worker (a coverage gap, not a confirmed defect) are the lower-risk operational/infra hygiene items grouped alongside it. Fix the cron path through the proxy first; the other two are hardening/visibility items.

- Vercel Cron health-monitor is blocked by Clerk auth in production (silent monitoring outage)
- Public /api/health leaks deployment metadata (git branch, environment, version, per-service latency/status)
- infra/engine-cdn Cloudflare worker (R2 CORS / bucket exposure) not present in repo — unverifiable

### 🟠 E2E coverage is mislabeled and largely unenforced

These collapse into one story: the headline '~69 Playwright specs' overstates real PR coverage by ~13x because tag conventions (@dev/@ui/@api/@engine) silently exclude almost everything, and even the specs that run have assertions that can never fail (E2E_STRICT_STORES unset, if(count>0) short-circuits). The roadmap's #1 journey (AI prompt -> entities -> play -> export) and the money-path/auth/published-game journeys get no PR signal. Medium overall: the root cause is shared (make editor specs production-server compatible behind a guarded store flag, then remove the blanket @dev exclusion, set E2E_STRICT_STORES=true, and add @api to the PR grep). It reinforces the CI-gate theme — specs existing is not specs running.

- Only 5 of ~67 spec files actually run in the per-PR CI E2E gate
- Game-creation assertions are soft no-ops because E2E_STRICT_STORES is never set in CI
- Game Creation E2E (roadmap #1 priority) is excluded from PR CI by the @dev tag
- Stripe / billing / token-depletion E2E (@api) run in no CI job at all
- No E2E coverage for playing a published game, marketplace purchase/download, or leaderboards
- Signup/auth journey is entirely test.skip'd in CI (no Clerk keys)
- No CI job runs @engine (WASM+GPU) tests; the real interactive journeys only run post-merge

### 🟡 API/schema/manifest contract drift with no real drift gate

A cluster of contract-integrity gaps sharing a theme with the test-theater group: the artifacts meant to be the source of truth (Drizzle migrations, OpenAPI spec, the two command manifests) drift from the code, and the tests/gates meant to catch drift are tautological (schema.test.ts and manifest.test.ts always pass; contracts.test.ts validates hand-built objects not route output) or path-filtered (web-only manifest edits escape). The migration drift is the most operationally real (db:migrate cannot rebuild leaderboard/appeal tables -> runtime 'relation does not exist'). Low because none is an active breach, and the remediation is consistent: derive assertions from the real artifacts (schema module, route tree, handlerRegistry) and add drift gates that fail on divergence.

- Drizzle migrations are incomplete: 3 live tables have no migration (schema/migration drift)
- schema.test.ts 'exactly N tables' assertion is tautological and missed 4 new tables
- OpenAPI spec documents only ~51 of ~95 routes, is hand-maintained, and has no drift gate
- contracts.test.ts validates ajv schemas only against synthetic objects, never real route responses
- Manifest-sync CI gate is path-filtered so edits to only the web copy escape the check
- Full manifest-to-handler resolution is only covered by 29 representatives in vitest (CI safety relies on a regex script)
- manifest.test.ts category 'snapshot guard' is tautological and validCategories no longer exists
- Documented `npm run check:manifest-sync` script does not exist

### 🟡 Cryptographic configuration robustness

Standalone hardening item: getMasterKey validates length but not hex charset, so a misconfigured key passes the startup presence check and crashes the first BYOK encrypt/decrypt as a user-facing 500 instead of failing fast at boot. No weak-key compromise — purely a fail-fast/deploy-time robustness improvement (add /^[0-9a-fA-F]{64}$/ validation in getMasterKey and validateEnvironment). Kept separate because it shares no remediation with the other themes.

- Encryption master key validated only by length, not hex validity

---

## Findings index

| ID | Phase | Sev | Class | Dimension | Title | File | Issue |
|----|-------|-----|-------|-----------|-------|------|-------|
| F01 | P0 | 🔴 high | testing | ci | Only the no-op `ci-gate` job is the required status check; quality gates are not enforced by branch protection | `.github/workflows/ci.yml:19-20` | #8593 |
| F02 | P0 | 🔴 high | security | payments | creditAddonTokens has no DB-level idempotency on stripe_payment_intent — token add-on purchases can be double-credited on webhook redelivery | `web/src/lib/tokens/service.ts:362-390, web/src/app/api/stripe/webhook/route.ts:232-262, web/src/lib/db/schema.ts:125-138` | #8594 |
| F03 | P0 | 🔴 high | security | privacy | Sentry sendDefaultPii + includeLocalVariables leaks emails, prompts, IPs, and plaintext BYOK keys | `web/sentry.server.config.ts:21-22` | #8595 |
| F04 | P0 | 🔴 high | security | secrets | Sentry server config captures plaintext provider API keys via includeLocalVariables + sendDefaultPii with no scrubbing | `web/sentry.server.config.ts:21-22` | #8596 |
| F05 | P1 | 🟠 medium | security | apihard | Platform-key resolution failure deducts tokens without refunding (silent paid-token loss + unhandled re-throw) | `web/src/lib/keys/resolver.ts:102-116, web/src/lib/api/createGenerationHandler.ts:265-296` | #8597 |
| F06 | P1 | 🟠 medium | testing | ci | Coverage threshold failures are silently swallowed by the vitest#3077 exit-code workaround | `.github/workflows/quality-gates.yml:178-187` | #8598 |
| F07 | P1 | 🟠 medium | testing | contracts | OpenAPI spec documents only ~51 of ~95 routes, is hand-maintained, and has no drift gate | `docs/api/openapi.json, web/src/app/api/openapi/route.ts` | #8599 |
| F08 | P1 | 🟠 medium | security | deps | CD/MCP npm-audit security gate only fails on critical, so all current high/moderate advisories pass CI silently | `.github/workflows/cd.yml:451-457` | #8600 |
| F09 | P1 | 🟠 medium | testing | e2e | Game-creation assertions are soft no-ops because E2E_STRICT_STORES is never set in CI | `web/e2e/helpers/store-injection.ts:10, web/e2e/tests/game-creation-flow.spec.ts:172, web/e2e/tests/ai-game-creation.spec.ts:68` | #8601 |
| F10 | P1 | 🟠 medium | testing | e2e | No CI job runs @engine (WASM+GPU) tests; the real interactive journeys only run post-merge — FIXED: per-PR `test-e2e-engine-smoke` job boots the real WASM engine under SwiftShader software WebGL2 (`@engine-smoke` spec). Residual GPU/WebGPU gap documented. | `.github/workflows/ci.yml (test-e2e-engine-smoke), web/playwright.engine.config.ts, web/e2e/tests/engine-smoke.spec.ts` | #8602 |
| F11 | P1 | 🟠 medium | testing | e2e | No E2E coverage for playing a published game, marketplace purchase/download, or leaderboards | `web/src/app/play/, web/src/app/marketplace (api/marketplace), web/src/app/community/, web/e2e/tests/` | #8603 |
| F12 | P1 | 🟠 medium | testing | e2e | Only 5 of ~67 spec files actually run in the per-PR CI E2E gate | `web/e2e/tests/, .github/workflows/ci.yml:353` | #8604 |
| F13 | P1 | 🟠 medium | security | infra | Vercel Cron health-monitor is blocked by Clerk auth in production (silent monitoring outage) | `web/src/proxy.ts:113-173, web/src/app/api/cron/health-monitor/route.ts:28-63, web/vercel.json:11-16` | #8605 |
| F14 | P1 | 🟠 medium | security | privacy | Account deletion never removes the Clerk identity and is auto-undone by user re-sync | `web/src/app/api/user/delete/route.ts:19` | #8606 |
| F15 | P1 | 🟠 medium | security | sandbox | Sandbox escape (constructor-chain to real Function/fetch) is unmitigated in the editor due to permissive CSP allowing unsafe-eval | `web/src/lib/scripting/__tests__/scriptSandbox.test.ts:523-559, web/next.config.ts:20,24` | #8607 |
| F16 | P1 | 🟠 medium | testing | test-quality | Refund idempotency / TOCTOU tests never execute the SQL guard they claim to verify | `web/src/lib/billing/__tests__/reverseAddonTokens.test.ts` | #8608 |
| F17 | P1 | 🟠 medium | testing | test-quality | creditAddonTokens tests never assert the per-package token amount credited | `web/src/lib/tokens/__tests__/service.test.ts` | #8609 |
| F18 | P1 | 🟠 medium | testing | test-quality | handleChargeRefunded tests verify SQL substrings, and 'same CTE on second call' explicitly proves idempotency is never tested | `web/src/lib/billing/__tests__/chargeRefund.test.ts` | #8610 |
| F19 | P1 | 🟠 medium | testing | test-quality | subscriptionLifecycle.db.test.ts is named a DB test but is fully mock-based; balanceAfter/rollover SQL never runs | `web/src/lib/billing/__tests__/subscriptionLifecycle.db.test.ts` | #8611 |
| F20 | P2 | 🟡 low | security | apihard | CSP script-src allows both 'unsafe-inline' and 'unsafe-eval' | `web/next.config.ts:20` | #8612 |
| F21 | P2 | 🟡 low | security | authz | Moderation appeals can be filed against arbitrary content the appellant never authored | `web/src/app/api/moderation/appeal/route.ts` | #8613 |
| F22 | P2 | 🟡 low | security | authz | Public community game detail endpoint leaks unpublished/processing games (missing status filter) | `web/src/app/api/community/games/[id]/route.ts` | #8614 |
| F23 | P2 | 🟡 low | testing | ci | CodeQL excludes the single highest-risk file (scriptWorker.ts Function() sandbox) from all static analysis | `.github/codeql/codeql-config.yml:9-10` | #8615 |
| F24 | P2 | 🟡 low | testing | ci | CodeQL runs only on push-to-main and weekly schedule — never on pull requests | `.github/workflows/codeql.yml:3-7` | #8616 |
| F25 | P2 | 🟡 low | testing | ci | npm audit gate only blocks on 'critical' — high/moderate vulnerabilities never fail CI | `.github/workflows/quality-gates.yml:426-435` | #8617 |
| F26 | P2 | 🟡 low | testing | contracts | Drizzle migrations are incomplete: 3 live tables have no migration (schema/migration drift) | `web/drizzle/0000_large_mephisto.sql, web/src/lib/db/schema.ts:538,556,578` | #8618 |
| F27 | P2 | 🟡 low | testing | contracts | Full manifest-to-handler resolution is only covered by 29 representatives in vitest (CI safety relies on a regex script) | `web/src/lib/chat/__tests__/executorIntegrationBroad.test.ts:321-344, web/scripts/check-command-parity.js` | #8619 |
| F28 | P2 | 🟡 low | testing | contracts | Manifest-sync CI gate is path-filtered so edits to only the web copy escape the check | `.github/workflows/ci.yml:54,147,178` | #8620 |
| F29 | P2 | 🟡 low | testing | contracts | contracts.test.ts validates ajv schemas only against synthetic objects, never real route responses | `web/src/app/api/__tests__/contracts.test.ts:499-573` | #8621 |
| F30 | P2 | 🟡 low | testing | contracts | manifest.test.ts category 'snapshot guard' is tautological and validCategories no longer exists | `mcp-server/src/manifest.test.ts:48-63` | #8622 |
| F31 | P2 | 🟡 low | testing | contracts | schema.test.ts 'exactly N tables' assertion is tautological and missed 4 new tables | `web/src/lib/db/__tests__/schema.test.ts:36-41` | #8623 |
| F32 | P2 | 🟡 low | testing | cov-critical | creditAddonTokens (Stripe token-pack purchase) has no payment_intent idempotency in code or test — double-credit money-loss risk | `web/src/lib/tokens/service.ts:363-390` | #8624 |
| F33 | P2 | 🟡 low | testing | cov-critical | publish [id] unpublish/DELETE — non-owner-cannot-unpublish ownership case untested (2-case test) | `web/src/app/api/publish/[id]/route.ts:24` | #8625 |
| F34 | P2 | 🟡 low | security | deps | Dependabot npm watches /web and /mcp-server (no lockfiles) but not the root single lockfile | `.github/dependabot.yml (npm entries: directory /web and /mcp-server)` | #8626 |
| F35 | P2 | 🟡 low | security | deps | Third-party and first-party GitHub Actions use floating/mutable tags instead of SHA pins | `.github/workflows/quality-gates.yml:743 (chromaui/action@v17), cd.yml:287,459 & quality-gates.yml:256,437 (dtolnay/rust-toolchain@stable)` | #8627 |
| F36 | P2 | 🟡 low | security | deps | fast-uri@3.1.0 (HIGH, path traversal / host confusion) is unpinned by any override | `package-lock.json fast-uri@3.1.0 via ajv@8.20.0 (web/)` | #8628 |
| F37 | P2 | 🟡 low | security | deps | fast-xml-builder@1.1.5 (HIGH) is uncovered — only fast-xml-parser is overridden | `web/package.json:overrides (fast-xml-parser only) / package-lock.json fast-xml-builder@1.1.5` | #8629 |
| F38 | P2 | 🟡 low | security | deps | hono override pins ^4.12.14 -> resolves 4.12.15, below patched 4.12.18; multiple hono advisories remain | `package.json:overrides 'hono':'^4.12.14' / package-lock.json hono@4.12.15` | #8630 |
| F39 | P2 | 🟡 low | testing | e2e | Game Creation E2E (roadmap #1 priority) is excluded from PR CI by the @dev tag | `web/e2e/tests/game-creation-flow.spec.ts:24, web/e2e/tests/ai-game-creation.spec.ts:19, .github/workflows/ci.yml:353` | #8631 |
| F40 | P2 | 🟡 low | testing | e2e | Signup/auth journey is entirely test.skip'd in CI (no Clerk keys) | `web/e2e/tests/navigation.spec.ts:110, web/e2e/tests/public-pages.spec.ts:11` | #8632 |
| F41 | P2 | 🟡 low | testing | e2e | Stripe / billing / token-depletion E2E (@api) run in no CI job at all | `web/e2e/tests/billing-flow.spec.ts:9, web/e2e/tests/token-depletion.spec.ts:9, .github/workflows/ci.yml:353` | #8633 |
| F42 | P2 | 🟡 low | security | infra | Main-app CSP allows 'unsafe-inline' and 'unsafe-eval' in script-src | `web/next.config.ts:15-30` | #8634 |
| F43 | P2 | 🟡 low | security | injection | Prompt-injection detection and input sanitization in /api/chat skip array-typed message content | `web/src/app/api/chat/route.ts:337-361` | #8635 |
| F44 | P2 | 🟡 low | security | payments | Marketplace purchase row can be committed without charging the buyer if the request crashes mid-purchase, granting free download access | `web/src/app/api/marketplace/assets/[id]/purchase/route.ts:89-184, web/src/app/api/marketplace/assets/[id]/download/route.ts:51-61` | #8636 |
| F45 | P2 | 🟡 low | security | payments | Webhook in-flight claim auto-expiry safety net is non-functional — cleanupExpired() has no caller | `web/src/lib/billing/webhookIdempotency.ts:39-58, 113-121` | #8637 |
| F46 | P2 | 🟡 low | security | privacy | Community game detail route leaks unpublished/processing games (no status filter) | `web/src/app/api/community/games/[id]/route.ts:40` | #8638 |
| F47 | P2 | 🟡 low | security | privacy | GDPR data export omits the user's own comments, reviews, ratings, follows, listings, and appeals | `web/src/app/api/user/export-data/route.ts:159-172` | #8639 |
| F48 | P2 | 🟡 low | security | privacy | Marketplace asset detail route leaks draft/pending/rejected/removed assets (no status filter) | `web/src/app/api/marketplace/assets/[id]/route.ts:43` | #8640 |
| F49 | P2 | 🟡 low | security | secrets | Encryption master key validated only by length, not hex validity | `web/src/lib/keys/encryption.ts:11-20` | #8641 |
| F50 | P2 | 🟡 low | security | secrets | Structured server logger performs no secret redaction on context fields | `web/src/lib/logging/logger.ts:95-108` | #8642 |
| F51 | P2 | 🟡 low | testing | test-quality | token service deductTokens pool-spillover and retry tests don't exercise the deduction logic they name | `web/src/lib/tokens/__tests__/service.test.ts` | #8643 |
| F52 | P2 | ⚪ info | testing | ci | CD deploy path runs vitest WITHOUT coverage, so coverage is never enforced on the deploy gate | `.github/workflows/cd.yml:164-187` | #8644 |
| F53 | P2 | ⚪ info | testing | ci | Coverage threshold config and the ratchet/CI comments disagree (75/65/70/77 vs 70/60/65/72) | `web/vitest.config.ts:34-39` | #8645 |
| F54 | P2 | ⚪ info | testing | contracts | Documented `npm run check:manifest-sync` script does not exist | `web/src/lib/chat/tools.ts:5` | #8646 |
| F55 | P2 | ⚪ info | testing | cov-critical | game/pipeline route happy-path (reserve/release/record token mutations) only validation-tested; money logic relies on lib/budget tests | `web/src/app/api/game/pipeline/route.ts:42-60` | #8647 |
| F56 | P2 | ⚪ info | security | infra | Public /api/health leaks deployment metadata (git branch, environment, version, per-service latency/status) | `web/src/app/api/health/route.ts:87-129, web/src/lib/monitoring/healthChecks.ts:591-597` | #8648 |
| F57 | P2 | ⚪ info | security | infra | infra/engine-cdn Cloudflare worker (R2 CORS / bucket exposure) not present in repo — unverifiable | `web/next.config.ts:148-151 (references infra/engine-cdn/worker.js)` | #8649 |
| F58 | P2 | ⚪ info | security | injection | createGenerationHandler content-safety filter only scans a single promptField; secondary free-text fields bypass sanitizePrompt | `web/src/lib/api/createGenerationHandler.ts:185-199` | #8650 |
| F59 | P2 | ⚪ info | testing | test-quality | Distributed rate-limiter atomicity claims are asserted by trusting the mocked Upstash response | `web/src/lib/rateLimit/__tests__/distributed.test.ts` | #8651 |

---

## P0 findings — immediate (active credential leak, money loss, broken merge gate)

#### F01 — Only the no-op `ci-gate` job is the required status check; quality gates are not enforced by branch protection

**Severity:** 🔴 high  ·  **Dimension:** ci (testing)  ·  **Issue:** #8593  ·  **Epic:** #8590  
**File:** `.github/workflows/ci.yml:19-20`

The ci-gate job's own comment states: 'The ruleset requires only this check — it always posts a result, solving the path-filter + required-checks conflict' (ci.yml:19-20). The ci-gate job (ci.yml:21-74) only runs `git diff` to compute changed-path outputs and always exits 0 — it performs no validation. quality-gates is invoked as a separate job that `needs: [ci-gate]` (ci.yml:79) but ci-gate does NOT depend on quality-gates. Within a single workflow run, GitHub does not fail the workflow-level required check `ci-gate` just because a sibling job (quality-gates) failed. If branch protection requires only the `CI Gate` check (as the comment asserts), a PR with failing lint/tsc/vitest/coverage can still satisfy the required check and become mergeable.

**Impact:** The eslint --max-warnings 0, tsc --noEmit, vitest, and coverage gates may not block merge at the branch-protection layer. Merge depends entirely on the merge actor honoring the (non-required) red checks. Combined with the coverage-swallow finding, this materially weakens the merge gate.

**Evidence:** ci.yml:20 comment 'The ruleset requires only this check'; ci-gate job (lines 21-74) has no validation steps; quality-gates job (line 77) is a parallel sibling, not a dependency of ci-gate.

**Recommended fix:** Make the required status check a job that aggregates results — e.g. add a final `ci-success` job with `needs: [quality-gates, command-parity, build-nextjs, test-e2e-ui, ...]` and `if: always()` that fails unless every dependency is success/skipped, then require THAT job in the ruleset. Or add each quality-gate job as a required check. Verify the actual ruleset via `gh api repos/{owner}/{repo}/rulesets`.

#### F02 — creditAddonTokens has no DB-level idempotency on stripe_payment_intent — token add-on purchases can be double-credited on webhook redelivery

**Severity:** 🔴 high  ·  **Dimension:** payments (security)  ·  **Issue:** #8594  ·  **Epic:** #8590  
**File:** `web/src/lib/tokens/service.ts:362-390, web/src/app/api/stripe/webhook/route.ts:232-262, web/src/lib/db/schema.ts:125-138`

For the checkout.session.completed (mode='payment') event, the webhook calls creditAddonTokens(userId, pkg, paymentIntent), which atomically increments users.addon_tokens and inserts a token_purchases row. token_purchases.stripe_payment_intent is declared notNull() but has NO unique constraint (confirmed in schema.ts:130 and drizzle/0000_large_mephisto.sql:254 — only a FK on user_id). So creditAddonTokens is NOT self-idempotent; it relies entirely on the webhook-level claimEvent() row to prevent re-processing. However, in route.ts the credit (line 244) runs BEFORE a follow-up SELECT (line 250) and conditional updateUserStripe() (line 257). If that SELECT or update throws (transient DB error), processEvent throws, the catch block (route.ts:81-89) calls releaseEvent() which DELETES the idempotency claim row, and Stripe redelivers the identical event. On redelivery creditAddonTokens runs again, crediting addon_tokens a second time and inserting a duplicate token_purchases row. The negative-cases test (webhook __tests__/negative-cases.test.ts:265) confirms releaseEvent is invoked on processing failure, validating this control-flow.

**Impact:** A user who buys a token add-on can receive 2x (or more) the purchased tokens for a single payment whenever any post-credit step in processEvent fails and Stripe redelivers. This is direct, repeatable monetary loss (free tokens = free AI generation spend) triggered by ordinary transient DB errors, not just an attacker.

**Recommended fix:** Make creditAddonTokens idempotent at the DB level: add a UNIQUE constraint on token_purchases.stripe_payment_intent and convert the INSERT to ON CONFLICT (stripe_payment_intent) DO NOTHING, gating the addon_tokens UPDATE on whether the INSERT actually inserted a row (same CTE pattern already used in refundTokens / reverseAddonTokens). Alternatively, move the non-critical customer-ID save out of the failure path (wrap it in its own try/catch so it can never trigger releaseEvent after the credit commits).

#### F03 — Sentry sendDefaultPii + includeLocalVariables leaks emails, prompts, IPs, and plaintext BYOK keys

**Severity:** 🔴 high  ·  **Dimension:** privacy (security)  ·  **Issue:** #8595  ·  **Epic:** #8590  
**File:** `web/sentry.server.config.ts:21-22`

The server Sentry init sets both `includeLocalVariables: true` (line 21) and `sendDefaultPii: true` (line 22); the edge config also sets `sendDefaultPii: true` (web/sentry.edge.config.ts:20). `sendDefaultPii: true` makes the SDK attach the client IP, request headers (including the Clerk session cookie), and request data to error events. `includeLocalVariables: true` captures stack-frame local variables. The only event processor (configureSentryFingerprinting -> fingerprintEvent in web/src/lib/monitoring/sentryConfig.ts) sets fingerprints/tags but never redacts `event.request` or stack locals, and no `beforeSend` is configured. Concrete leak path: web/src/app/api/keys/[provider]/route.ts:35 holds the plaintext BYOK API key in a local `key` before `storeProviderKey` at line 38; if that throws, captureException (line 41) fires while local-variable capture is on, sending the plaintext secret to Sentry. The same applies to `email` (admin/export routes), comment/appeal free-text `content`/`reason`, and AI `prompt` values held in locals across routes.

**Impact:** User PII (email addresses, IP addresses), user-generated content, AI prompts, session cookies, and decrypted third-party API keys can be transmitted to and stored in Sentry on any error. This is a GDPR data-minimisation violation and a credential-leak vector (BYOK keys), and it persists outside the application's own retention/deletion controls.

**Recommended fix:** Set `sendDefaultPii: false` (Sentry's default) in both server and edge configs, or add a `beforeSend`/`beforeSendTransaction` that strips `event.request.cookies`, headers, IP, and scrubs stack-frame locals named key/token/secret/email/prompt/content. Strongly consider disabling `includeLocalVariables` in production. The Anthropic integration already disables recordInputs/recordOutputs in prod (lines 29-32) — extend that same posture to request data and locals.

#### F04 — Sentry server config captures plaintext provider API keys via includeLocalVariables + sendDefaultPii with no scrubbing

**Severity:** 🔴 high  ·  **Dimension:** secrets (security)  ·  **Issue:** #8596  ·  **Epic:** #8590  
**File:** `web/sentry.server.config.ts:21-22`

The server-side Sentry init sets `includeLocalVariables: true` (capture local variables in stack frames) AND `sendDefaultPii: true`, and there is NO `beforeSend`/`beforeSendTransaction` scrubbing anywhere in the project (verified repo-wide). Generation route handlers decrypt BYOK/platform keys into a plaintext local variable and keep it in scope while making outbound calls. In web/src/app/api/generate/voice/batch/route.ts, line 64 declares `let apiKey: string`, line 74 assigns `apiKey = resolved.key` (the decrypted plaintext key from resolveApiKey -> decryptProviderKey), line 83 constructs `new ElevenLabsClient({ apiKey })`, and lines 89-110 run a loop where exceptions are caught and forwarded to Sentry via `captureException(err, ...)`. The same `apiKey = resolved.key` pattern exists in ~15 generate routes (sprite, model, texture, skybox, music, tileset, sprite-sheet status routes, etc.). The downstream clients put the key into request headers (e.g. web/src/lib/generate/meshyClient.ts:58 `'Authorization': Bearer ${this.config.apiKey}`, spriteClient.ts:208 `'X-Api-Key': this.apiKey`). When any of these clients throw (provider 5xx, network error, JSON parse error) the error propagates while `apiKey`/`resolved`/`client` are in scope.

**Impact:** A users decrypted BYOK API key (Anthropic, ElevenLabs, Meshy, Suno, Replicate, OpenAI, etc.) or the shared platform key can be exfiltrated into Sentry events: includeLocalVariables serializes the in-scope `apiKey`/`client` stack-frame locals, and sendDefaultPii allows request data (including outbound Authorization/X-Api-Key headers) to be attached. Anyone with Sentry project access then sees live, usable third-party credentials. Platform-key exposure is account-wide (billing/abuse); BYOK exposure is a breach of the users own credential the product promised to encrypt at rest.

**Evidence:** web/sentry.server.config.ts:21 `includeLocalVariables: true,` / :22 `sendDefaultPii: true,`. No `beforeSend` found anywhere (grep across web/ returned only includeLocalVariables/sendDefaultPii/maskAllText). web/src/app/api/generate/voice/batch/route.ts:64 `let apiKey: string;` :74 `apiKey = resolved.key;` :83 `const client = new ElevenLabsClient({ apiKey });` :105 `captureException(err, { route: '/api/generate/voice/batch', nodeId: item.nodeId });`. resolver.ts:71 returns `key: decryptProviderKey(byokKey.encryptedKey, byokKey.iv)` (plaintext).

**Recommended fix:** Add a server-side `beforeSend` that strips/denylists sensitive frame variables (apiKey, key, encryptedKey, token, Authorization) and request headers, and consider disabling `includeLocalVariables` on routes that touch decrypted keys. At minimum, narrow the plaintext-key scope: resolve the key, build the client, and null out the local before any throwing I/O, or pass the key through a non-enumerable wrapper. Set sendDefaultPii: false on the server (it is unnecessary for AI/WASM fingerprinting which only needs the message). Mirror the client-side maskAllText protection (instrumentation-client.ts:29) with explicit server-side scrubbing.

---

## P1 findings — near-term (remaining money/auth/dependency holes, proven with real tests)

#### F05 — Platform-key resolution failure deducts tokens without refunding (silent paid-token loss + unhandled re-throw)

**Severity:** 🟠 medium  ·  **Dimension:** apihard (security)  ·  **Issue:** #8597  ·  **Epic:** #8591  
**File:** `web/src/lib/keys/resolver.ts:102-116, web/src/lib/api/createGenerationHandler.ts:265-296`

In resolveApiKey, deductTokens() commits the token UPDATE first (resolver.ts:103, and deductTokens persists via a standalone UPDATE...RETURNING in service.ts:134-145), then getPlatformKey(provider) is called (resolver.ts:113). getPlatformKey throws a plain Error (NOT an ApiKeyError) when the platform key env var is missing (resolver.ts:39-41). In createGenerationHandler the refund logic only wraps the execute() call — never resolveApiKey itself. In the non-cached path (createGenerationHandler.ts:269-279) the catch returns 402 only for ApiKeyError and otherwise does `throw err`, so a post-deduction getPlatformKey failure escapes as a generic uncaught 500, is NOT sent to Sentry there, and usageId was never assigned so the deducted tokens are never refunded. The cached path (lines 220-263) has the same gap: resolveApiKey runs inside the cachedGenerate callback before the refund wrapper, so a throw there is caught at line 255 but usageId is still undefined and no refund happens.

**Impact:** If any PLATFORM_*_KEY env var is unset/misconfigured for a provider, every paid (platform-key) generation for that provider charges the user's tokens and then returns a 500 with no usageId, leaving the user permanently debited with no client-side refund path. The non-cached branch also re-throws without Sentry capture, hiding the failure from observability.

**Recommended fix:** Resolve/validate the platform key BEFORE deductTokens (move getPlatformKey above line 103, or look it up and throw an ApiKeyError-style failure prior to deduction). Alternatively, wrap resolveApiKey's deduction so any throw after a successful deduction refunds the usageId. Replace the bare `throw err` at createGenerationHandler.ts:278 with captureException + a structured 500 response.

#### F06 — Coverage threshold failures are silently swallowed by the vitest#3077 exit-code workaround

**Severity:** 🟠 medium  ·  **Dimension:** ci (testing)  ·  **Issue:** #8598  ·  **Epic:** #8591  
**File:** `.github/workflows/quality-gates.yml:178-187`

The test-web job wraps `vitest run --coverage` and post-processes the exit code: if exit != 0, it only propagates the failure when the output contains a line matching `Test Files.*failed`; otherwise it prints a warning and `exit 0`. I verified in the installed vitest 4.x source (node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js:879-893) that a coverage-threshold violation sets `process.exitCode = 1` and logs `ERROR: Coverage for statements (X%) does not meet global threshold (Y%)`. Crucially, when all tests pass but a threshold is missed, the reporter's `Test Files` summary line (index.UpGiHP7g.js:3023 + getStateString at :3059) only emits the word `failed` when `entry.failed > 0`. With zero failed tests it reads `Test Files  N passed (N)` — no `failed` substring. The grep at line 181 therefore matches nothing, the else-branch runs, and the job exits 0 despite the coverage gate failing. The identical logic is duplicated in cd.yml:180-187.

**Impact:** The 75/65/70/77 coverage thresholds in web/vitest.config.ts are not actually enforced. A PR that drops coverage below threshold (e.g. by adding large untested modules) passes the Web Tests gate. The project's coverage-as-a-gate guarantee — explicitly called out as a CI invariant in CLAUDE.md — is silently broken. Only real test failures block; any non-test-failure non-zero exit (including the coverage gate) is treated as a benign open-handle artifact.

**Evidence:** quality-gates.yml:180 `if sed 's/\x1b\[[0-9;]*m//g' /tmp/vitest-output.txt | grep -q "Test Files.*failed"; then` ... else `exit 0`. vitest source coverage.DM_a_rWm.js:885 `errorMessage = \`ERROR: Coverage for ${thresholdKey} (${coverage}%) does not meet ... threshold\`` with `process.exitCode = 1` at :879.

**Recommended fix:** Distinguish coverage-threshold failures from open-handle hangs. After the run, grep the captured output for `ERROR: Coverage for` / `does not meet .* threshold` and propagate a non-zero exit when present. Better: drop the timeout/grep heuristic entirely and run coverage in a separate `vitest run --coverage` invocation with `--reporter=json` + an explicit threshold check, or use `--coverage.thresholds.autoUpdate=false` with `--bail`, so the exit code is trusted. Reserve the exit-124 special-case strictly for the literal 124 timeout code (already handled at line 174).

#### F07 — OpenAPI spec documents only ~51 of ~95 routes, is hand-maintained, and has no drift gate

**Severity:** 🟠 medium  ·  **Dimension:** contracts (testing)  ·  **Issue:** #8599  ·  **Epic:** #8591  
**File:** `docs/api/openapi.json, web/src/app/api/openapi/route.ts`

docs/api/openapi.json documents 51 paths, while web/src/app/api has 95 route.ts files. ~44 routes are undocumented, including security/operations-sensitive ones: all /api/admin/* (circuit-breaker, db-metrics, economics, moderation, users), /api/stripe/webhook, /api/auth/webhook, /api/user/delete, /api/user/export-data, /api/jobs, /api/cron/health-monitor, /api/game/pipeline, /api/play/[userId]/[slug]/*, /api/publish/[id]/leaderboards/*. There is no generator (grep found no openapi generation script) and no CI step comparing the spec to the actual filesystem routes, so the spec drifts freely. The route handler (openapi/route.ts:17) just reads the static file.

**Impact:** The published OpenAPI contract (served at /api/openapi, consumed by Swagger UI at /api-docs) silently misrepresents the API surface. Clients/integrators relying on it have no coverage for half the routes; new or changed routes never update the contract. Drift between code and the public contract ships undetected.

**Recommended fix:** Add a CI gate that enumerates web/src/app/api/**/route.ts, normalizes [param]->{param}, and asserts each maps to a documented path in docs/api/openapi.json (allowlisting intentionally-internal routes). Better, generate the spec from route metadata so it cannot drift.

#### F08 — CD/MCP npm-audit security gate only fails on critical, so all current high/moderate advisories pass CI silently

**Severity:** 🟠 medium  ·  **Dimension:** deps (security)  ·  **Issue:** #8600  ·  **Epic:** #8591  
**File:** `.github/workflows/cd.yml:451-457`

The 'Rust Security Audit' job runs `npm audit --audit-level=critical` for both web (cd.yml:453) and mcp-server (cd.yml:457). With 0 critical but 2 HIGH advisories at root and 1 HIGH (fast-uri) + 1 moderate (hono) in mcp-server, the gate exits 0 and the pipeline is green despite live HIGH-severity supply-chain issues. This is exactly how 'uncovered alerts' reach production unblocked. The job is also gated `if: github.ref == 'refs/heads/main' || workflow_dispatch`, so it does not even run on PRs.

**Impact:** High-severity vulnerable dependencies (fast-uri path traversal CVSS 7.5, fast-xml-builder injection) never fail CI. The audit gate provides false assurance — it only catches a severity tier the project has never had.

**Recommended fix:** Change to `npm audit --audit-level=high` (or moderate) in cd.yml for both web and mcp-server, and run the security job on pull_request as well, so high-severity advisories block before merge. If specific advisories are accepted, document them explicitly rather than masking via the level threshold.

#### F09 — Game-creation assertions are soft no-ops because E2E_STRICT_STORES is never set in CI

**Severity:** 🟠 medium  ·  **Dimension:** e2e (testing)  ·  **Issue:** #8601  ·  **Epic:** #8591  
**File:** `web/e2e/helpers/store-injection.ts:10, web/e2e/tests/game-creation-flow.spec.ts:172, web/e2e/tests/ai-game-creation.spec.ts:68`

`isStrictMode` is `!!process.env.E2E_STRICT_STORES` (store-injection.ts:10). Grep of .github/workflows and web/package.json shows E2E_STRICT_STORES is set nowhere — CI only sets SKIP_ENV_VALIDATION. With strict mode off, `injectStore()` returns false when the store is absent, and the specs guard every assertion with `if (injected || isStrictMode) { ... if (count > 0) { await expect(...) } }` (e.g. game-creation-flow.spec.ts:172-178, ai-game-creation.spec.ts:68-74). When the awaited element is missing, `count` is 0, the inner expect never runs, and the test passes green. The export-dialog test (game-creation-flow.spec.ts:374-412) likewise only asserts inside `if (injected)` and `if (dialogCount > 0)`.

**Impact:** Even in cd.yml where these specs DO run, the core assertions cannot fail: an entity that never appears in the hierarchy, a tool-call card that never renders, or an export dialog that never opens all yield a passing test. This is coverage theater — the suite reports green regardless of whether the journey works.

**Recommended fix:** Set E2E_STRICT_STORES=true in the job(s) that run these specs (after ensuring the dev server exposes the stores), and remove the `if (count > 0)` short-circuits so a missing element fails the test. A guarded assertion that can never fail provides no protection.

#### F10 — No CI job runs @engine (WASM+GPU) tests; the real interactive journeys only run post-merge

**Severity:** 🟠 medium  ·  **Dimension:** e2e (testing)  ·  **Issue:** #8602  ·  **Epic:** #8591  
**File:** `.github/workflows/ci.yml:300, .github/workflows/cd.yml:411`

ci.yml:300 explicitly notes '@engine tests require WASM + GPU which CI runners lack' and runs only `@ui` minus `@dev`. quality-gates.yml runs only `@smoke` on editor-boot.spec.ts. No PR workflow runs `@engine`. The substantive editor specs (full-walkthrough.spec.ts:18 `@engine`, publish-flow.spec.ts:3 `@engine`, play-mode.spec.ts:7 `@engine`, entity-crud, property-editing, inspector, export, terrain, visual-scripting) all require `editor.load()` which waits for `__FORGE_ENGINE_READY` (editor.fixture.ts:46-51) — unreachable under the `--disable-gpu` headless Chrome used everywhere. They only run, partially, in cd.yml post-merge via the dev server, and even there `@engine` is explicitly inverted out (cd.yml:413).

**Impact:** Real rendering, picking, physics, export, and publish-dialog journeys are never validated by any automated job — `@engine` is excluded post-merge too. The editor's core value proposition is verified only by manual local runs, leaving rendering/ECS regressions to reach production.

**Recommended fix:** Stand up at least one GPU-capable (or SwiftShader/WebGL2-software) runner job that can execute a curated subset of `@engine` smoke journeys (load -> spawn -> play -> export). Even a nightly GPU job would close the gap between 'specs exist' and 'specs run'.

**Resolution (#8602):** Added a per-PR `test-e2e-engine-smoke` CI job (`.github/workflows/ci.yml`) that is the FIRST automated job to boot the real WASM engine. It builds the WebGL2 WASM variant in-job (`cargo build --target wasm32-unknown-unknown --features webgl2` + `wasm-bindgen` 0.2.108), copies it into `web/public/engine-pkg-webgl2/`, then runs a curated `@engine-smoke` spec (`web/e2e/tests/engine-smoke.spec.ts`: load -> spawn Cube -> select + inspect Transform -> Play -> Stop -> export dialog) via `web/playwright.engine.config.ts`. The make-or-break difference from every other CI Playwright config is the launch flags: `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader` (ANGLE/SwiftShader SOFTWARE WebGL2) instead of `--disable-gpu` — the latter leaves wgpu with no GL context so `init_engine()` hangs and `__FORGE_ENGINE_READY` never flips. The spec forces the WebGL2 backend via the app's own `localStorage['forge:preferred-backend'] = 'webgl2'` so `loadWasm()` never probes WebGPU. The job is gated on `needs-web || needs-engine`, wired into the required `CI Success` aggregate (`ci-success` `needs:` list) and into the anti-tamper map in `scripts/check-ci-success.sh` (both arms), so a silent `if: false` unwiring fails CI. The new self-defense cases live in `scripts/__tests__/check-ci-success.test.sh`.

**RESIDUAL GPU GAP (documented, intentionally out of per-PR scope):** SwiftShader is SOFTWARE WebGL2, not WebGPU. This job validates the ECS / picking / play / export / export-dialog journeys end-to-end through the real engine, but does NOT validate the WebGPU code path or real-GPU rendering correctness (e.g. the pink-material / missing-`tonemapping_luts` class of bugs, GPU particle rendering under `bevy_hanabi`, or any output-pixel assertion). Closing that residual gap requires a GPU-capable runner (a nightly/scheduled `@engine` GPU job) and remains tracked as future work; the per-PR job deliberately runs only the curated `@engine-smoke` subset to stay within a software-rendering time budget.

#### F11 — No E2E coverage for playing a published game, marketplace purchase/download, or leaderboards

**Severity:** 🟠 medium  ·  **Dimension:** e2e (testing)  ·  **Issue:** #8603  ·  **Epic:** #8591  
**File:** `web/src/app/play/, web/src/app/marketplace (api/marketplace), web/src/app/community/, web/e2e/tests/`

The app ships /play, /community, /api/marketplace, /api/play/[userId]/[slug]/leaderboard, and /api/publish/[id]/leaderboards routes (confirmed under web/src/app). Grep across all 67 specs for `marketplace`/`leaderboard`/`/play/` navigation returns zero matches for marketplace and leaderboard, and no spec navigates to a `/play/<slug>` published-game URL. play-mode.spec.ts only tests in-editor play mode (`@engine` describe at line 7, `@ui @dev` at line 188), not the public consumer experience of opening a published game by slug.

**Impact:** The public consumer journeys that drive viral growth (E2 milestone) — discovering a game in the marketplace/community, opening it at /play/<slug>, and submitting/viewing a leaderboard score — have no end-to-end protection. A broken published-game player or marketplace listing would ship undetected by the test suite.

**Recommended fix:** Add E2E specs (at least `@api` request-context tests, ideally browser tests) for: GET /play/[slug] renders a published game; marketplace listing/download flow; leaderboard submit + read-back. Tag them so they run in the PR gate.

#### F12 — Only 5 of ~67 spec files actually run in the per-PR CI E2E gate

**Severity:** 🟠 medium  ·  **Dimension:** e2e (testing)  ·  **Issue:** #8604  ·  **Epic:** #8591  
**File:** `web/e2e/tests/, .github/workflows/ci.yml:353`

CI runs `--grep '@ui' --grep-invert '@dev'`. Auditing every describe block, the only specs with `@ui` describes NOT also tagged `@dev` are: api-routes.spec.ts, misc-routes.spec.ts, navigation.spec.ts, public-pages.spec.ts, publish-backend.spec.ts. All of these are HTTP-request/route-existence tests (`request.get/post`, status-code assertions) or public marketing-page render checks. ~30 interactive editor specs (2d-workflows, ai-chat, scene-management, save-load-roundtrip, template-flow, mobile-touch, accessibility-audit, play-mode, etc.) carry `@ui @dev` on their describe and are therefore all excluded.

**Impact:** The per-PR E2E gate exercises no interactive editor behaviour, no WASM, no authenticated flow — it is effectively an API-route smoke test mislabeled as E2E. The headline '~69 Playwright specs' overstates real PR coverage by ~13x; PRs touching the editor UI get no E2E signal.

**Recommended fix:** Audit the `@ui`/`@dev` tagging convention. The `@dev` tag was used to exclude tests needing dev-server-exposed Zustand stores, but it silently disabled almost the entire suite from the PR gate. Make the editor specs production-server compatible (expose stores under a guarded flag) or add a dev-server-backed PR job, then remove the blanket `@dev` exclusion.

#### F13 — Vercel Cron health-monitor is blocked by Clerk auth in production (silent monitoring outage)

**Severity:** 🟠 medium  ·  **Dimension:** infra (security)  ·  **Issue:** #8605  ·  **Epic:** #8591  
**File:** `web/src/proxy.ts:113-173, web/src/app/api/cron/health-monitor/route.ts:28-63, web/vercel.json:11-16`

vercel.json schedules GET /api/cron/health-monitor every 5 minutes. That path is NOT in the proxy's publicRoutes allowlist (web/src/proxy.ts:113-140) and the proxy matcher runs for all '/(api|trpc)/:path*'. For non-public routes the proxy calls await auth() and returns 401 for any /api/* request without a Clerk userId (proxy.ts:160-173). Vercel Cron invocations carry only 'Authorization: Bearer <CRON_SECRET>' and NO Clerk session cookie, so auth() yields no userId and the proxy returns 401 before the route's own isAuthorizedCron() (route.ts:28-39) ever runs. There is no special-case for the x-vercel-cron header anywhere (grep for x-vercel-cron/vercel-cron in proxy.ts and src/lib returns nothing). The route's own tests import GET() directly and never exercise the proxy, so the gap is invisible to CI.

**Impact:** In production (Clerk keys present), the synthetic health monitor cron is rejected with 401 every 5 minutes and never executes runAllHealthChecks(). Sentry alerting for DB/Clerk/provider outages (the whole point of the cron) is silently dead. This fails closed (no security hole) but defeats the monitoring system the team relies on for incident detection.

**Evidence:** proxy.ts:160 `if (!isPublicRoute(req)) { const { userId } = await auth(); if (!userId) { if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); ... } }`. publicRoutes (proxy.ts:113-140) lists /api/health, /api/status, /api/stripe/webhook, /api/auth/webhook — but NOT /api/cron(.*). No x-vercel-cron handling exists.

**Recommended fix:** Add an explicit allowance for Vercel cron in proxy.ts: either add '/api/cron(.*)' to publicRoutes (the route already enforces CRON_SECRET itself), or short-circuit the proxy when req.headers.get('x-vercel-cron') is present, before the Clerk auth() gate. Add an integration test that drives the cron path through the proxy, not just GET() in isolation.

#### F14 — Account deletion never removes the Clerk identity and is auto-undone by user re-sync

**Severity:** 🟠 medium  ·  **Dimension:** privacy (security)  ·  **Issue:** #8606  ·  **Epic:** #8591  
**File:** `web/src/app/api/user/delete/route.ts:19`

POST /api/user/delete calls only `deleteUserAccount(mid.userId!)` (route line 19), which performs a DB-only cascade delete (web/src/lib/auth/user-service.ts:132-234). No Clerk `client.users.deleteUser(clerkId)` call exists anywhere in the delete path (grep across web/src/app/api/user and web/src/lib/auth returns none). Two consequences: (a) the user's PII at Clerk (email, first/last name) survives indefinitely; (b) because authenticateRequest auto-re-syncs a missing DB user from Clerk on the very next authenticated request via attemptSyncWithRetry (web/src/lib/auth/api-auth.ts:70-94, calling syncUserFromClerk), the just-deleted users row is recreated. The session is not revoked, so a self-service delete is effectively reversed on the next request.

**Impact:** The advertised 'permanently delete the authenticated user's account and all associated data' (route docstring) does not fulfill GDPR Article 17 erasure: identity PII remains at the processor (Clerk), and the local deletion is silently reverted. A user who requests deletion is not actually deleted.

**Recommended fix:** After the DB cascade succeeds, call Clerk's `client.users.deleteUser(clerkId)` (and revoke sessions) so the identity is removed and re-sync cannot resurrect the row. Alternatively, mark the row as a deletion tombstone the re-sync path respects. The Clerk user.deleted webhook (web/src/app/api/auth/webhook/route.ts:31-48) already wires DB cleanup, so triggering Clerk deletion would make both paths consistent.

#### F15 — Sandbox escape (constructor-chain to real Function/fetch) is unmitigated in the editor due to permissive CSP allowing unsafe-eval

**Severity:** 🟠 medium  ·  **Dimension:** sandbox (security)  ·  **Issue:** #8607  ·  **Epic:** #8591  
**File:** `web/src/lib/scripting/__tests__/scriptSandbox.test.ts:523-559, web/next.config.ts:20,24`

The sandbox shadows Function/eval/Reflect/Proxy as undefined parameters, but the codebase's own test (scriptSandbox.test.ts:523-559) documents that `(0).constructor.constructor('return fetch')()` reaches the REAL Function constructor and real fetch via the prototype chain — impossible to block in pure JS. The stated mitigations are: (1) Function shadowed, (2) eval shadowed, (3) CSP blocks eval in production, (4) Worker has 'no useful origin'. Items 1-2 are bypassed by the constructor chain. Item 3 is FALSE for the editor: web/next.config.ts:20 sets `script-src 'self' 'unsafe-eval' 'unsafe-inline' 'wasm-unsafe-eval'` for all routes except /play/, so eval/Function are NOT blocked in the editor where the script worker runs. Item 4 is also false: connect-src (next.config.ts:24) allows `'self'` plus api.anthropic.com, api.meshy.ai, api.elevenlabs.io, studio-api.suno.ai, api.hyper3d.ai, so an escaped script CAN fetch same-origin endpoints (cookies/Clerk session attached) and the allowlisted third parties. Workers inherit the owner document's CSP (worker-src 'self'), so the worker runs under the permissive editor CSP.

**Impact:** A malicious or AI-generated script run in the editor (the author's own authenticated session) can break out of the parameter sandbox, obtain the real fetch, and issue same-origin requests with the user's session cookies — reading/exfiltrating the user's projects, token balance, or hitting any /api route as the user. The 'unsafe-inline'+'unsafe-eval' editor CSP also broadly weakens XSS resistance. Community games at /play/ are NOT affected (strict CSP), so blast radius is the editing session, but the in-code security claim that this is mitigated is incorrect and may mask the risk in future changes.

**Recommended fix:** Do not rely on CSP-blocks-eval as the sandbox boundary in the editor. Either (a) serve the script worker from a sandboxed iframe/origin with its own restrictive CSP (no unsafe-eval, connect-src 'none'), or (b) tighten the editor CSP connect-src and remove unsafe-eval from the worker scope, or (c) compile user scripts to a restricted bytecode/AST interpreter rather than via Function(). At minimum, correct the misleading comments in scriptSandbox.test.ts and sandboxGlobals.ts to reflect that the constructor-chain escape is live in the editor CSP context.

#### F16 — Refund idempotency / TOCTOU tests never execute the SQL guard they claim to verify

**Severity:** 🟠 medium  ·  **Dimension:** test-quality (testing)  ·  **Issue:** #8608  ·  **Epic:** #8591  
**File:** `web/src/lib/billing/__tests__/reverseAddonTokens.test.ts`

reverseAddonTokens is the charge-refund money path. Its TOCTOU and idempotency protection lives entirely in a SQL CTE (refunded_cents < amountRefunded claim guard for the purchase path; INSERT ... WHERE NOT EXISTS for the fallback path) in subscription-lifecycle.ts:451-544. The test mocks getNeonSql() to a tagged-template stub that records the call and returns [] (reverseAddonTokens.test.ts:39-50). The 'idempotency' test (lines 120-129) asserts ONLY `expect(mockNeonTransaction).not.toHaveBeenCalled()` — trivially true since this path never uses a transaction — so it proves nothing about idempotency. The fallback idempotency test even admits it (lines 187-189): 'The mock doesn't maintain SQL state, so we verify the query structure includes the NOT EXISTS clause.' Other tests assert only `cteCall!.values).toContain(4900)` / `.toContain('NOT EXISTS')` — substring presence in the template, not behavior. A regression that drops the NOT EXISTS guard, mis-orders the claim, or breaks the FOR UPDATE row lock would let two concurrent refund webhooks double-deduct addon tokens and would pass every test here.

**Impact:** Double-deduction of paid addon tokens on concurrent/duplicate Stripe charge.refunded webhooks would ship undetected — direct user-facing balance loss and refund-abuse vector. The protective SQL is the riskiest code in the file and has zero behavioral coverage.

**Recommended fix:** Add a true DB-backed test (Claimable/ephemeral Postgres, available via the claimable-postgres skill) that runs the real CTE against a seeded token_purchases/users row, fires the refund twice concurrently, and asserts addon_tokens is deducted exactly once and refunded_cents lands at amountRefunded. Keep the mock tests only for the early-return guards (no purchase / not found).

#### F17 — creditAddonTokens tests never assert the per-package token amount credited

**Severity:** 🟠 medium  ·  **Dimension:** test-quality (testing)  ·  **Issue:** #8609  ·  **Epic:** #8591  
**File:** `web/src/lib/tokens/__tests__/service.test.ts`

creditAddonTokens credits the purchased token package after a Stripe payment. The three package tests (service.test.ts:646-670) call creditAddonTokens('user-1','spark'|'blaze'|'inferno', pi) and assert ONLY `mockNeonSql.transaction).toHaveBeenCalledTimes(1)` (and for spark, that there are 2 statements). They never assert how many tokens are credited. The real amounts (pricing.ts:79-81: spark=1000, blaze=5000, inferno=20000) are interpolated into the mocked transaction statements but never checked. A bug that swaps the package→token mapping, credits 0, or always credits the spark amount would pass all three tests.

**Impact:** A user could pay for Inferno (20,000 tokens) and be credited the Spark amount (1,000) — or vice versa, granting 20x tokens for a Spark purchase — with the suite green. Direct money/entitlement correctness with no assertion.

**Recommended fix:** Capture the transaction statement values (the test already uses mockNeonSql.mock.calls[*].slice(1).flat() elsewhere) and assert the exact token count for each package, plus the stripePaymentIntent and amountCents recorded in token_purchases.

#### F18 — handleChargeRefunded tests verify SQL substrings, and 'same CTE on second call' explicitly proves idempotency is never tested

**Severity:** 🟠 medium  ·  **Dimension:** test-quality (testing)  ·  **Issue:** #8610  ·  **Epic:** #8591  
**File:** `web/src/lib/billing/__tests__/chargeRefund.test.ts`

The drizzle-orm mock makes sql/eq/and return constant strings (lines 57-61) and getNeonSql() is a recorder stub. Every deduction assertion is a substring check on the captured template: `cteCall.strings.some(s => s.includes('audit'|'NOT EXISTS'|'ABS'|'EXISTS (SELECT 1 FROM audit)'))` (lines 112-255). The test titled 'second call with same chargeId produces same CTE (SQL idempotency)' (lines 178-191) asserts `mockNeonSqlCalls.length === firstCallCount * 2` — i.e. it confirms the CTE fires AGAIN on a duplicate, and the comment states 'idempotency is enforced by the SQL NOT EXISTS, not by JS-side deduplication' — meaning the actual no-double-deduct behavior is provably outside the test's reach. The div-by-zero/ratio-cap tests (lines 194-229) only assert the ratio value is interpolated, never that the SQL computes a safe result.

**Impact:** The refund money path's idempotency and division-by-zero safety are asserted by string-matching SQL text. Renaming a CTE, breaking the WHERE NOT EXISTS, or introducing a div-by-zero would pass as long as the substrings remain — false confidence on a revenue-affecting handler.

**Recommended fix:** Drive these through a real Postgres fixture and assert observable outcomes (addon_tokens after one vs two identical webhooks; behavior when amount_cents=0). Demote the substring checks to at most one structural smoke test.

#### F19 — subscriptionLifecycle.db.test.ts is named a DB test but is fully mock-based; balanceAfter/rollover SQL never runs

**Severity:** 🟠 medium  ·  **Dimension:** test-quality (testing)  ·  **Issue:** #8611  ·  **Epic:** #8591  
**File:** `web/src/lib/billing/__tests__/subscriptionLifecycle.db.test.ts`

The '.db' filename and header ('DB-level tests', 'Audit transaction records (balanceAfter computed from snapshot)') imply real database coverage, but getNeonSql/getDb/drizzle-orm are all mocked (lines 63-95). Tests assert that specific scalars are interpolated into the captured template (e.g. `insertValues).toContain(3000)`, `toContain('upgrade:creator->pro')`, statement counts via transactionStatementCount). The actual SQL correctness — the INSERT...SELECT that computes balanceAfter as GREATEST(0, monthly_tokens - monthly_tokens_used) + addon_tokens + earned_credits, the rollover cap, and the downgrade clamp — is never executed. The test at line 560 ('balanceAfter is computed in SQL ... not from a stale JS snapshot') only checks that 3000 is interpolated and that selectCallCount===1; it cannot detect a wrong GREATEST/clamp expression.

**Impact:** Misleading filename creates false confidence that subscription tier-change billing math is DB-verified. A bug in the balanceAfter or rollover-cap SQL (wrong sign, missing clamp, wrong column) would ship green, corrupting audit balances and token grants on upgrade/downgrade/renewal.

**Recommended fix:** Either rename to subscriptionLifecycle.mock.test.ts and scope it to statement-shape/guard-clause assertions, or convert it to an actual ephemeral-Postgres test that runs the transactions and asserts the resulting users/credit_transactions rows.

---

## P2 findings — hardening (sandbox, real E2E, contract gates, lower-risk items)

#### F20 — CSP script-src allows both 'unsafe-inline' and 'unsafe-eval'

**Severity:** 🟡 low  ·  **Dimension:** apihard (security)  ·  **Issue:** #8612  ·  **Epic:** #8592  
**File:** `web/next.config.ts:20`

The global Content-Security-Policy sets `script-src 'self' 'unsafe-eval' 'unsafe-inline' 'wasm-unsafe-eval' ...`. The inline comment (lines 17-19) justifies 'unsafe-inline' for Clerk and argues it 'does not meaningfully reduce security' because 'unsafe-eval' is already present for WASM. Both directives together remove essentially all XSS mitigation from CSP for the authenticated editor/app surface: 'unsafe-inline' permits injected inline scripts and event handlers, and 'unsafe-eval' permits string-to-code execution. WASM only requires 'wasm-unsafe-eval' (already present), so 'unsafe-eval' is likely not actually needed for WASM in modern browsers.

**Impact:** Any reflected/stored/DOM XSS on app routes (e.g. user-controlled content rendered in the editor or community pages) executes unrestricted. The stricter /play/:path* CSP (lines 96-103) correctly omits both, showing a strict policy is achievable; the app surface does not benefit from CSP defense-in-depth.

**Recommended fix:** Drop 'unsafe-eval' (keep 'wasm-unsafe-eval' for WASM) and migrate Clerk to a nonce/hash-based script-src to remove 'unsafe-inline'. Next.js supports per-request nonces via middleware. At minimum, scope the relaxed directives to the specific routes that require them rather than the global /:path* rule.

#### F21 — Moderation appeals can be filed against arbitrary content the appellant never authored

**Severity:** 🟡 low  ·  **Dimension:** authz (security)  ·  **Issue:** #8613  ·  **Epic:** #8592  
**File:** `web/src/app/api/moderation/appeal/route.ts`

POST /api/moderation/appeal accepts { contentId, contentType, reason } from any authenticated user and inserts a moderationAppeals row with userId = the caller, but never verifies that the caller authored or owns the referenced contentId. There is no lookup joining contentId to the appellant. The appeal then surfaces in the admin queue (admin/moderation/appeals/route.ts), and on approval the reviewer route unflags the targeted comment purely by appeal.contentId (admin/moderation/appeals/[id]/review/route.ts: `update(gameComments).set({flagged:0}).where(eq(gameComments.id, appeal.contentId))`) without re-checking that the appellant had any relationship to that comment.

**Impact:** Any user can flood the moderation queue with appeals about other people's flagged content (queue spam, rate-limited to 5/10min/IP), and can craft an appeal targeting a comment they don't own; if an admin approves it, that arbitrary comment is unflagged. The admin-in-the-loop limits direct exploitation, but the system trusts an attacker-supplied contentId end-to-end.

**Recommended fix:** In the appeal POST, verify the authenticated user owns the referenced content (e.g. join gameComments.userId == userId for contentType 'comment', publishedGames.userId for 'game', marketplaceAssets.sellerId for 'asset') and reject (404/403) otherwise. In the review route, re-confirm the appeal/content linkage before mutating flags.

#### F22 — Public community game detail endpoint leaks unpublished/processing games (missing status filter)

**Severity:** 🟡 low  ·  **Dimension:** authz (security)  ·  **Issue:** #8614  ·  **Epic:** #8592  
**File:** `web/src/app/api/community/games/[id]/route.ts`

The public GET /api/community/games/[id] handler fetches a game by id with `.where(eq(publishedGames.id, id))` and returns it (title, description, slug, authorId, cdnUrl, status, comments) with no filter on publish status. The sibling LIST endpoint web/src/app/api/community/games/route.ts:27 explicitly restricts to `eq(publishedGames.status, 'published')`, so the two endpoints disagree. The publishStatusEnum (schema.ts:231) is ['published','unpublished','processing'] with a default of 'processing', and DELETE /api/publish/[id] sets status='unpublished' (publish/[id]/route.ts). Therefore a game that was unpublished by its owner, or is still in the 'processing' state right after creation, remains fully readable by any unauthenticated caller who knows or enumerates the game id — including its cdnUrl (the playable build) and comment thread. The detail route is unauthenticated (rateLimitPublicRoute only).

**Impact:** A creator's intent to take a game offline (unpublish) is not honored on the canonical detail endpoint: the game body and its CDN build URL stay publicly retrievable by id. Games in 'processing' (the default state at creation, before review/publish) are similarly exposed. This is a confidentiality/access-control failure for any content the owner believes is private or pre-publication.

**Recommended fix:** Add `eq(publishedGames.status, 'published')` to the WHERE clause of the detail GET (matching the list endpoint), returning 404 for non-published games to avoid leaking existence. If admins/owners need to preview non-published games, gate that behind an authenticated branch that verifies ownership or assertAdmin.

#### F23 — CodeQL excludes the single highest-risk file (scriptWorker.ts Function() sandbox) from all static analysis

**Severity:** 🟡 low  ·  **Dimension:** ci (testing)  ·  **Issue:** #8615  ·  **Epic:** #8592  
**File:** `.github/codeql/codeql-config.yml:9-10`

The CodeQL config paths-ignore lists `web/src/lib/scripting/scriptWorker.ts`. That file is the user-script sandbox that intentionally uses `Function()` to compile user-authored game scripts. The config comment justifies the exclusion as suppressing a known false positive for the `Function()` call. But paths-ignore removes the ENTIRE file from CodeQL analysis, not just the one alert — so any future injection, prototype-pollution, ReDoS, or sandbox-escape bug introduced in the most security-sensitive file in the codebase will never be flagged.

**Impact:** The component most likely to contain an exploitable code-execution vulnerability receives zero CodeQL coverage. A regression that weakens the sandbox (global shadowing, command whitelist, watchdog) would not be caught by static analysis.

**Recommended fix:** Replace the file-level paths-ignore with a targeted suppression: use an inline `// codeql[js/eval-like-call]` lint-style suppression or a query-level filter (a CodeQL query-filters block excluding only the specific `js/code-injection` rule for that one call site), so the rest of the file remains analyzed.

#### F24 — CodeQL runs only on push-to-main and weekly schedule — never on pull requests

**Severity:** 🟡 low  ·  **Dimension:** ci (testing)  ·  **Issue:** #8616  ·  **Epic:** #8592  
**File:** `.github/workflows/codeql.yml:3-7`

codeql.yml triggers are `push: branches: [main]` and `schedule: cron '17 7 * * 3'` (weekly). There is no `pull_request` trigger. CodeQL therefore analyzes code only AFTER it has already merged to main, or up to a week later on the schedule. Additionally, the Rust language matrix entry uses `build-mode: none` (codeql.yml:32), which disables the compiler-driven extraction needed for full Rust dataflow analysis — Rust coverage is limited to what the no-build extractor can see.

**Impact:** Security findings (the whole point of CodeQL) are surfaced post-merge instead of as a blocking PR gate, so vulnerable code reaches main before detection. Between weekly runs, a vulnerability could sit undetected for days. build-mode:none further narrows what is detectable in the Rust engine.

**Recommended fix:** Add a `pull_request: branches: [main]` trigger to codeql.yml so analysis runs on PRs and can be made a required check. Evaluate `build-mode: manual` (with the wasm32 build) or autobuild for the Rust target to enable fuller dataflow analysis; if the WASM build cost is prohibitive on PRs, run JS/TS + actions on PR and keep Rust on the schedule.

#### F25 — npm audit gate only blocks on 'critical' — high/moderate vulnerabilities never fail CI

**Severity:** 🟡 low  ·  **Dimension:** ci (testing)  ·  **Issue:** #8617  ·  **Epic:** #8592  
**File:** `.github/workflows/quality-gates.yml:426-435`

Both the security job in quality-gates.yml (lines 428 and 435) and in cd.yml (lines 453 and 457) run `npm audit --audit-level=critical` for web and mcp-server. This means only `critical`-severity advisories cause a non-zero exit; `high`, `moderate`, and `low` advisories are reported but do not fail the build. Given this is a SaaS handling Stripe payments, Clerk auth, and BYOK encrypted keys, allowing known high-severity dependency vulnerabilities to ship is a real weakness.

**Impact:** A dependency with a known high-severity vulnerability (e.g. an SSRF, auth-bypass, or RCE rated 'high' rather than 'critical') passes the security gate and deploys to production.

**Recommended fix:** Lower the threshold to `--audit-level=high` (and ideally `moderate`). If specific advisories are unactionable, suppress them individually via `npm audit --omit=dev` plus an allowlist (e.g. `audit-ci` with a documented exceptions file) rather than blanket-ignoring an entire severity tier.

#### F26 — Drizzle migrations are incomplete: 3 live tables have no migration (schema/migration drift)

**Severity:** 🟡 low  ·  **Dimension:** contracts (testing)  ·  **Issue:** #8618  ·  **Epic:** #8592  
**File:** `web/drizzle/0000_large_mephisto.sql, web/src/lib/db/schema.ts:538,556,578`

schema.ts declares 28 pgTable() definitions, but the migration set (0000_large_mephisto.sql + 0001_rename_webhook_events.sql + 0002_credit_txn_idempotent_index.sql) only creates 25 tables. Three tables — leaderboards (schema.ts:538), leaderboard_entries (schema.ts:556), and moderation_appeals (schema.ts:578) — have NO migration that creates them. These are not dead code: live routes use them (web/src/app/api/publish/[id]/leaderboards/route.ts, web/src/app/api/play/[userId]/[slug]/leaderboard/route.ts, web/src/app/api/admin/moderation/appeals/route.ts, web/src/app/api/moderation/appeal/route.ts). The drift is masked in production because cd.yml:747 runs `npx drizzle-kit push` (direct schema sync) rather than `drizzle-kit migrate`, so prod gets the tables anyway. webhook_events IS covered (renamed from processed_webhook_events in 0001).

**Impact:** The web/drizzle/ migration files are not the source of truth and cannot reproduce the database from scratch. Anyone using `db:migrate` (instead of `db:push`) — a fresh environment, a disaster-recovery rebuild, or a contributor following the documented migration workflow — gets a schema missing 3 tables, causing runtime 'relation does not exist' errors on leaderboard and moderation-appeal routes. Migration history is also unreliable for audit/rollback. No CI check (no drizzle-kit drift gate in .github/workflows/) catches this.

**Recommended fix:** Run `drizzle-kit generate` to produce the missing migration(s) for leaderboards, leaderboard_entries, and moderation_appeals, commit them under web/drizzle/, and add a CI step that runs `drizzle-kit generate --dry-run` (or equivalent) to fail when schema.ts and the migration set diverge. Standardize prod deploy on `migrate`, not `push`.

#### F27 — Full manifest-to-handler resolution is only covered by 29 representatives in vitest (CI safety relies on a regex script)

**Severity:** 🟡 low  ·  **Dimension:** contracts (testing)  ·  **Issue:** #8619  ·  **Epic:** #8592  
**File:** `web/src/lib/chat/__tests__/executorIntegrationBroad.test.ts:321-344, web/scripts/check-command-parity.js`

274 of 350 manifest commands are exposed to Claude via getChatTools() (requiredScope ':write' or category 'query'; web/src/lib/chat/tools.ts:42). The vitest integration suite only exercises 29 representative tools — one per handler domain (executorIntegrationBroad.test.ts:321 asserts `allDomains.size === 29`). It does not iterate all exposed commands to assert each resolves to a handler. The actual full-coverage guarantee is provided solely by web/scripts/check-command-parity.js, a brace-depth + regex line parser (KEY_LINE_RE) that scans handler files textually rather than importing the registry. If a handler is registered in a way the regex/brace heuristic misses (computed keys, spread re-exports, unusual formatting), the parity script could false-pass or false-fail.

**Impact:** The robust contract (manifest command -> live handler) hinges on a fragile text parser, not on the real handlerRegistry object. A formatting or structural change to a handler module could cause the parity gate to silently stop counting a handler, and the vitest suite (29 reps) would not catch a gap in the other ~245 exposed commands.

**Recommended fix:** Add a vitest that imports handlerRegistry and getChatTools() directly and asserts every exposed tool name has a function in handlerRegistry (and optionally that every handler key is a manifest command). This validates the actual runtime objects, complementing the regex script.

#### F28 — Manifest-sync CI gate is path-filtered so edits to only the web copy escape the check

**Severity:** 🟡 low  ·  **Dimension:** contracts (testing)  ·  **Issue:** #8620  ·  **Epic:** #8592  
**File:** `.github/workflows/ci.yml:54,147,178`

The docs-internal-gate that runs check-manifest-sync.ts (ci.yml:178) is conditioned on `needs-docs == 'true'` (ci.yml:147), and needs-docs is set by `grep -qE '^apps/docs/|^mcp-server/manifest/'` (ci.yml:54). The sync check compares the canonical mcp-server/manifest/commands.json against the copy web/src/data/commands.json — but the copy's path (web/src/data/) is NOT part of the needs-docs filter. A PR that edits ONLY web/src/data/commands.json (bad merge, manual edit, codegen) sets needs-web=true but needs-docs=false, so the sync gate does not run. command-parity (ci.yml:108) runs on needs-web but reads the canonical manifest only and never compares it to the web copy.

**Impact:** The two command manifests can drift without any CI gate firing, when only the web copy is modified. Since getChatTools() in production reads web/src/data/commands.json (web/src/lib/chat/tools.ts:10), a divergent copy would ship a different tool surface to Claude than the canonical/MCP manifest, with no detection.

**Recommended fix:** Add `^web/src/data/commands.json` to the needs-docs grep in ci.yml:54 (or make the manifest-sync check run whenever needs-web OR needs-docs is true).

#### F29 — contracts.test.ts validates ajv schemas only against synthetic objects, never real route responses

**Severity:** 🟡 low  ·  **Dimension:** contracts (testing)  ·  **Issue:** #8621  ·  **Epic:** #8592  
**File:** `web/src/app/api/__tests__/contracts.test.ts:499-573`

Part 2 compiles the OpenAPI component schemas (TokenBalance, GenerationStatus, Error, etc.) into ajv validators and runs them against hand-written literals (e.g. contracts.test.ts:503-510 builds a valid TokenBalance object by hand and validates it). At no point is an actual route handler's success-response body fed into the matching validator. The only real-handler responses validated against a schema are 401 Error bodies (Part 3, lines 612-657) and three manual typeof field checks on health/capabilities (not via ajv). Grep for `validator(body)`/`Validator(body)` returns nothing.

**Impact:** The test proves the spec's schemas are internally well-formed and that ajv works — but it does NOT verify that any route actually returns data matching its documented schema. If e.g. /api/tokens/balance renamed a field or changed a type, the contracts test would still pass (it validates a hand-built object, not the route's output). This is the exact API-response drift the suite is meant to catch.

**Recommended fix:** For each schema-backed success route (tokens/balance, generate/*/status, etc.), import the handler with mocked I/O, invoke it, parse the 200 body, and run it through the corresponding ajv validator — asserting validate(body) === true and failing on additionalProperties/wrong types.

#### F30 — manifest.test.ts category 'snapshot guard' is tautological and validCategories no longer exists

**Severity:** 🟡 low  ·  **Dimension:** contracts (testing)  ·  **Issue:** #8622  ·  **Epic:** #8592  
**File:** `mcp-server/src/manifest.test.ts:48-63`

The test 'category set has not changed unexpectedly (snapshot guard)' derives knownCategories from the manifest itself at test time (`[...new Set(manifest.commands.map(c => c.category))]`) and then asserts every command's category is in that derived set — which is trivially always true. The final guard only asserts `knownCategories.length > 0`. There is no pinned/expected category list, so a category being silently added or removed never fails the test. CLAUDE.md and rule files reference a `validCategories` array to maintain (rules/file-map.md: 'update validCategories when adding categories'), but grep finds no validCategories symbol anywhere in mcp-server/ or apps/docs/ — the referenced enforcement does not exist.

**Impact:** The category-drift guard provides no protection; new or removed categories ship undetected. Documentation instructs maintainers to update a symbol that does not exist, causing wasted effort and false confidence.

**Recommended fix:** Pin an explicit EXPECTED_CATEGORIES array in the test and assert the manifest's derived category set equals it exactly (so additions/removals require a deliberate edit). Remove or correct the stale validCategories references in the rules.

#### F31 — schema.test.ts 'exactly N tables' assertion is tautological and missed 4 new tables

**Severity:** 🟡 low  ·  **Dimension:** contracts (testing)  ·  **Issue:** #8623  ·  **Epic:** #8592  
**File:** `web/src/lib/db/__tests__/schema.test.ts:36-41`

The test 'exports exactly the expected number of tables' builds a hardcoded array of 24 table names and asserts `expect(tables.length).toBe(24)`. It checks the length of its own local array literal — not the number of tables in the schema module. The companion test only iterates that same hardcoded 24-name list. schema.ts actually defines 28 tables; the 4 newer ones (leaderboards, leaderboardEntries, moderationAppeals, webhookEvents) are absent from the test list, so the test still passes at 24 while the schema grew to 28.

**Impact:** A guard intended to catch table additions/removals provides zero protection: it always passes regardless of the real schema. Four tables were added with no schema-contract coverage and the drift was invisible. Any future table add/remove/rename ships untested.

**Recommended fix:** Derive the table count from the schema module itself: `Object.values(schema).filter(isTableObject).length`, and assert that against an explicit expected number, or snapshot the actual table-name set extracted from the Drizzle table symbols. The expected count must update deliberately when tables change.

#### F32 — creditAddonTokens (Stripe token-pack purchase) has no payment_intent idempotency in code or test — double-credit money-loss risk

**Severity:** 🟡 low  ·  **Dimension:** cov-critical (testing)  ·  **Issue:** #8624  ·  **Epic:** #8592  
**File:** `web/src/lib/tokens/service.ts:363-390`

creditAddonTokens() unconditionally runs `UPDATE users SET addon_tokens = addon_tokens + tokens` + `INSERT INTO token_purchases (... stripe_payment_intent ...)` with NO `WHERE NOT EXISTS` guard on the payment_intent (service.ts:376-389). The token_purchases schema (web/src/lib/db/schema.ts:125-138) has NO unique constraint on stripe_payment_intent — only `id` is a primary key. The only protection against crediting the same purchase twice is the webhook's per-event-id claimEvent() (web/src/app/api/stripe/webhook/route.ts:75). Stripe can deliver the same payment_intent under different event IDs (e.g. a re-created/duplicated webhook endpoint, or both checkout.session.completed and payment_intent.succeeded mapped to the same one-time payment), which would bypass the event-id claim and credit tokens twice. The three creditAddonTokens tests (service.test.ts:646-672) only assert the happy path (a 2-statement transaction is called) — none assert that a duplicate payment_intent is rejected. Contrast with refundTokens, which DOES have a metadata->>'refundedUsageId' CTE idempotency guard AND tests for it (service.ts:226-248, service.test.ts:421).

**Impact:** A redelivered/duplicated webhook for the same one-time token purchase credits add-on tokens to the user more than once, granting paid currency for free. Money loss with no test or code-level guard to catch a regression.

**Recommended fix:** Add a code-level idempotency guard keyed on stripe_payment_intent (WHERE NOT EXISTS or a DB unique constraint on token_purchases.stripe_payment_intent) and add a test asserting creditAddonTokens with an already-seen payment_intent does not credit a second time. Until then, add at minimum a regression test pinning the current single-credit behavior.

#### F33 — publish [id] unpublish/DELETE — non-owner-cannot-unpublish ownership case untested (2-case test)

**Severity:** 🟡 low  ·  **Dimension:** cov-critical (testing)  ·  **Issue:** #8625  ·  **Epic:** #8592  
**File:** `web/src/app/api/publish/[id]/route.ts:24`

The publish [id] route is an ownership-gated mutation: it deletes/unpublishes scoped by `and(eq(publishedGames.id, id), eq(publishedGames.userId, mid.userId!))` (route.ts:24), so a non-owner targeting another user's published game id should be a no-op (effectively 404/empty). Its dedicated test (web/src/app/api/publish/[id]/route.test.ts) contains only TWO cases: '401 when not authenticated' and 'unpublish game and return success'. There is no test asserting that a request from a non-owner (valid auth, someone else's game id) does NOT unpublish the game, nor a 404/no-op for a nonexistent id. The ownership is correct by construction in the WHERE clause, but a regression that drops the `eq(userId)` term (a known high-frequency class of bug — IDOR) would not be caught.

**Impact:** Loss of regression protection on a destructive, ownership-gated endpoint. If the userId scoping is ever removed, a user could unpublish (take down) another user's published game and no test would fail.

**Recommended fix:** Add a test: authenticated non-owner DELETEs another user's publishedGames.id -> the DB delete affects 0 rows and the response indicates not-found / no mutation. Assert the delete WHERE includes the userId scope (or that no rows are affected for a foreign id).

#### F34 — Dependabot npm watches /web and /mcp-server (no lockfiles) but not the root single lockfile

**Severity:** 🟡 low  ·  **Dimension:** deps (security)  ·  **Issue:** #8626  ·  **Epic:** #8592  
**File:** `.github/dependabot.yml (npm entries: directory /web and /mcp-server)`

This is an npm workspaces monorepo with a single root package-lock.json (797KB at repo root); `ls web/package-lock.json mcp-server/package-lock.json` returns 'No such file or directory'. dependabot.yml declares npm package-ecosystem for directory /web and directory /mcp-server, but there is no npm entry for the root '/'. In a single-root-lockfile workspace, Dependabot must target the directory containing the lockfile (root) to resolve and update the actual dependency tree. Watching /web and /mcp-server (which lack lockfiles) means root-resolved transitives are not properly monitored — consistent with the branch name 'dependabot-uncovered-alerts'.

**Impact:** Dependabot security/version PRs may not be generated for the real resolved tree, so transitive vulnerabilities (e.g. fast-uri, fast-xml-builder, hono) silently accumulate without automated update PRs. The overrides block (the actual remediation mechanism) lives in root package.json which Dependabot npm is not configured to manage.

**Recommended fix:** Add an npm Dependabot entry for directory '/' (the lockfile location) so workspace dependencies are monitored against the single root package-lock.json. Verify Dependabot resolves the workspace correctly (Dependabot supports workspace lockfiles at the root directory).

#### F35 — Third-party and first-party GitHub Actions use floating/mutable tags instead of SHA pins

**Severity:** 🟡 low  ·  **Dimension:** deps (security)  ·  **Issue:** #8627  ·  **Epic:** #8592  
**File:** `.github/workflows/quality-gates.yml:743 (chromaui/action@v17), cd.yml:287,459 & quality-gates.yml:256,437 (dtolnay/rust-toolchain@stable)`

The hand-written workflows pin actions by mutable tag rather than commit SHA: chromaui/action@v17 (third-party, quality-gates.yml:743), Swatinem/rust-cache@v2 (cd.yml:291,461; quality-gates.yml:261,439), changesets/action@v1 (release.yml:31), and first-party actions/checkout@v6, actions/setup-node@v6, actions/upload-artifact@v4, actions/download-artifact@v8, actions/cache@v5. Most concerning is dtolnay/rust-toolchain@stable used in 4 places (cd.yml:287,459; quality-gates.yml:256,437) — '@stable' is a mutable BRANCH ref, not even a version tag, so its contents can change under the project at any time. By contrast the gh-aw-generated .lock.yml workflows and codeql-action are correctly SHA-pinned with version comments.

**Impact:** A compromised or maliciously updated third-party action published under an existing tag/branch (chromaui/action@v17, dtolnay/rust-toolchain@stable) would execute in CI with repository token access, enabling secret exfiltration or build tampering. Mutable '@stable' branch refs are the weakest form of pinning.

**Recommended fix:** SHA-pin all third-party actions (chromaui/action, Swatinem/rust-cache, changesets/action, dtolnay/rust-toolchain) with a trailing version comment, mirroring the pattern already used in the .lock.yml and codeql-action workflows. At minimum replace dtolnay/rust-toolchain@stable with a SHA or explicit toolchain version, since @stable is a mutable branch.

#### F36 — fast-uri@3.1.0 (HIGH, path traversal / host confusion) is unpinned by any override

**Severity:** 🟡 low  ·  **Dimension:** deps (security)  ·  **Issue:** #8628  ·  **Epic:** #8592  
**File:** `package-lock.json fast-uri@3.1.0 via ajv@8.20.0 (web/)`

npm audit reports fast-uri as HIGH: GHSA-q3j6-qgpj-74h6 (path traversal via percent-encoded dot segments, CVSS 7.5, range <=3.1.0) and GHSA-v39h-62p7-jpjc (host confusion via percent-encoded authority delimiters, CVSS 7.5, range <=3.1.1). Resolved version is fast-uri@3.1.0 via web -> ajv@8.20.0 -> fast-uri. No override exists for fast-uri in root, web, or mcp-server package.json (grep returns nothing). It also appears in mcp-server's audit as the sole HIGH. Patched range is >3.1.1 (latest 3.1.2); npm audit reports fixAvailable:true.

**Impact:** ajv is used for JSON schema validation (e.g. MCP manifest contracts). The fast-uri path-traversal/host-confusion bugs affect URI ref resolution; both advisories are HIGH (CVSS 7.5) and live in both web and mcp-server audits with no override mitigating them.

**Recommended fix:** Add an override `"fast-uri": ">=3.1.2"` to root package.json overrides, reinstall to record it in the lockfile, and confirm via `npm ls fast-uri` that 3.1.0 is replaced. Re-run `npm audit` in both root and mcp-server to confirm the HIGH advisories clear.

#### F37 — fast-xml-builder@1.1.5 (HIGH) is uncovered — only fast-xml-parser is overridden

**Severity:** 🟡 low  ·  **Dimension:** deps (security)  ·  **Issue:** #8629  ·  **Epic:** #8592  
**File:** `web/package.json:overrides (fast-xml-parser only) / package-lock.json fast-xml-builder@1.1.5`

npm audit flags fast-xml-builder as HIGH (GHSA-5wm8-gmm8-39j9 — attribute injection / XXE, CWE-91/CWE-611) plus a moderate (GHSA-45c6-75p6-83cc). The resolved version is fast-xml-builder@1.1.5 via @aws-sdk/client-s3 -> @aws-sdk/core -> @aws-sdk/xml-builder -> fast-xml-parser@5.7.2 -> fast-xml-builder@1.1.5. The overrides in root and web package.json pin 'fast-xml-parser: >=5.7.2' but there is NO override for the distinct package fast-xml-builder, so it stays at the vulnerable 1.1.5. Patched version is 1.2.0 (fixAvailable:true in audit).

**Impact:** S3/asset upload paths use the AWS SDK XML builder; the high advisory permits attribute-value quote bypass enabling injection of unwanted/malicious XML attributes. Despite the project explicitly addressing fast-xml-parser, the sibling builder package was missed, leaving a HIGH advisory live in both root and web audits.

**Recommended fix:** Add an override `"fast-xml-builder": ">=1.2.0"` to root package.json overrides (and web/package.json), reinstall to record it in the lockfile, and re-run `npm ls fast-xml-builder` to confirm 1.2.0. Verify the AWS SDK still functions (xml-builder is a transitive of @aws-sdk/xml-builder).

#### F38 — hono override pins ^4.12.14 -> resolves 4.12.15, below patched 4.12.18; multiple hono advisories remain

**Severity:** 🟡 low  ·  **Dimension:** deps (security)  ·  **Issue:** #8630  ·  **Epic:** #8592  
**File:** `package.json:overrides 'hono':'^4.12.14' / package-lock.json hono@4.12.15`

Root override is `"hono": "^4.12.14"`, which the lockfile resolves to hono@4.12.15. npm audit reports five hono advisories whose fixed version is 4.12.18 (and one needing 4.12.16): GHSA-qp7p-654g-cw7p (CSS declaration injection, moderate), GHSA-p77w-8qqv-26rm (cache middleware ignores Vary: Authorization/Cookie -> cross-user cache leakage, moderate), GHSA-9vqf-7f2p-gf9v (bodyLimit bypass, moderate), GHSA-69xw-7hcm-h432 (JSX tag-name HTML injection, moderate), GHSA-hm8q-7f3q-5f36 (JWT NumericDate validation, low). hono is pulled in via @modelcontextprotocol/sdk and @hono/node-server in mcp-server. latest is 4.12.23.

**Impact:** The override floor is one patch below the security fix, so the MCP server keeps a hono version with several known issues (most notably the cache-middleware cross-user leakage and bodyLimit bypass). Because the override floor is ^4.12.14 not >=4.12.18, a reinstall will not raise it.

**Recommended fix:** Bump the hono override to `">=4.12.18"` (ideally `^4.12.23`) in root package.json, reinstall to record in lockfile, and re-run `npm ls hono` to confirm. Confirm @hono/node-server peer range still satisfied.

#### F39 — Game Creation E2E (roadmap #1 priority) is excluded from PR CI by the @dev tag

**Severity:** 🟡 low  ·  **Dimension:** e2e (testing)  ·  **Issue:** #8631  ·  **Epic:** #8592  
**File:** `web/e2e/tests/game-creation-flow.spec.ts:24, web/e2e/tests/ai-game-creation.spec.ts:19, .github/workflows/ci.yml:353`

The two flagship Game Creation specs are tagged `test.describe('Game Creation Flow @ui @dev', ...)` (game-creation-flow.spec.ts:24) and `test.describe('AI Game Creation Flow @ui @dev', ...)` (ai-game-creation.spec.ts:19). The per-PR CI E2E job runs `npx playwright test --grep '@ui' --grep-invert '@dev' ... --config playwright.ci.config.ts` (ci.yml:353). Because `--grep-invert '@dev'` matches the describe title that contains `@dev`, BOTH suites are excluded from the PR gate entirely. They only ever run in cd.yml (post-merge deploy pipeline, line 411), never as a PR check.

**Impact:** The single most important user journey per the roadmap (AI prompt -> entities -> play -> export) has no PR-blocking E2E enforcement. A regression that breaks the chat panel, entity spawning, play mode, or export dialog will pass all PR checks and only surface (if at all) after merge in the CD pipeline.

**Recommended fix:** Either run these journeys against the dev server in a dedicated PR E2E job (mirroring cd.yml's default-config invocation) instead of `next start`, or split store-injection into a production-safe hook so the `@dev` exclusion is no longer needed. At minimum, add a PR job that runs the game-creation specs against `npm run dev:raw` so the priority journey is gated.

#### F40 — Signup/auth journey is entirely test.skip'd in CI (no Clerk keys)

**Severity:** 🟡 low  ·  **Dimension:** e2e (testing)  ·  **Issue:** #8632  ·  **Epic:** #8592  
**File:** `web/e2e/tests/navigation.spec.ts:110, web/e2e/tests/public-pages.spec.ts:11`

The only auth/signup assertions live behind `test.skip(!isClerkConfigured(), ...)` (navigation.spec.ts:111, sign-in navigation at line 110-127) and `test.skip(!hasClerk, ...)` (public-pages.spec.ts:11-15, repeated 6x). CI runs with SKIP_ENV_VALIDATION=true and no Clerk keys, so `isClerkConfigured()`/`hasClerk` are false and these tests are skipped. There is no mocked-auth or test-user signup E2E that runs in CI.

**Impact:** The signup -> first-session activation funnel (E4 onboarding milestone) has zero executed E2E coverage in CI. Sign-in button navigation, pricing-page auth gating, and post-auth redirects are never exercised, so an auth-flow regression passes CI.

**Recommended fix:** Add a CI path that provisions test Clerk keys (or mocks the Clerk middleware) so at least the sign-in navigation and pricing-gate tests run rather than skip. Alternatively add a Clerk testing-token based authenticated fixture for one happy-path signup E2E.

#### F41 — Stripe / billing / token-depletion E2E (@api) run in no CI job at all

**Severity:** 🟡 low  ·  **Dimension:** e2e (testing)  ·  **Issue:** #8633  ·  **Epic:** #8592  
**File:** `web/e2e/tests/billing-flow.spec.ts:9, web/e2e/tests/token-depletion.spec.ts:9, .github/workflows/ci.yml:353`

billing-flow.spec.ts:9 (`@api`), token-depletion.spec.ts:9 (`@api`), and infrastructure-routes.spec.ts are tagged `@api`. The PR CI E2E job filters on `--grep '@ui'` (ci.yml:353) and quality-gates.yml runs only `--grep '@smoke'` scoped to editor-boot.spec.ts (quality-gates.yml:400-402). Grep of all workflows shows no job runs `@api`. cd.yml runs `--grep-invert @engine` which WOULD include `@api`, but cd.yml is the post-merge deploy pipeline, not a PR gate.

**Impact:** The money-path endpoints — /api/billing/checkout, /api/billing/portal, /api/billing/status, /api/stripe/webhook signature rejection, and the /api/generate/* token guards — have their only E2E coverage in a tag that no PR check executes. A regression that, e.g., stops returning 401 on unauthenticated checkout or stops rejecting unsigned Stripe webhooks would not be caught before merge.

**Recommended fix:** Add `@api` to the PR E2E grep (these are fast request-context tests needing no WASM): e.g. `--grep '@ui|@api' --grep-invert '@dev'`, or add a dedicated `test-e2e-api` job. These tests are cheap and high-value.

#### F42 — Main-app CSP allows 'unsafe-inline' and 'unsafe-eval' in script-src

**Severity:** 🟡 low  ·  **Dimension:** infra (security)  ·  **Issue:** #8634  ·  **Epic:** #8592  
**File:** `web/next.config.ts:15-30`

The global CSP script-src is `'self' 'unsafe-eval' 'unsafe-inline' 'wasm-unsafe-eval' ...` (next.config.ts:20). The inline comment (lines 17-19) justifies this as required by Clerk's inline scripts and notes that since unsafe-eval is already needed for WASM, unsafe-inline 'does not meaningfully reduce CSP security'. The stricter /play CSP (line 101) correctly drops both, using only 'wasm-unsafe-eval'.

**Impact:** With both 'unsafe-inline' and 'unsafe-eval' present on the editor/dashboard origin, the CSP provides little protection against reflected/stored XSS — any injected inline script or eval payload executes. The reasoning that WASM already requires unsafe-eval is partially valid, but 'unsafe-inline' specifically is the token that neuters XSS defense and could be replaced with nonces/hashes for Clerk.

**Recommended fix:** Move to a nonce- or hash-based script-src for Clerk's inline scripts (Next.js supports per-request nonces) so 'unsafe-inline' can be removed from the global policy, leaving only 'wasm-unsafe-eval' (which avoids 'unsafe-eval' entirely under modern WASM CSP support). At minimum, scope 'unsafe-inline' away from API/sensitive routes.

#### F43 — Prompt-injection detection and input sanitization in /api/chat skip array-typed message content

**Severity:** 🟡 low  ·  **Dimension:** injection (security)  ·  **Issue:** #8635  ·  **Epic:** #8592  
**File:** `web/src/app/api/chat/route.ts:337-361`

The per-message validation loop guards the injection check and sanitizer behind a string-content check: `for (const msg of messages) { if (typeof msg.content !== 'string') continue; ... if (msg.role === 'user' && detectPromptInjection(msg.content)) {...} if (msg.role === 'user') { msg.content = sanitizeChatInput(msg.content); } }` (lines 337-361). Any user message whose `content` is an ARRAY of parts (the image+text multimodal format the route explicitly supports) hits the `continue` at line 339 and is never passed through `detectPromptInjection` or `sanitizeChatInput`. `buildModelMessages` (lines 246-254) then forwards that array content to the model verbatim: `const content = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content : String(msg.content)`. The text inside those array blocks is even counted toward the billing/budget guard (lines 407-411), confirming it is real model input. No downstream component re-applies the check (spawnforgeAgent.ts only joins/caches blocks; its comment says 'Caller must sanitize text before passing').

**Impact:** The endpoint advertises a prompt-injection guard (returns 400 'Message contains suspicious patterns') and a control-char/length sanitizer for user input, but both are trivially bypassed by wrapping the same text in `content: [{ type: 'text', text: '...ignore previous instructions...' }]`. A user can submit unsanitized, arbitrarily-long-per-block text (the 4000-char per-message cap at line 342 is also string-only) and defeat the documented injection defense. Prompt-injection defenses are inherently best-effort, but here an explicit, intentional control is rendered ineffective for the multimodal path.

**Recommended fix:** Normalize message content before validating: when `msg.content` is an array, iterate its parts and apply `detectPromptInjection` + `sanitizeChatInput` (and the per-part length cap) to every `{type:'text'}` block, mutating the block text in place. Do not `continue` on non-string content; only skip genuinely non-text parts (images, tool_result blocks).

#### F44 — Marketplace purchase row can be committed without charging the buyer if the request crashes mid-purchase, granting free download access

**Severity:** 🟡 low  ·  **Dimension:** payments (security)  ·  **Issue:** #8636  ·  **Epic:** #8592  
**File:** `web/src/app/api/marketplace/assets/[id]/purchase/route.ts:89-184, web/src/app/api/marketplace/assets/[id]/download/route.ts:51-61`

The purchase route inserts the asset_purchases row FIRST (line 89, committed via neon-http, no surrounding transaction) as an idempotency gate, then separately runs the buyer-balance deduction UPDATE (line 161). If the deduction returns 0 rows it deletes the orphan purchase row (line 180). But if the process crashes (timeout, OOM, cold-start kill) between the committed INSERT (line 94) and the balance UPDATE, the asset_purchases row persists with no balance deduction and no credit_transaction. The download route (download/route.ts:51-61) grants access purely on the existence of an asset_purchases row — so the buyer can download the paid asset for free. The retry-recovery logic at purchase/route.ts:96-122 (checking for the marketplace_purchase credit_transaction) only fires on a *subsequent POST to the purchase endpoint*; nothing reconciles the orphan on the download path.

**Impact:** Under a crash at a precise window, a buyer obtains a paid marketplace asset without being charged, and the seller's earnings credit is also skipped. Not trivially attacker-forceable, but a real consistency hole because the purchase-row insert and the balance mutation are not in a single atomic transaction.

**Recommended fix:** Treat a purchase as complete only when the deduction credit_transaction (source='marketplace_purchase', referenceId=assetId) exists, and gate download authorization on that transaction (or a 'completed' flag on asset_purchases) rather than mere row existence. Better: wrap the purchase-row insert, buyer deduction, and seller credit in a single neonSql.transaction([...]) so a crash leaves no orphan row.

#### F45 — Webhook in-flight claim auto-expiry safety net is non-functional — cleanupExpired() has no caller

**Severity:** 🟡 low  ·  **Dimension:** payments (security)  ·  **Issue:** #8637  ·  **Epic:** #8592  
**File:** `web/src/lib/billing/webhookIdempotency.ts:39-58, 113-121`

claimEvent() inserts a claim row with a 5-minute IN_FLIGHT_TTL_MINUTES, documented (lines 21-26, 43-44) so that a crashed event auto-expires and Stripe can redeliver. But claimEvent() uses INSERT ... ON CONFLICT (eventId) DO NOTHING with NO expiry check on the conflicting row — an expired-but-present row still blocks re-claim. The only thing that physically removes expired rows is cleanupExpired() (DELETE WHERE expiresAt < NOW()), and a repo-wide grep shows cleanupExpired() has zero non-test callers (no cron, no maintenance route). Net effect: the 'auto-expire so Stripe can redeliver after a crash' guarantee described in the comments does not actually hold — a crash between claim and finalize permanently blocks redelivery of that event (so a legitimate one-time credit could be silently dropped), while the webhookEvents table grows unbounded.

**Impact:** Two opposing risks: (1) a legitimate billing event whose handler crashes after claiming but before finalizing will never be reprocessed, so the user may lose a token grant / add-on credit; (2) the idempotency table never shrinks. Low severity because crashes mid-claim are rare and the dominant failure mode (released-on-error) is handled, but the documented self-healing behavior is misleading.

**Recommended fix:** Either schedule cleanupExpired() via a Vercel cron, or (better) make claimEvent() treat an expired row as re-claimable: in the ON CONFLICT path, UPDATE the row to a fresh in-flight TTL WHERE expiresAt < NOW() and return whether the update succeeded, so crashed events become reclaimable exactly as the comments promise.

#### F46 — Community game detail route leaks unpublished/processing games (no status filter)

**Severity:** 🟡 low  ·  **Dimension:** privacy (security)  ·  **Issue:** #8638  ·  **Epic:** #8592  
**File:** `web/src/app/api/community/games/[id]/route.ts:40`

GET /api/community/games/[id] selects the game by id alone (`.where(eq(publishedGames.id, id))`, line 40) and returns full details — title, description, cdnUrl, status, and all non-flagged comments (lines 96-127) — without ever checking `status === 'published'`. The publish_status enum is ['published','unpublished','processing'] (web/src/lib/db/schema.ts:231) and defaults to 'processing' (line 242). The sibling list endpoint correctly filters `eq(publishedGames.status, 'published')` (web/src/app/api/community/games/route.ts:27) and the play endpoint returns 404 for non-published games (web/src/app/api/play/[userId]/[slug]/route.ts:52-57), so this detail route is inconsistent. Anyone who knows or guesses a game UUID can read a creator's still-processing or deliberately-unpublished (taken-down) game including its cdnUrl.

**Impact:** Private/in-progress and intentionally-unpublished games (including ones a creator pulled down) are exposed to any unauthenticated caller with the ID, defeating the creator's visibility choice.

**Recommended fix:** Add `and(eq(publishedGames.id, id), eq(publishedGames.status, 'published'))` (or return 404 when status !== 'published') in the detail query, matching the play and list endpoints.

#### F47 — GDPR data export omits the user's own comments, reviews, ratings, follows, listings, and appeals

**Severity:** 🟡 low  ·  **Dimension:** privacy (security)  ·  **Issue:** #8639  ·  **Epic:** #8592  
**File:** `web/src/app/api/user/export-data/route.ts:159-172`

The export aggregates only profile, projects, tokenUsage, tokenPurchases, creditTransactions, costLog, publishedGames, generationJobs, feedback, providerKeys (metadata), and apiKeys (metadata) (route lines 36-172). Tables that hold the user's own personal data but are NOT exported include: game_comments (free-text the user authored, schema.ts:280), game_ratings (264), game_likes (297), user_follows (310), game_forks (339), marketplace_assets (seller listings, 377), asset_purchases (418), asset_reviews (free-text reviews, 436), seller_profiles (bio/portfolio, 451), and moderation_appeals (free-text appeal reasons, 582). Notably deleteUserAccount deletes all of these (user-service.ts:159-227), confirming they are recognized as the user's data — but they are absent from the access/export response.

**Impact:** A GDPR Article 15 data-access request fulfilled by this endpoint returns an incomplete copy of the user's personal data, omitting user-authored text (comments, reviews, appeals) and marketplace/social activity the user owns.

**Recommended fix:** Add the missing user-owned tables (game_comments, game_ratings, game_likes, user_follows, game_forks, asset_reviews, asset_purchases, marketplace_assets seller rows, seller_profiles, moderation_appeals) to the export aggregation, mirroring the table list already enumerated in deleteUserAccount.

#### F48 — Marketplace asset detail route leaks draft/pending/rejected/removed assets (no status filter)

**Severity:** 🟡 low  ·  **Dimension:** privacy (security)  ·  **Issue:** #8640  ·  **Epic:** #8592  
**File:** `web/src/app/api/marketplace/assets/[id]/route.ts:43`

GET /api/marketplace/assets/[id] fetches by id only (`.where(eq(marketplaceAssets.id, id))`, line 43) and returns name, description, previewUrl, metadata, tags, and seller profile (name/bio/portfolio) regardless of status (response built lines 79-105). Asset statuses include 'draft','pending_review','published','rejected','removed' (web/src/lib/db/schema.ts:638). The list endpoint correctly restricts to `eq(marketplaceAssets.status, 'published')` (web/src/app/api/marketplace/assets/route.ts:23), but the detail route does not. So a draft, pending-review, rejected, or moderator-removed asset's full metadata and seller PII leak to anyone with the asset UUID.

**Impact:** Unreviewed and moderator-removed marketplace content (potentially the exact content a moderator just took down for policy/DMCA reasons) plus seller profile data remains publicly readable by ID, undermining the moderation workflow and seller privacy.

**Recommended fix:** Filter the detail query on `status = 'published'` (or 404 for non-published) so it matches the list endpoint; if owner preview of non-published assets is needed, gate that behind an authenticated owner check.

#### F49 — Encryption master key validated only by length, not hex validity

**Severity:** 🟡 low  ·  **Dimension:** secrets (security)  ·  **Issue:** #8641  ·  **Epic:** #8592  
**File:** `web/src/lib/keys/encryption.ts:11-20`

getMasterKey() accepts ENCRYPTION_MASTER_KEY if `key.length === 64`, then does `Buffer.from(key, 'hex')`. Buffer.from with the 'hex' encoding silently stops at the first invalid hex character, so a 64-char string containing non-hex characters yields a short or zero-length buffer (verified: a 64-char all-'g' or all-'z' string produces a 0-byte Buffer). createCipheriv('aes-256-gcm', <short key>, iv) then throws 'Invalid key length' at first use. This fails loudly at encrypt time rather than producing a silently weak key, so the crypto is not weakened — but the env validator advertises this as the strong-key check and it does not actually verify the key is 32 bytes of entropy.

**Impact:** A misconfigured master key (right length, wrong charset) passes the length gate and the startup presence check, then crashes the very first BYOK encrypt/decrypt at runtime instead of being caught at boot. No weak-key compromise, but a deploy-time misconfiguration surfaces as user-facing 500s rather than a clear startup failure.

**Recommended fix:** Validate the key with a hex regex (`/^[0-9a-fA-F]{64}$/`) in getMasterKey() and assert `Buffer.from(...).length === 32`. Optionally add the same regex check to validateEnvironment so a bad key aborts startup (it is already a REQUIRED_VAR) instead of failing on first request.

#### F50 — Structured server logger performs no secret redaction on context fields

**Severity:** 🟡 low  ·  **Dimension:** secrets (security)  ·  **Issue:** #8642  ·  **Epic:** #8592  
**File:** `web/src/lib/logging/logger.ts:95-108`

The application logger serializes whatever object callers pass as `context` directly into the log line (`...boundContext, ...context` then `JSON.stringify(entry)` in production, `JSON.stringify(rest)` in dev). There is no denylist or redaction of keys like `apiKey`, `key`, `token`, `password`, `authorization`. This is a latent hazard rather than a confirmed active leak (no current caller was found passing a raw key), but it provides no defense-in-depth: a future caller logging `{ ...resolved }` or an error object whose message embeds a key would emit it verbatim to stdout/log aggregation.

**Impact:** If any code path ever logs a decrypted key, a token, or an error object containing one, it is written in clear text to log aggregation with no safety net. Hardening gap, not an active breach.

**Recommended fix:** Add a small redaction pass in buildEntry/writeEntry that masks values for known-sensitive keys (apiKey, key, token, secret, password, authorization, encryptedKey) and truncates/strips values matching secret patterns (Bearer ..., sk-..., forge_...). Centralizing this also protects the Sentry path.

#### F51 — token service deductTokens pool-spillover and retry tests don't exercise the deduction logic they name

**Severity:** 🟡 low  ·  **Dimension:** test-quality (testing)  ·  **Issue:** #8643  ·  **Epic:** #8592  
**File:** `web/src/lib/tokens/__tests__/service.test.ts`

deductTokens' tests for 'deducts from monthly', 'deducts from addon when monthly depleted', and 'uses mixed source when partial monthly remain' (service.test.ts:222-316) all push the SAME canned UPDATE-RETURNING result `[{ id: 'user-1' }]` and a hand-set post-balance, then assert only `result.success` and `result.usageId`. Which pool is actually debited, and the monthly-vs-addon split arithmetic, live in the mocked SQL and are never validated — the three differently-named tests are effectively identical. The 'retries on race condition' test (lines 326-355) pushes empty results and asserts INSUFFICIENT_TOKENS, but never verifies the retry re-reads fresh balance state (the point of the retry). INSUFFICIENT_TOKENS in line 201 is decided by the mock returning [], not by a real balance comparison.

**Impact:** Regressions in pool-selection (e.g. debiting addon before monthly, mis-splitting a mixed deduction, or a broken retry loop) would not be caught, risking incorrect token accounting and mis-billing.

**Recommended fix:** Add real-DB tests that seed concrete monthly/addon balances and assert the actual columns after deduction, including the mixed-source split and that a contended retry observes updated state. Keep mock tests only for input-guard branches (zero/negative cost, user-not-found).

#### F52 — CD deploy path runs vitest WITHOUT coverage, so coverage is never enforced on the deploy gate

**Severity:** ⚪ info  ·  **Dimension:** ci (testing)  ·  **Issue:** #8644  ·  **Epic:** #8592  
**File:** `.github/workflows/cd.yml:164-187`

The cd.yml test-web job (which is a hard dependency of deploy-staging and deploy-production) runs `timeout 600 npx vitest run` with NO `--coverage` flag (line 171), unlike the PR test-web in quality-gates.yml which passes `--coverage`. CD also carries the same exit-code-swallow heuristic (lines 180-187). So on the push-to-main deploy pipeline, coverage thresholds are not evaluated at all, and even test-failure detection relies on the fragile `Test Files.*failed` grep. CI on the PR is the only place coverage is (attempted to be) enforced.

**Impact:** If a commit lands on main outside the normal PR flow (direct push, admin merge bypassing branch protection — a scenario cd.yml's own comment at line 96-97 acknowledges: 'merges that bypass branch protection are still validated before deploy'), coverage is not validated before deploy. The deploy-gate's claim to re-validate is incomplete for coverage.

**Recommended fix:** Either add `--coverage` to the cd.yml test-web step so the deploy gate enforces the same thresholds, or document that coverage is intentionally a PR-only gate. Given the workflow explicitly states its purpose is to validate bypass merges, adding `--coverage` (with the fixed exit-code handling from finding 1) is the consistent choice.

#### F53 — Coverage threshold config and the ratchet/CI comments disagree (75/65/70/77 vs 70/60/65/72)

**Severity:** ⚪ info  ·  **Dimension:** ci (testing)  ·  **Issue:** #8645  ·  **Epic:** #8592  
**File:** `web/vitest.config.ts:34-39`

web/vitest.config.ts sets thresholds statements:75, branches:65, functions:70, lines:77. But quality-gates.yml:162 comments them as '(70/60/65/72)', and project docs (CLAUDE.md gotchas) repeatedly cite '70/60/65/72' as the enforced thresholds. The auto-ratchet (coverage-ratchet.yml + ratchet-coverage.sh) bumps these on main, so the comments have drifted from the live values. Compounded by finding 1, the actual enforced number is currently effectively zero, but the documented number (70/60/65/72) is also stale relative to the file (75/65/70/77).

**Impact:** Maintainers reading the CI comments or CLAUDE.md believe the gate is 70/60/65/72 when the config says 75/65/70/77; combined with the swallow bug, none of these is truly enforced. Misleading documentation makes the coverage regression in finding 1 harder to notice.

**Recommended fix:** Update the comment at quality-gates.yml:162 and the CLAUDE.md gotcha to reflect the auto-ratcheted values, or add a comment noting the thresholds are auto-ratcheted and the file is the source of truth. Fix finding 1 first so the documented thresholds are actually enforced.

#### F54 — Documented `npm run check:manifest-sync` script does not exist

**Severity:** ⚪ info  ·  **Dimension:** contracts (testing)  ·  **Issue:** #8646  ·  **Epic:** #8592  
**File:** `web/src/lib/chat/tools.ts:5`

tools.ts:5 instructs maintainers: 'Run `npm run check:manifest-sync` to verify both copies are identical.' Neither package.json (root) nor web/package.json defines a manifest-sync script (scripts present: typecheck, check:command-parity, check:bundle-size). The actual check is `npx tsx apps/docs/scripts/check-manifest-sync.ts`. A maintainer following the in-code instruction gets 'missing script' and may assume no check exists.

**Impact:** Minor: misleading developer guidance; the real CI check still runs, but local verification per the documented command fails, undermining trust that the sync is enforced.

**Recommended fix:** Add a `check:manifest-sync` npm script that runs the tsx check, or correct the comment in tools.ts to point at the real command.

#### F55 — game/pipeline route happy-path (reserve/release/record token mutations) only validation-tested; money logic relies on lib/budget tests

**Severity:** ⚪ info  ·  **Dimension:** cov-critical (testing)  ·  **Issue:** #8647  ·  **Epic:** #8592  
**File:** `web/src/app/api/game/pipeline/route.ts:42-60`

POST /api/game/pipeline performs token-budget reserve (deducts), release (refunds reserved-actual), and record_step against a client-supplied reservationId and actualUsed. Its only route test (web/src/app/api/game/pipeline/negative-cases.test.ts, 18 cases) is almost entirely Zod-validation negatives (400s) plus one 402 insufficient-tokens case via a mocked reserveTokenBudget; the actual reserve/release wiring to lib/tokens/budget and the response shapes for successful release/record are not asserted at the route level (the lib functions themselves are well-covered in budget.test.ts, including ownership and over-claim). Note the route is the standard sibling-test outlier (no route.test.ts; coverage lives in negative-cases.test.ts), so this is a thin-route-test gap rather than a missing module.

**Impact:** If the route mis-wires the budget calls or mishandles the release/record success responses, the route test would not catch it; the financial correctness is only guaranteed transitively by the lib test.

**Recommended fix:** Add route-level happy-path tests asserting: reserve success returns reservationId+remaining; release returns refunded amount; record_step succeeds — with the budget lib mocked to verify the route passes mid.userId! (not a client-supplied userId) into each call.

#### F56 — Public /api/health leaks deployment metadata (git branch, environment, version, per-service latency/status)

**Severity:** ⚪ info  ·  **Dimension:** infra (security)  ·  **Issue:** #8648  ·  **Epic:** #8592  
**File:** `web/src/app/api/health/route.ts:87-129, web/src/lib/monitoring/healthChecks.ts:591-597`

The unauthenticated /api/health endpoint (public per proxy.ts:128) returns environment, full git branch name (VERCEL_GIT_COMMIT_REF), commit SHA prefix, database state, and a per-service list with name/status/latencyMs. sanitizeForPublic() correctly strips details{} and error strings (healthChecks.ts:591-597), so secrets and circuit-breaker internals are not exposed — but branch name and environment still leak.

**Impact:** Branch names and environment labels can reveal internal naming, in-flight feature work, or which preview/staging build is live, aiding reconnaissance. Low severity because no secrets or detailed error messages are exposed (sanitizeForPublic handles those) and the data is mostly operational.

**Recommended fix:** Drop branch (and consider environment) from the public payload, or gate the verbose fields behind admin auth while keeping a minimal {status, overall} body for anonymous monitors. Commit SHA prefix is generally acceptable; the full branch ref is the main over-share.

#### F57 — infra/engine-cdn Cloudflare worker (R2 CORS / bucket exposure) not present in repo — unverifiable

**Severity:** ⚪ info  ·  **Dimension:** infra (security)  ·  **Issue:** #8649  ·  **Epic:** #8592  
**File:** `web/next.config.ts:148-151 (references infra/engine-cdn/worker.js)`

CLAUDE.md, MEMORY.md, and next.config.ts:148-151 all reference infra/engine-cdn/worker.js + wrangler.toml as the production source for engine WASM (setting COEP/COOP and CORS at engine.spawnforge.ai). A filesystem search (find for engine-cdn, worker.js, wrangler.toml, plus ls of infra/) confirms the infra/ directory and these files do NOT exist in this checkout — they appear gitignored or maintained out-of-tree.

**Impact:** The CDN worker's CORS correctness and whether the spawnforge-engine bucket is appropriately public (and the spawnforge-assets bucket strictly signed-URL-only) could not be reviewed from source. This is a coverage gap, not a confirmed defect — the application-side R2 code (web/src/lib/storage/r2.ts) is server-only and uses signed URLs correctly.

**Recommended fix:** Either commit infra/engine-cdn/ (worker.js + wrangler.toml) so its CORS allowlist and public-bucket scoping are version-controlled and reviewable, or document where it lives. Confirm the worker restricts Access-Control-Allow-Origin to spawnforge.ai/staging rather than '*', and that only the engine bucket (immutable public WASM) is web-reachable while spawnforge-assets stays signed-URL-only.

#### F58 — createGenerationHandler content-safety filter only scans a single promptField; secondary free-text fields bypass sanitizePrompt

**Severity:** ⚪ info  ·  **Dimension:** injection (security)  ·  **Issue:** #8650  ·  **Epic:** #8592  
**File:** `web/src/lib/api/createGenerationHandler.ts:185-199`

The shared generation handler runs `sanitizePrompt` on exactly one field: `const promptValue = (params as Record<string,unknown>)[promptField]` where `promptField` defaults to 'prompt' (lines 132, 187-197). Routes that carry additional free-text the user controls do not get those fields sanitized or injection-checked. Example: web/src/app/api/generate/model/route.ts validate() (lines 44-82) accepts `negativePrompt` and `artStyle` as arbitrary strings (no length/charset validation beyond typeof) and passes them straight to MeshyClient.createTextTo3D (lines 94-99); only `prompt` is run through sanitizePrompt by the factory. Several routes also set skipContentSafety:true (voice, localize, pacing) so their text content (e.g. promptField:'text' on voice) is checked, but localize/pacing skip entirely.

**Impact:** Low: these secondary fields are forwarded to third-party generation providers (Meshy), not re-injected into SpawnForge's own LLM/system-prompt context, so the blast radius is provider-side content rather than instruction hijacking of the platform agent. Still, unvalidated user text reaches an external paid API without the platform's content-safety blocklist/injection screen, and the field-length caps that protect `prompt` (3-500 chars) are absent for negativePrompt/artStyle.

**Recommended fix:** Allow promptField to be an array of field names (or add a `secondaryPromptFields` option) so all user-supplied free-text on a route is run through sanitizePrompt/length caps. At minimum, bound and sanitize negativePrompt/artStyle in the model route validate().

#### F59 — Distributed rate-limiter atomicity claims are asserted by trusting the mocked Upstash response

**Severity:** ⚪ info  ·  **Dimension:** test-quality (testing)  ·  **Issue:** #8651  ·  **Epic:** #8592  
**File:** `web/src/lib/rateLimit/__tests__/distributed.test.ts`

distributedRateLimit's allow/deny decision is produced by the Lua script running in Upstash. The test mocks globalThis.fetch and uses makeEvalResponse(allowed, count) (lines 16-23) to hand back the decision, then asserts result.allowed. So tests like 'never adds a phantom entry on deny (no ZADD in deny path)' (lines 204-213) and 'allowed=false when count exceeds limit' assert behavior that is supplied by the mock, not computed by the script — they verify the Lua source contains ZADD/ZCARD/ZREMRANGEBYSCORE substrings (lines 142-153) but never that the script's logic is correct. A Lua bug (wrong comparison operator, ZADD on the deny path, off-by-one window) would pass.

**Impact:** Lower severity since the in-memory fallback path is genuinely tested and Lua-in-Redis is hard to unit test, but the production rate-limit decision logic (the abuse/cost-control gate on generation routes) has no behavioral coverage. A broken limit comparison could allow unlimited paid-generation calls.

**Recommended fix:** Add a thin integration test against a local Redis (or a Lua interpreter) that runs the actual EVAL script and asserts allow/deny across the limit boundary and that no member is added on deny. Keep the fetch-mock tests for the fallback and error paths only.

---

## Phased remediation plan

### P0 — Immediate (stop active credential leak, money loss, and make the gate real)

- Add a server-side beforeSend in sentry.server.config.ts (and the edge config) that strips event.request cookies/headers/IP and scrubs stack-frame locals named apiKey/key/encryptedKey/token/secret/Authorization/email/prompt/content; set sendDefaultPii: false; disable includeLocalVariables in production (or at least on routes that touch decrypted keys). Mirror the client-side maskAllText posture server-side. [Secret/PII exposure]
- Make creditAddonTokens idempotent at the DB level: add a UNIQUE constraint on token_purchases.stripe_payment_intent and convert the INSERT to ON CONFLICT (stripe_payment_intent) DO NOTHING, gating the addon_tokens UPDATE on whether a row was actually inserted (reuse the refundTokens/reverseAddonTokens CTE pattern). Move the non-critical customer-ID save out of the failure path. [Payment idempotency]
- Resolve/validate the platform key BEFORE deductTokens in resolver.ts (move getPlatformKey above deduction or throw an ApiKeyError pre-deduction); add refund-on-failure for any throw after a successful deduction; replace the bare `throw err` in createGenerationHandler with captureException + a structured 500. [Payment idempotency]
- Fix the CI merge gate: add a final aggregating `ci-success` job (needs: [quality-gates, command-parity, build-nextjs, test-e2e-*], if: always(), fails unless all deps success/skipped) and make THAT the single required check in the branch ruleset; verify via gh api repos/{owner}/{repo}/rulesets. [CI gate enforcement]
- Stop swallowing coverage failures: run coverage in a separate `vitest run --coverage --reporter=json` invocation with an explicit threshold check (or grep captured output for 'does not meet * threshold' and propagate non-zero), reserving the exit-124 special-case strictly for the literal timeout code. [CI gate enforcement]

### P1 — Near-term (close the remaining money/auth/dependency holes and prove them with real tests)

- Convert the billing test theater to DB-backed tests via the claimable-postgres skill: run the real refund/credit CTEs against a seeded Postgres, fire duplicate/concurrent webhooks, and assert addon_tokens is mutated exactly once and per-package amounts are exact; demote SQL-substring/mock assertions to at most a structural smoke test. Cover reverseAddonTokens, handleChargeRefunded, creditAddonTokens, deductTokens pool-spillover, and subscriptionLifecycle (rename or convert the misnamed .db.test.ts). [Test theater]
- Wrap the marketplace purchase-row insert + buyer deduction + seller credit in a single neonSql.transaction, and gate download authorization on the completed deduction transaction (not mere row existence). [Payment idempotency]
- Either schedule cleanupExpired() via a Vercel cron or make claimEvent() re-claim expired rows in the ON CONFLICT path so crashed billing events become reprocessable. [Payment idempotency]
- Add missing-status-filter fix to all detail endpoints: eq(status,'published') (404 otherwise) on community/games/[id] and marketplace/assets/[id], matching the list/play endpoints. [Broken access control]
- Verify content ownership in the moderation appeal POST (join gameComments.userId / publishedGames.userId / marketplaceAssets.sellerId) and re-confirm appeal/content linkage in the review route before mutating flags. [Broken access control]
- Trigger Clerk client.users.deleteUser(clerkId) + session revocation in the account-deletion route so erasure is real and re-sync cannot resurrect the row; add the missing user-owned tables to the GDPR export to mirror deleteUserAccount. [GDPR]
- Add root package.json overrides to clear the live HIGH advisories — fast-uri >=3.1.2, fast-xml-builder >=1.2.0, hono >=4.12.18 (ideally ^4.12.23) — reinstall to record in the lockfile, and verify with npm ls + npm audit. [Vulnerable dependencies]
- Lower the npm-audit gate to --audit-level=high in both quality-gates.yml and cd.yml (web + mcp-server), run the security job on pull_request, and add an npm Dependabot entry for the root '/' lockfile directory. [Vulnerable dependencies / CI gate]
- Unblock the Vercel cron health-monitor in proxy.ts (short-circuit on x-vercel-cron header before the Clerk gate, or add /api/cron(.*) to publicRoutes — the route already enforces CRON_SECRET) and add an integration test that drives the cron path through the proxy. [Cron monitoring]

### P2 — Hardening (sandbox boundary, real E2E enforcement, contract gates, and remaining lower-risk items)

- Stop relying on CSP-blocks-eval as the editor sandbox boundary: serve the script worker from a sandboxed iframe/origin with its own restrictive CSP (no unsafe-eval, connect-src 'none') or move to a restricted AST/bytecode interpreter; correct the misleading 'mitigated' comments in scriptSandbox.test.ts and sandboxGlobals.ts. [Sandbox escape]
- Migrate the global app CSP to nonce/hash-based script-src for Clerk so 'unsafe-inline' can be removed and 'unsafe-eval' dropped in favor of 'wasm-unsafe-eval'; at minimum scope the relaxed directives away from API/sensitive routes. [CSP]
- Make editor E2E specs production-server compatible behind a guarded store-exposure flag, remove the blanket @dev exclusion, set E2E_STRICT_STORES=true in the running jobs, and remove the if(count>0) short-circuits; add @api to the PR E2E grep so billing/auth/published-game/marketplace/leaderboard journeys run as PR-blocking checks; stand up at least a nightly GPU/SwiftShader job for a curated @engine smoke subset. [E2E coverage]
- Add a pull_request trigger to codeql.yml (make it a required check) and replace the file-level paths-ignore of scriptWorker.ts with a targeted query-level suppression so the rest of the sandbox file is analyzed. [Static analysis / CI]
- Add coverage to the cd.yml deploy-gate test step (with the fixed exit-code handling) so bypass merges are validated, and reconcile the threshold config/comment drift (75/65/70/77 vs 70/60/65/72) with CLAUDE.md, fixing enforcement first. [CI gate]
- SHA-pin all third-party GitHub Actions (chromaui/action, dtolnay/rust-toolchain@stable, Swatinem/rust-cache, changesets/action) with version comments, mirroring the codeql/.lock.yml pattern. [Supply chain]
- Close contract-drift gaps: drizzle-kit generate the 3 missing migrations (leaderboards, leaderboard_entries, moderation_appeals) + add a drift CI gate and standardize prod on migrate; rewrite schema.test.ts and manifest.test.ts to derive counts/category sets from the real modules; add a vitest that validates real route 200 bodies against ajv schemas and one that asserts every exposed tool maps to handlerRegistry; widen the manifest-sync grep to include web/src/data/commands.json; regenerate the OpenAPI spec from route metadata (or add an enumerate-and-assert gate); add the documented check:manifest-sync npm script. [Contract drift]
- Normalize message content before validation in /api/chat — iterate array parts and apply detectPromptInjection + sanitizeChatInput + per-part length cap to every {type:'text'} block; allow createGenerationHandler.promptField to cover all free-text fields (negativePrompt/artStyle) with sanitize + length caps. [LLM safety]
- Add a redaction pass to logger.ts buildEntry/writeEntry that masks known-sensitive keys and secret patterns (Bearer/sk-/forge_), centralizing protection shared with the Sentry path. [Secret exposure]
- Validate the encryption master key with /^[0-9a-fA-F]{64}$/ in getMasterKey() and validateEnvironment so a misconfigured key fails at boot, not on first request. [Crypto robustness]
- Trim the public /api/health payload (drop branch, gate verbose per-service fields behind admin auth, keep minimal {status, overall} for anonymous monitors), and commit infra/engine-cdn/ (worker.js + wrangler.toml) so the R2 CORS allowlist and public-bucket scoping are version-controlled and reviewable. [Info disclosure / infra]

---

## Appendix A — Refuted findings (24)

Surfaced by a finder but killed by the adversarial verifier. Listed for transparency — these are **not** action items.

| Dimension | Original severity | Finding | Why refuted |
|-----------|-------------------|---------|-------------|
| authz | low | Admin authorization depends entirely on a single ADMIN_USER_IDS env allowlist with no role/defense-in-depth | I read the cited code and the surrounding authorization surface. The facts in the finding are correct: assertAdmin() (web/src/lib/auth/api-auth.ts:245-251) derives admins solely from process.env.ADMIN_USER_IDS, the same string is re-parsed  |
| injection | low | update_material and set_custom_shader chat handlers spread arbitrary LLM-supplied args into engine commands without an allowlist | The code is described correctly: web/src/lib/chat/handlers/materialHandlers.ts:17-54 (update_material) and :73-79 (set_custom_shader) spread arbitrary LLM args with no JS-side allowlist or Number.isFinite guard, while update_light at :120-1 |
| injection | low | Marketplace asset upload trusts client-declared MIME type with no content (magic-byte) verification | The finding's technical claims check out: upload/route.ts:59-75 validates only the client-declared MIME (previewFile.type/assetFile.type) against ALLOWED_*_TYPES plus size, with no byte/signature inspection, and that string is persisted as  |
| apihard | medium | In-memory rate-limit fallback is per-instance — weakens abuse and token-exhaustion protection on Upstash outage/misconfig | The code reads exactly as cited: distributed.ts:119-123 falls back to in-memory when Upstash is unconfigured, distributed.ts:127-134 fails open to in-memory on ANY Upstash call error, rateLimit.ts:115 (rateLimitStore Map) is process-local,  |
| apihard | low | CSRF defense for state-changing routes relies on Origin-header check that permits requests with no Origin | The finding's literal code claims are accurate: proxy.ts:29-37 sets isAllowedOrigin true when `!origin`, so Origin-less /api/ requests pass the CORS gate; there is no CSRF token (confirmed — the only repo hit for csrf/SameSite/Sec-Fetch in  |
| apihard | low | Aggregate generation rate limit is consumed before body validation, allowing self-DoS via malformed requests | The mechanical claims are all accurate, but the security/abuse conclusion does not hold up — this is best treated as a non-issue (info), not a real finding.  Verified facts: - createGenerationHandler.ts:152-161 runs the aggregate limiter th |
| payments | low | Partial-refund idempotency keyed on operation namespace permanently caps refundable amount per usage record | Read service.ts:265-360 (refundTokenAmount, the CTE guard at 330-336), budget.ts:101-147 (releaseUnusedBudget), both call sites (pipeline/route.ts and voice/batch/route.ts:115-135), the analogous refundTokens (service.ts:188-248), and the g |
| deps | high | package.json overrides are not recorded in package-lock.json; override drift already observed (ws@7.5.11) | Verified directly. package-lock.json root node `packages['']` has keys only [name, workspaces, devDependencies, engines] — no `overrides` key (confirmed via json load), so the structural observation that overrides are not recorded in the lo |
| deps | medium | Artifact action version mismatch: upload-artifact@v4 paired with download-artifact@v8 within the same workflow run | The finding's core technical claim — that upload-artifact@v4 and download-artifact@v8 "use different storage backends/manifests" and that a v8 download "can fail to locate or extract" a v4-produced artifact in the same run — is false, and i |
| infra | medium | Missing Strict-Transport-Security (HSTS) header on the main app | REFUTED. The auditor's code-level observation is accurate but their security conclusion is wrong because it rests on a false platform assumption. The finding explicitly claims "Vercel terminates TLS but does not add HSTS unless the app sets |
| infra | medium | Clerk-gated docs site fails open: any clerkMiddleware error or missing secret allows all access | The finding accurately quotes the fail-open mechanics at apps/docs/proxy.ts:24-37 (passthrough on missing CLERK_SECRET_KEY; try/catch that passes through on any clerkHandler throw). But its impact rationale is wrong on every load-bearing po |
| infra | low | IP-based rate limiting trusts client-controllable headers in the non-Vercel fallback path | The code behavior described is accurate: web/src/lib/rateLimit.ts:234-237 checks x-vercel-forwarded-for first, then falls back to x-forwarded-for leftmost (lines 242-243) and x-real-ip (lines 252-254), both client-controllable in the abstra |
| sandbox | high | Script-reachable physics commands accept NaN/Infinity (no is_finite guard) and feed them to Rapier | I traced the full path and disproved the finding's mechanism. Confirmed true premises: (1) handle_apply_force (physics.rs:191), handle_apply_force2d (690), handle_apply_impulse2d (718) have no is_finite guard, unlike transform.rs:149-160; ( |
| sandbox | medium | update_material accepts non-finite base_color/emissive from scripts without validation | The static code observation is correct: handle_update_material (engine/src/core/commands/material.rs:111,115) assigns base_color/emissive with no is_finite() check, unlike handle_apply_custom_shader (material.rs:613). update_material is in  |
| sandbox | low | Loop guards cover only for/while/do — recursion and array-iterator stalls rely solely on time/watchdog backstops | I read all cited code. The technical claims verify: loopGuards.ts:40 instruments only for/while/do; SCRIPT_FRAME_TIME_LIMIT_MS=100 (scriptWorker.ts:915) is checked post-hoc at line 1228 AFTER the synchronous onUpdate at line 1217 returns; W |
| sandbox | low | Per-script frame-time and command limits are global constants overridable via an unauthenticated 'set_limits' worker message | The finding's factual description is accurate: scriptWorker.ts:1318-1327 handles a 'set_limits' message that overrides all six runtime limits, the comment marks it test/tooling-only (lines 912, 1319), and grep confirms the only senders are  |
| sandbox | info | forge.asset.loadImage/loadModel forward script-supplied URLs to a server endpoint (SSRF surface; endpoint appears absent) | The cited data flow is accurate but the alleged vulnerability does not exist in current code. Verified: forge.asset.loadImage/loadModel (scriptWorker.ts:624-628) pass a script-supplied url into asyncRequest('asset',...), and assetChannel.ts |
| sandbox | info | Bridge isolation verified clean — core/ has no web_sys/js_sys/wasm_bindgen coupling | I independently verified every sub-claim by reading the cited files. The finding's central literal assertion is TRUE: grepping engine/src/core/ for `web_sys\|js_sys\|wasm_bindgen\|#[wasm_bindgen]\|JsValue\|JsCast\|gloo\|console_error_panic` |
| privacy | low | Marketplace download serves moderator-removed/rejected assets to prior purchasers and owners | The code-level observation is literally correct: download/route.ts:40-61 authorizes solely on purchase (lines 51-55) or ownership (line 57) and never reads asset.status, and it is inconsistent with purchase/route.ts:35 which does gate on st |
| cov-critical | medium | createGenerationHandler cached branch (3 prod routes) — duplicate refund-on-failure and cache-HIT-no-charge guarantee untested at handler level | Verified by reading all cited files plus the route tests the auditor missed.  FACTS THAT HOLD: The cached branch IS a separate billing pipeline (createGenerationHandler.ts:219-263) with its own resolveApiKey/refund/ApiKeyError->402, and the |
| test-quality | high | creditManager deduction/TOCTOU tests assert mock plumbing, not the atomic balance logic | I refuted the finding's central claim by mutation testing. The headline assertion — "the whole suite passes if deductCredits is rewritten with a non-atomic SELECT-then-UPDATE" — is FALSE. I temporarily rewrote deductCredits in /Users/trista |
| test-quality | high | createGenerationHandler never asserts the tokenCost charged to the billing call, and the cache-path branch is untested | The two literal observations about createGenerationHandler.test.ts are accurate (grep confirms zero `mockResolve).toHaveBeenCalled*` assertions in that file, and no test there supplies cacheKeyParams). But the finding's impact claims are re |
| e2e | medium | Playwright browser cache key references nonexistent web/package-lock.json -> constant key, never invalidates | All raw facts check out: web/package-lock.json does not exist (only root /package-lock.json; confirmed via ls + find), and on the current branch fix/dependabot-uncovered-alerts-security, .github/workflows/ci.yml:334 reads `key: playwright-$ |
| ci | low | Lighthouse effects-delta gate silently passes (exit 0) when its measurement data is missing | I read .github/workflows/quality-gates.yml lines 445-648. The job is `lighthouse-delta` / "Lighthouse Effects Delta Gate" (lines 450-451), a PR-only performance gate whose stated purpose (comment at lines 602-605) is catching CSS-effects pe |

---

## Appendix B — Methodology

- **Fan-out:** 14 dimension-specific finder agents, each given the relevant subsystem map and SpawnForge conventions (rate-limiting, `safeAuth`, `queryWithResilience`, CTE locking, BYOK crypto, bridge isolation, sandbox globals).
- **Adversarial verification:** every finding passed to an independent skeptic agent instructed to refute it; default-to-refuted on uncertainty. The verifier adjusted severity and killed 24/83 findings (e.g. downgraded a 'community detail leaks playable build' claim after proving the cdnUrl is a relative `/play/...` path gated separately; killed several 'missing await' claims that were actually awaited).
- **Pipelined:** each dimension entered verification the moment its finder completed — no barrier stall.
- **Resilience:** the run crashed once at synthesis (structured-output failure discarded the return); fixed with a try/catch wrap and resumed from cache — all finder/verifier agents replayed instantly, only synthesis re-ran.
- **Limitation:** static + read-only. No dynamic exploitation, no live pentest, no runtime DB inspection. `infra/engine-cdn/` worker (F57) is referenced in MEMORY.md but absent from the repo, so its R2 CORS posture is unverifiable from source.

