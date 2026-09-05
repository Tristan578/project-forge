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
500, and nothing is charged. Two more layers keep an unprovisionable
capability from ever reaching that point:

| Layer | Where | Effect |
|---|---|---|
| Declared unavailable | `UNAVAILABLE_CAPABILITIES` in `web/src/lib/config/providers.ts` | The capability is refused everywhere regardless of keys. Today: `music` (#9522). |
| `/api/capabilities` | `web/src/app/api/capabilities/route.ts` | Reports `available:false` per capability; `unprovisionable:true` and a hint naming the issue for declared ones. A signed-in user's BYOK key counts. |
| Generation dialogs | `useGenerationGate` + `GenerationUnavailableNotice` | The dialog shows an explicit unavailable notice and disables Generate. Blocks only on a positive server report, never on a failed fetch. |
| Route gate | `capability:` option on `createGenerationHandler` (6a) | 503 `SERVICE_UNAVAILABLE` naming the issue, before the key resolves or any token moves. |

The health probe (`/api/health` → AI Providers) is the subject of #9719 and
is not evidence for anything in this document.

## Decision per capability

Decided from `DIRECT_CAPABILITY_PROVIDER` and `PLATFORM_KEY_ENV` in
`web/src/lib/config/providers.ts`; regenerate this table from
`web/scripts/verify-platform-generation.ts` rather than editing it by hand.

| Capability | Provider | Env var | Decision | Where to mint |
|---|---|---|---|---|
| `chat` | Vercel AI Gateway | `AI_GATEWAY_API_KEY` | **Gateway** — already set in production | Vercel dashboard → AI Gateway |
| `model3d`, `texture` (also skybox) | Meshy | `PLATFORM_MESHY_KEY` | **Platform key** (owner) | https://www.meshy.ai/settings/api — shown once, prefix `msy_` |
| `sfx`, `voice` | ElevenLabs | `PLATFORM_ELEVENLABS_KEY` | **Platform key** (owner) — set a credit quota on the key | https://elevenlabs.io/app/settings/api-keys |
| `music` | Suno → ElevenLabs | — | **Unavailable** until #9522 lands; then covered by `PLATFORM_ELEVENLABS_KEY` | n/a — Suno has no public API |
| `sprite`, `pixel_art` | Replicate | `PLATFORM_REPLICATE_KEY` | **Platform key** (owner) until #9523 evaluates the gateway image pool | https://replicate.com/account/api-tokens |
| `image`, `embedding` | OpenAI | `PLATFORM_OPENAI_KEY` | **Platform key** (owner) until #9523 routes them through the gateway | https://platform.openai.com/api-keys |
| `bg_removal` | remove.bg | `PLATFORM_REMOVEBG_KEY` | **Platform key** (owner) | https://www.remove.bg/dashboard#api-key |
| (chat fallback) | Anthropic direct | `ANTHROPIC_API_KEY` | Optional — only if the gateway is bypassed | https://console.anthropic.com/settings/keys |
| — | Hyper3D | `PLATFORM_HYPER3D_KEY` | Not offered on the platform path (BYOK only) | https://developer.hyper3d.ai/ |

`AI_GATEWAY_API_KEY` is evidence for **chat only**. It does not make any asset
capability available, and the verification script never treats it as such.

## Setting a key (owner)

From `web/`, one variable at a time, pasting the value at the prompt (never
as a shell argument — it lands in history):

```bash
vercel env add PLATFORM_MESHY_KEY production --scope tnolan
```

Production only to start. Add Preview only if preview deployments are meant to
spend real provider credits. Then **redeploy** — env vars are injected at
build/boot and an existing deployment will not pick them up. Never commit a
value; `web/.env.example` carries the names.

## Verifying a key (before any user is charged)

```bash
cd web && vercel env pull .env.local --environment production --scope tnolan
cd .. && node --env-file=web/.env.local web/scripts/verify-platform-generation.ts
```

The script prints one row per capability:

| status | meaning |
|---|---|
| `pass` | the provider accepted the key on its documented, credit-free account endpoint |
| `fail` | the provider rejected it (status in `detail`) or the probe threw |
| `missing` | the env var is not set; `detail` names where to mint it |
| `unavailable` | declared in `UNAVAILABLE_CAPABILITIES`; never probed |
| `unprobed` | configured but the provider has no credit-free probe (Hyper3D) |

Exit code is 1 when any offered capability is `missing` or `fail`. The probes
are `GET` calls to each vendor's account/balance endpoint (URLs and doc links
in `PROVIDER_PROBES`); they cost nothing and prove authentication, not output.

Delete `web/.env.local` when done, or keep it out of any shell that echoes env.

## Acceptance (the #9117 done-when)

A key is only "working" once, on a supported account in production:

1. `curl https://www.spawnforge.ai/api/capabilities` reports the capability `available: true`.
2. One real generation through the dialog succeeds, the artifact attaches to a
   scene, the scene saves, reloads, and the asset is used in Play.
3. The token charge matches the dialog's quoted cost.
4. A forced provider failure (revoke the key, retry) returns an actionable
   error and the token ledger shows the refund.

Record each as a comment on #9117 with the deployment SHA.

## Related

- #9522 — replace Suno with ElevenLabs Music (unblocks `music`)
- #9523 — route gateway-capable capabilities through `AI_GATEWAY_API_KEY`
- #9719 — health probe must stop reporting green on key presence alone
- `docs/features/ai-asset-generation.md` — user-facing feature reference
