# Platform generation keys — provisioning and verification runbook (#9117)

SpawnForge serves AI generation on two paths. **BYOK** users supply their own
provider key in Settings for Anthropic, Meshy, Hyper3D or ElevenLabs and are
never charged tokens. OpenAI, Replicate and remove.bg have no Settings key option. **Platform** users
(Pro, or a paid tier with add-on tokens) are served by SpawnForge's own key
for the provider and charged tokens per call. This runbook is about the
second path: which keys exist, how to mint and set each one, and how to prove
a key works before anyone is charged against it.

Production status as of 2026-09-05: **no `PLATFORM_*` key is set**. Chat works
because editor chat routes through the Vercel AI Gateway (`AI_GATEWAY_API_KEY`).
That observation is historical and does not verify current deployment credentials
or generation output. Existing direct-provider generation needs its own keys. The owner has
deliberately deferred provisioning until the rest of the launch checklist is
green (#9117 comment, 2026-09-03), so this document is the ready-to-run
procedure for that day, not a request to act now.

## What the code does without a key

Every generate route runs through `createGenerationHandler`, which resolves
the key **before** deducting tokens (`web/src/lib/keys/resolver.ts`,
`getPlatformKey`). A missing key throws server-side, the user gets a generic
500, and nothing is charged. Every status poller that resolves a key
(`/api/generate/*/status`, except `music/status`, which never calls the
resolver and returns a static terminal `failed` response) and the QStash
`generation-complete` callback call the resolver directly as a zero-cost
`STATUS_CHECK_OPERATION`. That call skips the tier and balance checks (the job
was paid for at creation, and the route's `panelTierGateResponseForPoll` is its
tier control: it admits a `starter` at `hobbyist` only when the account has
held tokens, `monthlyTokens > 0 || addonTokens > 0`, and it does not check that
the `jobId` belongs to the caller), but a missing platform key still throws
there too. For a capability that can never be provisioned,
three more layers keep it from reaching that point:

| Layer | Where | Effect |
|---|---|---|
| Declared unavailable | `UNAVAILABLE_CAPABILITIES` in `web/src/lib/config/providers.ts` | The capability is refused everywhere regardless of keys. Today: none — the map is empty. `music` was the last entry until #9522 moved it to ElevenLabs; the machinery stays wired for the next unprovisionable capability. |
| `/api/capabilities` | `web/src/app/api/capabilities/route.ts` | Reports `available:false` per capability; `unprovisionable:true`, a user-facing `hint` and the tracking `issue` for declared ones. A signed-in user's BYOK key counts. Always `Cache-Control: private`. |
| Entry points | `useGenerationGate` + `GenerationUnavailableNotice`; the Asset panel menu and Audio inspector button; a declared capability's chat tool and its `forge.ai` wrapper (until #9522 this was `music`'s `generate_music` / `forge.ai.generateMusic`) | Each shows the reason and refuses to submit. The dialog gate blocks on a successful per-user `available:false` response; loading and failed fetches stay enabled. Auth changes and successful BYOK saves/removals immediately refresh mounted consumers, bypassing the browser cache and discarding older in-flight responses. |
| Route gate | `capability:` option on `createGenerationHandler` (step 1b, right after the panel tier gate) | 503 `SERVICE_UNAVAILABLE` right after authentication — before rate limits, validation, key resolution or any deduction. |

The health probe (`/api/health` → AI Providers) grades the same table this
document decides from: since #9719 it and `/api/capabilities` both read
`isCapabilityConfigured` in `web/src/lib/config/providers.ts`, so the two
cannot disagree about what "configured" means. It grades the PLATFORM path
only — a user's own key never makes it green, and its public `summary` says
so.

Deliberately unprovisioned capabilities can be listed explicitly in the server-only
`HEALTH_EXPECTED_UNCONFIGURED_CAPABILITIES` deployment setting (comma-separated
capability IDs). With no setting, missing keys are incident signals. Invalid IDs
also disable suppression. Only when every missing capability appears in this
list does the degraded entry carry `configurationOnly: true`, keeping that
expected state out of overall health and synthetic-monitor paging.

For the currently deferred asset providers, an operator may declare
`model3d,texture,sfx,voice,music,sprite,bg_removal`. Music shares the ElevenLabs
key after #9522 and must be included while that key is intentionally absent.
This repository does not set the
deployment value automatically. When provisioning a capability, remove its ID
from the declaration in the same deployment. For example, provisioning Meshy
requires removing both `model3d` and `texture`. A later missing Meshy key then
changes overall health and pages instead of being silently treated as intentional.
An actual `down` verdict is never suppressed.

## Decision per capability

Decided from `DIRECT_CAPABILITY_PROVIDER`, `PLATFORM_KEY_ENV`,
`GATEWAY_CAPABILITIES` and `CAPABILITY_PROVIDER_OPTIONS` in
`web/src/lib/config/providers.ts` — the same tables
`web/scripts/verify-platform-generation.ts` reads, so its `provider` and
`route` columns match the "Provider" and "Route" columns here (the env var is
named in its `detail` column on a `missing` row). The "Decision" and "Where
to mint" columns are this runbook's; keep them in step when the tables change.

| Capability | Provider | Route | Env var | Decision | Where to mint |
|---|---|---|---|---|---|
| `chat`, `embedding`, `image` | Vercel AI Gateway | gateway | `AI_GATEWAY_API_KEY` | **Gateway credentials** — recorded in production on 2026-09-05; image/embedding consumer transport is not verified | Vercel dashboard → AI Gateway |
| `model3d`, `texture` (also skybox) | Meshy | platform-key | `PLATFORM_MESHY_KEY` | **Platform key** (owner) | https://www.meshy.ai/settings/api — shown once, prefix `msy_` |
| `sfx`, `voice`, `music` | ElevenLabs | platform-key | `PLATFORM_ELEVENLABS_KEY` | **Platform key** (owner) — set a credit quota on the key; the one key covers all three | https://elevenlabs.io/app/settings/api-keys |
| `sprite` (and pixel art) | Replicate or OpenAI, per operation | platform-key | `PLATFORM_REPLICATE_KEY` or `PLATFORM_OPENAI_KEY` | Pixel-art sprites, sprite sheets and tilesets use Replicate. Other single-sprite styles use OpenAI. The aggregate capability requires both; the dialog gates each selected operation independently. Provision both to support every operation. OpenAI and Replicate are not currently supported by user key setup; unavailable operations do not offer a Settings link. | https://replicate.com/account/api-tokens and https://platform.openai.com/api-keys |
| `bg_removal` | remove.bg | platform-key | `PLATFORM_REMOVEBG_KEY` | **Platform key** (owner) | https://www.remove.bg/dashboard#api-key |

The table describes the operator verification script, which grades advertised
`GATEWAY_CAPABILITIES`. The resolver forces only image/embedding credentials
through its narrower `RESOLVER_GATEWAY_CAPABILITIES`. This is credential
preparation: no production image/embedding consumer uses the new resolver path
yet. A future consumer must pair the key with a gateway endpoint/model adapter
and use an OIDC-aware SDK for the empty-key sentinel; image integration remains
tracked in #9818. A configured gate does not establish successful generation.

`ANTHROPIC_API_KEY` serves a direct editor-chat backend and ALWAYS serves
localization/pacing, even when a gateway key is present
(https://console.anthropic.com/settings/keys); `PLATFORM_HYPER3D_KEY`
is BYOK-only and never read on the platform path.

The local operator script grades gateway rows on an explicit `AI_GATEWAY_API_KEY`.
Unlike the Vercel runtime capability gate, its credit-free account probe does not
use OIDC authentication: an OIDC-only deployment can have credential readiness
while this explicit-key probe reports `missing`. If the explicit key were
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

Exit code is 1 when an offered capability has no verified path. Sprite is verified when either provider passes; both provider rows remain visible so a missing or failed alternative is not mistaken for a verified operation. The probes
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

- #9522 — replaced Suno with ElevenLabs Music (landed; `music` now served by `PLATFORM_ELEVENLABS_KEY`)
- #9523 — route more capabilities through `AI_GATEWAY_API_KEY`
- #9719 — health probe must stop reporting green on key presence alone
- `docs/features/ai-asset-generation.md` — user-facing feature reference
