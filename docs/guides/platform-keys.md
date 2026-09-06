# Platform generation keys — provisioning and verification runbook (#9117)

SpawnForge serves AI generation on two paths. **BYOK** users supply their own
provider key in Settings and are never charged tokens. **Platform** users
(Pro, or a paid tier with add-on tokens) are served by SpawnForge's own key
for the provider and charged tokens per call. This runbook is about the
second path: which keys exist, how to mint and set each one, and how to prove
a key works before anyone is charged against it.

Production status as of 2026-09-05: **no `PLATFORM_*` key is set**. Chat works
because it routes through the Vercel AI Gateway (`AI_GATEWAY_API_KEY`). Every
other platform-path generation request fails before charging. The owner has
deliberately deferred provisioning until the rest of the launch checklist is
green (#9117 comment, 2026-09-03), so this document is the ready-to-run
procedure for that day, not a request to act now.

## What the code does without a key

Every generate route runs through `createGenerationHandler`, which resolves
the key **before** deducting tokens (`web/src/lib/keys/resolver.ts`,
`getPlatformKey`). A missing key throws server-side, the user gets a generic
500, and nothing is charged. For a capability that can never be provisioned,
three more layers keep it from reaching that point:

| Layer | Where | Effect |
|---|---|---|
| Declared unavailable | `UNAVAILABLE_CAPABILITIES` in `web/src/lib/config/providers.ts` | The capability is refused everywhere regardless of keys. Today: `music` (#9522). |
| `/api/capabilities` | `web/src/app/api/capabilities/route.ts` | Reports `available:false` per capability; `unprovisionable:true`, a user-facing `hint` and the tracking `issue` for declared ones. A signed-in user's BYOK key counts. Always `Cache-Control: private`. |
| Entry points | `useGenerationGate` + `GenerationUnavailableNotice`; the Asset panel menu and Audio inspector button; the `generate_music` chat tool; `forge.ai.generateMusic` | Each shows the reason and refuses to submit. The dialog gate blocks on a successful per-user `available:false` response; loading and failed fetches stay enabled. Auth changes and successful BYOK saves/removals immediately refresh mounted consumers, bypassing the browser cache and discarding older in-flight responses. |
| Route gate | `capability:` option on `createGenerationHandler` (step 1a) | 503 `SERVICE_UNAVAILABLE` right after authentication — before rate limits, validation, key resolution or any deduction. |

The health probe (`/api/health` → AI Providers) grades the same table this
document decides from: since #9719 it and `/api/capabilities` both read
`isCapabilityConfigured` in `web/src/lib/config/providers.ts`, so the two
cannot disagree about what "configured" means. It grades the PLATFORM path
only — a user's own key never makes it green, and its public `summary` says
so.

## Decision per capability

Decided from `DIRECT_CAPABILITY_PROVIDER`, `PLATFORM_KEY_ENV`,
`GATEWAY_CAPABILITIES` and `CAPABILITY_REQUIRED_PROVIDERS` in
`web/src/lib/config/providers.ts` — the same tables
`web/scripts/verify-platform-generation.ts` reads, so its `provider` and
`route` columns match the "Provider" and "Route" columns here (the env var is
named in its `detail` column on a `missing` row). The "Decision" and "Where
to mint" columns are this runbook's; keep them in step when the tables change.

| Capability | Provider | Route | Env var | Decision | Where to mint |
|---|---|---|---|---|---|
| `chat`, `embedding`, `image` | Vercel AI Gateway | gateway | `AI_GATEWAY_API_KEY` | **Gateway** — already set in production | Vercel dashboard → AI Gateway |
| `model3d`, `texture` (also skybox) | Meshy | platform-key | `PLATFORM_MESHY_KEY` | **Platform key** (owner) | https://www.meshy.ai/settings/api — shown once, prefix `msy_` |
| `sfx`, `voice` | ElevenLabs | platform-key | `PLATFORM_ELEVENLABS_KEY` | **Platform key** (owner) — set a credit quota on the key | https://elevenlabs.io/app/settings/api-keys |
| `music` | (Suno → ElevenLabs) | unavailable | — | **Unavailable** until #9522 lands; then covered by `PLATFORM_ELEVENLABS_KEY` | n/a — Suno has no public API |
| `sprite` (and pixel art) | Replicate **and** OpenAI | platform-key x2 | `PLATFORM_REPLICATE_KEY` + `PLATFORM_OPENAI_KEY` | **Two platform keys** (owner): `/api/generate/sprite` resolves DALL-E 3 on OpenAI for every style except pixel-art (the dialog's and the chat tool's default) and Replicate SDXL for pixel-art. A Replicate-only environment still fails the default path. #9523 may later fold the OpenAI half into the gateway | https://replicate.com/account/api-tokens and https://platform.openai.com/api-keys |
| `bg_removal` | remove.bg | platform-key | `PLATFORM_REMOVEBG_KEY` | **Platform key** (owner) | https://www.remove.bg/dashboard#api-key |

Not in the table: `ANTHROPIC_API_KEY` is only a chat fallback when the gateway
is bypassed (https://console.anthropic.com/settings/keys); `PLATFORM_HYPER3D_KEY`
is BYOK-only and never read on the platform path.

The gateway rows are graded on `AI_GATEWAY_API_KEY` alone: if that key were
ever removed from production the script reports them `missing` and never
substitutes a direct Anthropic/OpenAI key, because the decision above is the
gateway and a silent fallback would hide its absence.

`AI_GATEWAY_API_KEY` is evidence for the gateway-served capabilities only. It
does not make any Meshy, ElevenLabs or remove.bg capability available, and
the verification script never treats it as such.

## Setting a key (owner)

Prerequisite, once per checkout: link `web/` to the project so the CLI
targets the right team and project.

```bash
cd web && vercel link --yes --scope tnolan --project spawnforge
```

Then one variable at a time, pasting the value at the prompt (never as a
shell argument — it lands in history):

```bash
vercel env add PLATFORM_MESHY_KEY production --scope tnolan
```

Production only to start. Add Preview only if preview deployments are meant to
spend real provider credits. Then **redeploy** — env vars are injected at
build/boot and an existing deployment will not pick them up. Never commit a
value; `web/.env.example` carries the names.

## Verifying a key (before any user is charged)

Pull the production variables into a **scratch file**, never into
`web/.env.local` — that file is the local-dev environment `npm run dev` and
`npm run db:push` read, and pointing it at production would run both against
production.

The script reads eight variables and calls six vendors, so give it only those:
`vercel env pull` writes the WHOLE production environment — `DATABASE_URL`,
`CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `ENCRYPTION_KEY`, the MCP relay token
— and handing all of it to a script that needs none of it is how a scratch file
turns into an incident. Filter first, and remove both files from a `trap` so a
failure or a `Ctrl-C` cannot leave them behind. Note `${TMPDIR:-/tmp}`: `TMPDIR`
is unset on most Linux shells, and a bare `$TMPDIR/...` would write to `/`.

```bash
cd web
tmp="${TMPDIR:-/tmp}"
raw="$(mktemp "$tmp/spawnforge-prod-raw.XXXXXX")"
env_file="$(mktemp "$tmp/spawnforge-prod.XXXXXX")"
trap 'rm -f "$raw" "$env_file"' EXIT INT TERM
vercel env pull "$raw" --environment production --scope tnolan
grep -E '^(PLATFORM_[A-Z0-9_]+|AI_GATEWAY_API_KEY)=' "$raw" > "$env_file"
cd .. && node --env-file="$env_file" web/scripts/verify-platform-generation.ts
```

The `trap` removes both files when the shell block exits, however it exits.
Verify with `ls "${TMPDIR:-/tmp}"/spawnforge-prod*` — it must match nothing.

(On Windows PowerShell there is no `trap` equivalent here; use
`try { ... } finally { Remove-Item -Force $env:TEMP\spawnforge-prod*.env }`, or
run the block above in Git Bash, where `${TMPDIR:-/tmp}` resolves the same way.)

The script prints one row per provider key a capability needs (`sprite` therefore prints two), with columns `capability  provider  route  status  detail`:

| status | meaning |
|---|---|
| `pass` | the provider accepted the key on its documented, credit-free account endpoint |
| `fail` | the provider rejected it (status in `detail`), the probe threw, or the script has no probe for a configured provider |
| `missing` | the env var is not set; `detail` names where to mint it |
| `unavailable` | declared in `UNAVAILABLE_CAPABILITIES`; never probed |

Exit code is 1 when any row is `missing` or `fail`; the summary line counts capabilities, and a multi-key capability is verified only when every one of its rows passed. The probes
are `GET` calls to each vendor's account/balance endpoint (URLs and doc links
in `PROVIDER_PROBES`); they cost nothing and prove authentication, not output.

## Acceptance (the #9117 done-when)

A key is only "working" once, on a supported account in production:

1. Signed in, `GET /api/capabilities` reports the capability `available: true`
   (the route is behind Clerk in production; an anonymous curl returns 401).
2. One real generation through the dialog succeeds, the artifact attaches to a
   scene, the scene saves, reloads, and the asset is used in Play.
3. The token charge matches the dialog's quoted cost.
4. A forced provider failure (revoke the key, retry) returns an actionable
   error and the token ledger shows the refund.

Record each as a comment on #9117 with the deployment SHA.

## Related

- #9522 — replace Suno with ElevenLabs Music (unblocks `music`)
- #9523 — route more capabilities through `AI_GATEWAY_API_KEY`
- #9719 — health probe must stop reporting green on key presence alone
- `docs/features/ai-asset-generation.md` — user-facing feature reference
