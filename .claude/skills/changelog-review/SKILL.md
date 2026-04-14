---
name: changelog-review
description: Check changelogs for Bevy, Next.js, Zustand, wasm-bindgen, Rapier, and all SpawnForge deps. Use when training data may be stale, before major upgrades, or when a library API behaves unexpectedly.
---

# Changelog & Release Review

You are reviewing changelogs and release notes for SpawnForge's dependency stack to identify breaking changes, deprecations, new features, and API changes that might conflict with your training data.

## When to Run

- At the start of a session involving upgrades, migrations, or new feature work
- Before recommending API patterns for any tracked dependency
- When the user asks about the latest version of a dependency
- When a build or runtime error could be caused by a version mismatch

## Tracked Systems

### Tier 1 — Primary Services (check release pages)

| System | Changelog Source | Current Version |
|--------|-----------------|-----------------|
| Vercel Platform | https://vercel.com/changelog | N/A (platform) |
| Sentry | https://github.com/getsentry/sentry-javascript/releases | @sentry/nextjs ^10.48.0 |
| PostHog | https://github.com/PostHog/posthog-js/releases | posthog-js ^1.367.0 |
| Anthropic (Claude API) | https://docs.anthropic.com/en/docs/about-claude/models | AI SDK provider |
| Cloudflare | https://developers.cloudflare.com/changelog/ | R2 + Workers |
| Upstash | https://github.com/upstash/redis-js/releases | @upstash/redis ^1.37.0 |
| GitHub (Actions) | https://github.blog/changelog/ | CI/CD platform |
| GitHub (CLI) | https://github.com/cli/cli/releases | gh CLI |
| GitHub (API) | https://github.blog/changelog/ | REST + GraphQL |

### Tier 2 — Frameworks & Core Libraries

| Library | Changelog Source | Current Version |
|---------|-----------------|-----------------|
| Next.js | https://github.com/vercel/next.js/releases | ^16.2.3 |
| Clerk | https://github.com/clerk/javascript/releases | @clerk/nextjs ^7.0.12 |
| Stripe | https://github.com/stripe/stripe-node/releases | stripe ^22.0.1 |
| AI SDK | https://github.com/vercel/ai/releases | ai ^6.0.158 |
| Drizzle ORM | https://github.com/drizzle-team/drizzle-orm/releases | drizzle-orm 0.45.2 |
| Neon Serverless | https://github.com/neondatabase/serverless/releases | @neondatabase/serverless ^1.0.2 |
| Zod | https://github.com/colinhacks/zod/releases | zod ^4.3.6 |
| Zustand | https://github.com/pmndrs/zustand/releases | zustand ^5.0.12 |

### Tier 3 — Build & Testing

| Library | Changelog Source | Current Version |
|---------|-----------------|-----------------|
| TypeScript | https://github.com/microsoft/TypeScript/releases | typescript ^6 |
| Vitest | https://github.com/vitest-dev/vitest/releases | vitest ^4.1.4 |
| Playwright | https://github.com/microsoft/playwright/releases | @playwright/test ^1.59.1 |
| ESLint | https://github.com/eslint/eslint/releases | eslint ^9 |
| Tailwind CSS | https://github.com/tailwindlabs/tailwindcss/releases | tailwindcss ^4 |
| Turborepo | https://github.com/vercel/turborepo/releases | turbo ^2.5.4 |

### Tier 4 — Rust / Engine

| Library | Changelog Source | Current Version |
|---------|-----------------|-----------------|
| Bevy | https://github.com/bevyengine/bevy/releases | 0.18.1 |
| wasm-bindgen | https://github.com/nickel-mine/nickelmine-pkg/releases | =0.2.108 (pinned) |
| bevy_rapier | https://github.com/dimforge/bevy_rapier/releases | 0.33 |

## Procedure

### Step 1: Fetch Recent Releases

For each tier, use `WebFetch` to check the GitHub releases page or changelog URL. Focus on:
- The **latest stable release** — is it newer than what we're using?
- **Breaking changes** in any release between our version and latest
- **Deprecation notices** that affect our usage patterns

Fetch the top releases for Tier 1 and Tier 2 systems. Only check Tier 3/4 when the user is working in those areas.

### Step 2: Compare Against Installed Versions

Read the actual installed versions:

```bash
# JavaScript dependencies
node -e "
const pkg = require('/Users/tristannolan/project-forge/web/package.json');
const deps = {...pkg.dependencies, ...pkg.devDependencies};
const tracked = ['next','@clerk/nextjs','stripe','@sentry/nextjs','posthog-js',
  '@upstash/redis','@neondatabase/serverless','drizzle-orm','ai','@ai-sdk/react',
  'zod','zustand','tailwindcss','@playwright/test','vitest','typescript','eslint'];
tracked.forEach(d => deps[d] && console.log(d + ': ' + deps[d]));
"

# Rust dependencies
grep -E '^(bevy|bevy_rapier|wasm-bindgen)\s' /Users/tristannolan/project-forge/engine/Cargo.toml
```

### Step 3: Generate Report

Output a structured report:

```markdown
## Changelog Review — [date]

### Updates Available
| Library | Current | Latest | Breaking? | Action Needed |
|---------|---------|--------|-----------|---------------|
| next | 16.2.1 | 16.x.x | No | Optional update |

### Breaking Changes to Watch
- [library]: [specific breaking change and how it affects SpawnForge]

### Deprecation Warnings
- [library]: [deprecated API we're using and the replacement]

### Training Data Corrections
- [If any API pattern in your training data is outdated, note it here]
- [Example: "Zod 4.x z.record() requires 2 args, not 1"]

### No Action Needed
- [Libraries that are up to date or have no breaking changes]
```

### Step 4: Create Tickets for Actionable Updates

**MANDATORY.** Every update worth tracking gets a GitHub issue:

- **Recommended updates** (bug fixes, security patches): one ticket per update
- **Breaking change audits** (e.g. Stripe v21): audit-only ticket, DO NOT UPGRADE label
- **Minor patches with no notable changes**: bundle into a single "routine npm update" ticket, or skip if truly trivial
- **Bundling**: group related updates (e.g. multiple Vercel ecosystem packages) into one ticket when they share a test plan

```bash
gh issue create --title "PF-DEP: <description>" --body "<user story + acceptance criteria>" --label "enhancement"
```

### Step 5: Update CLAUDE.md if Needed

If a breaking change is found that could trip up future sessions:
- Add it to the Gotchas section of CLAUDE.md
- Add it to `.claude/rules/library-apis.md` if it's an API pattern change

### Step 6: Mark Review Complete

After completing a review, update the timestamp so the SessionStart hook knows:

```bash
date +%s > "$(git rev-parse --show-toplevel)/.claude/.changelog-last-review"
```

This suppresses the reminder for 3 days.

## GitHub-Specific Checks

GitHub is a primary dependency (CI/CD, issue tracking, PR workflows, CLI). Check these sources:

### GitHub Actions
- **Changelog**: https://github.blog/changelog/ (filter for "Actions")
- **Runner images**: https://github.com/actions/runner-images/releases
- **Key actions**: `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `actions/download-artifact`
- **Watch for**: Runner image deprecations (Ubuntu versions), action major version bumps, YAML syntax changes, permissions model changes

### GitHub CLI (`gh`)
- **Releases**: https://github.com/cli/cli/releases
- **Watch for**: Subcommand changes, output format changes, auth flow changes
- **We use**: `gh pr create`, `gh issue create/close`, `gh run view/list`, `gh api`

### GitHub API
- **Changelog**: https://github.blog/changelog/ (filter for "API")
- **Watch for**: REST API deprecations, GraphQL schema changes, rate limit changes, webhook event format changes
- **We use**: REST API via `gh api`, webhook events for Clerk and Stripe

### GitHub Actions Workflow Syntax
- **Docs**: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions
- **Watch for**: New `permissions` requirements, `runs-on` label changes, concurrency group syntax, reusable workflow changes

## Important Rules

- **Never recommend downgrading** — only flag when we're behind
- **Don't auto-upgrade** — just report findings. The user decides when to upgrade
- **Focus on breaking changes** — minor features are noise; breaking API changes are signal
- **Check against actual usage** — a breaking change in a feature we don't use isn't actionable
- **wasm-bindgen is pinned** — `=0.2.108` must match Cargo.lock. Never recommend upgrading without explicit user approval
- **GitHub Actions versions** — `upload-artifact` and `download-artifact` MUST use the same major version (@v4). Never upgrade one without the other

## Scripts

- `bash "${CLAUDE_SKILL_DIR}/scripts/check-deps.sh"` — Compare installed JS dependency versions vs. npm latest for all key packages. Outputs installed version, latest version, and status (current/minor update/MAJOR UPDATE)

## References

- See [version-pins.md](references/version-pins.md) — Documents all version pins with the upgrade blockers: stripe ^20.4.1, wasm-bindgen =0.2.108, Next.js 16.x, Bevy 0.18, upload/download-artifact v4. Includes an upgrade decision matrix and pre-upgrade audit checklists for each pinned dependency
