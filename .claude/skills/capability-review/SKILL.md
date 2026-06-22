---
name: capability-review
description: Forward-looking sister to changelog-review. Scans our SaaS + library stack (analytics, monitoring, observability, agent tracking, infrastructure, AI, payments, auth) against TODAY's provider changelogs / releases / betas to surface capabilities we are NOT yet using — newly shipped or long-available-but-unadopted — that could improve the product or our build harness. Every opportunity comes with its provider cost. Use for quarterly capability audits, when asking "what new features can we leverage," or before planning a growth/observability/infra initiative.
---

# Capability & Opportunity Review

`changelog-review` is **defensive** — it asks "what will break if we upgrade." This skill is **offensive** — it asks **"what capability are we leaving on the table?"**

For every tracked provider you compare three things:

1. **What we have installed** (version) and **how we actually use it** (which features our code touches).
2. **What the provider offers TODAY** — including GA features we never adopted, plus newly shipped releases and public betas.
3. **The delta** = adoption gaps and new-feature opportunities, each scored by impact/effort and annotated with the **provider cost**.

You then present the ranked opportunities and **ask the user which to pursue**. You do NOT adopt anything automatically.

## Non-Negotiable: Anchor Every Search to Today

> Your training data is stale. A capability you "know" a provider lacks may have shipped months ago. **No capability claim in your report may rest on training data alone.**

**Step 0, always, before any other work:**

```bash
date +%F        # capture today, e.g. 2026-06-22
date +%Y        # the year for query strings
```

Then, for **every** provider, run at least one `WebSearch` / `WebFetch` whose query **embeds the current year and (where useful) month**, e.g.:

- `"PostHog new features <YYYY>"`, `"PostHog changelog <Month YYYY>"`
- `"Sentry release notes <YYYY> beta"`
- `"Vercel changelog <Month YYYY>"`
- `"Stripe API <YYYY> new"` / `"Stripe billing meters <YYYY>"`
- `"<provider> roadmap <YYYY>"` and `"<provider> public beta <YYYY>"`

Rules:
- A feature may be listed as an opportunity **only if** you found a dated source (changelog entry, release, docs page, or pricing page) **within ~6 months of today**, OR you confirmed it is GA and we demonstrably don't use it. Otherwise mark it **`unverified`** and exclude it from the recommendation list.
- Prefer the provider's **own** changelog/release/pricing pages over third-party summaries.
- The Vercel session-context block in this repo already corrects several stale assumptions (Fluid Compute, AI Gateway, Queues, Sandbox, BotID, Agent, Node 24 default). Treat it as a seed, then verify the current state by date.

## Tracked Capability Surface

Grouped by the domains the user cares about. This is the **opportunity** lens, not the version lens — the question for each row is "are we using everything here that would move the product?"

### Analytics & Product Intelligence
| Provider | We use (verify with script) | Look for (verify by date) |
|----------|-----------------------------|---------------------------|
| **PostHog** (`posthog-js`) | event capture | Session replay, feature flags, experiments/A-B, surveys, web analytics, **LLM observability** (`$ai_generation`), error tracking, cohorts, data warehouse, group analytics |
| **Vercel Analytics / Speed Insights** | ? | `@vercel/analytics`, `@vercel/speed-insights`, Web Vitals attribution |

### Monitoring, Observability & Agent Tracking
| Provider | We use | Look for |
|----------|--------|----------|
| **Sentry** (`@sentry/nextjs`) | error capture, tracing | Performance/tracing depth, **profiling**, **cron monitors**, **uptime monitoring**, **Seer (AI root-cause / AI code review)**, **logs**, session replay, **AI Agent Monitoring / LLM spans**, release health, user feedback |
| **PostHog LLM analytics** | ? | Per-generation cost/latency/token dashboards, trace view for the AI chat + generate routes |
| **Vercel Observability** | ? | Runtime logs, OpenTelemetry export, Vercel Agent (AI reviews / prod investigations, beta) |

### Infrastructure & Platform
| Provider | We use | Look for |
|----------|--------|----------|
| **Vercel** | Functions, crons, preview deploys | Fluid Compute tuning, **Queues** (beta), **Sandbox**, **AI Gateway**, **BotID**, **Rolling Releases**, ISR, `vercel.ts` config, image optimization, edge config |
| **Cloudflare** | R2 (engine + assets), `engine-cdn` Worker | Workers AI, Vectorize, D1, Hyperdrive, Queues, Images, Cache Reserve, R2 event notifications |
| **Upstash** | Redis (rate limiting) | **QStash** (durable queues/schedules), **Workflow**, **Vector**, **Search**, daily backups |
| **Neon** | Postgres + Drizzle | DB **branching** for preview envs, autoscaling, read replicas, **Data API**, Neon Auth, scheduled backups |

### AI / Generation Stack
| Provider | We use | Look for |
|----------|--------|----------|
| **AI SDK** (`ai`, `@ai-sdk/react`) | streaming chat, tool loop | New model providers, **prompt caching**, structured output, agents, **MCP** tool integration, batch, embeddings, image/video gen via Gateway |
| **Anthropic / model tier** | Sonnet/Opus via gateway | New models, prompt-cache tiers, tool streaming, citations, context windows, batch API pricing |

### Payments, Auth & Compliance
| Provider | We use | Look for |
|----------|--------|----------|
| **Stripe** (`stripe`) | Checkout, subscriptions (4 tiers), webhooks, refunds | **Billing meters / usage-based**, Tax, Radar (fraud), customer portal features, adaptive pricing, entitlements API |
| **Clerk** (`@clerk/nextjs`) | auth, sign-in/up | Organizations/B2B, MFA, passkeys, bot protection, billing integration, new `Appearance` API (note: 7.5.x drops `baseTheme`) |

> When the user is working in a specific domain, you may scope the review to that group rather than all of them.

## Procedure

### Step 1 — Anchor to today (mandatory)
Run `date +%F` / `date +%Y` (Step 0 above). Build your dated query strings now.

### Step 2 — Fingerprint current usage
Run the adoption-fingerprint helper to see, per provider, the installed version and which capabilities our code actually touches:

```bash
bash "/Users/tristannolan/project-forge/.claude/skills/capability-review/scripts/scan-usage.sh"
```

It greps the codebase + manifests for SDK feature markers (e.g. `Sentry.cron`, `posthog.capture('$ai_generation')`, `@vercel/speed-insights`, `stripe.billing.meters`) and prints `using` / `NOT FOUND` per capability. `NOT FOUND` for an installed SDK = candidate adoption gap. Treat its output as a **lead**, then confirm in-context before reporting (a feature can be used under a different name).

### Step 3 — Fetch provider state by date
For each provider in scope, `WebSearch`/`WebFetch` the dated queries. Capture, per candidate capability:
- **Status**: GA / beta / preview / deprecated.
- **Shipped/updated date** (must be datable; else mark `unverified`).
- **Source URL** (provider-owned).

### Step 4 — Price every opportunity (mandatory)
For each surfaced opportunity, `WebFetch` the provider's **pricing** page and record the **incremental** cost to us, not the headline price:
- Is it included in our current plan / free tier? (state the threshold, e.g. "free to 1M events/mo")
- Per-unit overage (per event / per GB / per seat / per generation / per monitor).
- Any plan upgrade required to unlock it.
- If pricing is genuinely undiscoverable, mark **`pricing: TBD — confirm with provider`** (never guess a number).

### Step 4b — Pull the developer/implementation docs (mandatory for anything recommended)
Pricing tells us *whether* to adopt; the **developer docs** tell us *how*. For every opportunity you intend to recommend, also `WebFetch` the provider's **implementation guide / SDK reference / quickstart** for that specific capability (e.g. "Sentry cron monitors Next.js setup," "PostHog LLM observability AI SDK integration," "Upstash QStash schedules"). Capture:
- The exact SDK call / config / wrapper the provider documents (method names, package, the file it belongs in).
- Prerequisites (env vars, a dashboard toggle, a plan tier, a new package install).
- The doc URL + its version/date — so the implementation ticket is grounded in the API as it exists **today**, not in stale recall. Prefer `context7` for library-API specifics when the provider docs are thin.

This is what makes the eventual ticket buildable instead of aspirational.

### Step 5 — Produce the opportunity report

```markdown
## Capability Review — <today's date>

### Top Opportunities (ranked)
| # | Provider | Capability | Status | Why it helps us | Effort | Provider cost |
|---|----------|-----------|--------|-----------------|--------|---------------|
| 1 | Sentry | Cron monitors | GA | Catch silently-dead cron jobs (we run several) | S | Included in Team plan / $X per extra monitor |
| 2 | PostHog | LLM observability | GA | Per-generation token+cost+latency on /api/generate/* | M | Free to 1M $ai events/mo, then $Y |
| … |

### New since last review (shipped within ~6 months of <today>)
- <provider>: <feature> (<status>, <date>, <url>)

### Adoption gaps (available all along, unused)
- <provider>: <feature> — installed SDK supports it; `scan-usage.sh` shows NOT FOUND

### Unverified (excluded from recommendations — could not date a source)
- <provider>: <feature> — needs a dated confirmation before we rely on it

### Cost summary
- Free / within current plan: <list>
- Incremental spend: <provider> ~$<amount>/<unit>
- Requires plan upgrade: <list>

### Sources (per opportunity)
- <provider> <capability>: changelog <url> · pricing <url> · **dev docs** <url>
```

Each recommended opportunity must carry all three source links — the dev-docs link is what Step 7 turns into a concrete, buildable ticket.

Effort key: **S** ≤ half a day, **M** ≈ 1–3 days, **L** > 3 days / needs a spec.

### Step 6 — Ask the user which to pursue (mandatory — do NOT skip to implementation)
Present the ranked list, then use `AskUserQuestion` (multi-select) to let the user choose which opportunities to turn into tracked work. Make the **cost** and **effort** visible in each option. Never adopt, install, enable a paid feature, or change a plan on the user's behalf — surfacing + asking is the whole job. Cost-incurring actions especially require explicit user go-ahead.

### Step 7 — File architecture-grounded implementation tickets (chosen opportunities only)
For each selected opportunity, write a ticket the team could pick up and build **without re-researching** — scoped to our codebase *as it exists at the moment the skill runs*, not a generic "adopt X." Before writing each ticket:

1. **Locate the integration point in our current architecture.** Use `.claude/rules/file-map.md`, the `scan-usage.sh` fingerprint, and a quick `Grep`/`Read` of the relevant code to find exactly where this wires in (e.g. Sentry → `web/sentry.server.config.ts` + `web/instrumentation-client.ts`; an LLM-observability hook → `createGenerationHandler` / the `/api/chat` route; a queue → wherever we currently poll). Name the real files and functions.
2. **Map the developer-doc steps (Step 4b) onto those files.** Translate the provider's documented setup into "add X to file A, wire B in route C," including the env var / dashboard toggle / package install prerequisites.
3. **Flag any conflict with current constraints** — a required SDK bump that hits a pin or a blocked upgrade (e.g. `@clerk/nextjs` 7.5.x `baseTheme`), a feature needing a plan change, or a gate it would trip.

Each ticket then contains: the capability + why; the **dated source URLs** (changelog, pricing, **dev docs**); the **provider cost**; the effort estimate; the **concrete file/route touch-list** from step 1–2; prerequisites; and testable acceptance criteria (including the regression/coverage expectation per our test policy). File it on the taskboard (per `.claude/rules/agent-operations.md` — `projectId` Forge `01KMM9ZA6SBZ7RKJZJTZS9VR4R`, a `teamId`; never `move_ticket` from this skill), then `python3 .claude/hooks/github_project_sync.py push` and open the GitHub issue. Do not create tickets for anything the user did not pick, and do not start implementing — the ticket is the deliverable.

### Step 8 — Mark the review complete
```bash
date +%s > "$(git rev-parse --show-toplevel)/.claude/.capability-last-review"
```
Mirrors `changelog-review`'s `.changelog-last-review` timestamp so a future SessionStart reminder (if wired) can space these out. Suggested cadence: **quarterly**, or before any growth/observability/infra planning.

## Hard Rules

- **Search before you assert.** Every reported capability cites a dated, provider-owned source. No dated source → `unverified` → not recommended. This is the reason the skill exists; do not shortcut it with training-data recall.
- **Cost is a first-class field.** An opportunity without a cost line is incomplete. "Free within current plan" is a valid, valuable answer — but state the threshold.
- **Recommend, never enact.** No installs, no plan changes, no enabling paid features. Surface and ask. The user decides.
- **Tickets must be buildable today.** Every implementation ticket cites the provider's current **developer docs** and names the actual files/routes in our architecture where the feature wires in (Step 4b + Step 7). A ticket that says "adopt X" without the integration touch-list is incomplete. Stop at the ticket — do not implement.
- **Adoption gaps count.** A GA feature we've never wired (not just this month's release) is a legitimate, often higher-ROI opportunity than the newest beta.
- **Respect existing pins & constraints.** Don't propose an "opportunity" that requires breaking a documented pin (e.g. `wasm-bindgen =0.2.108`) or a blocked upgrade (e.g. `@clerk/nextjs` 7.5.x `baseTheme` removal) without flagging it as blocked and pointing at the migration work.
- **No attribution / no AI-tool mentions** in any ticket, issue, or doc this skill produces (per repo policy).
- **Scope to the user's intent.** If they ask only about observability, review that domain — don't dump all ten providers.

## References
- [references/capability-map.md](references/capability-map.md) — the per-provider inventory: what each SDK/platform offers, what SpawnForge currently wires, the canonical changelog + pricing URLs to fetch, and the grep markers the fingerprint script keys on. Keep it current as adoption changes.
- Sister skill: `changelog-review` (the defensive counterpart — version drift, breaking changes, deprecations).
