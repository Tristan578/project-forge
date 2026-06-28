# Activating durable generation callbacks (Upstash QStash, PF-906)

Async generation jobs (3D model, texture, skybox, music, sprite, sprite-sheet,
tileset) finish on a provider's schedule, not ours. The in-tab client poller
finalizes a job only while the tab is open — if the user closes the tab before
the provider finishes, a **failed** generation never gets refunded except via a
generic timeout.

This feature makes the finalize-and-refund step **durable**: when a generate
route submits an async job it publishes a delayed [Upstash QStash](https://upstash.com/docs/qstash)
message to `POST /api/webhooks/generation-complete`, which polls the provider
server-side and either completes the `generation_jobs` row or refunds the user —
even with no client connected. The callback re-arms itself (15 s between polls,
`MAX_ATTEMPTS = 60` ≈ 15 min cap) until the job reaches a terminal state.

## Dormant by default

The feature is **fully dormant** until an owner sets the QStash env vars:

- `publishGenerationCallback()` no-ops when `QSTASH_TOKEN` is unset, so the
  generate routes behave exactly as before.
- `POST /api/webhooks/generation-complete` returns **401** when QStash is unset.
- Both `after()` publish sites in `createGenerationHandler.ts` are double-gated
  on `asyncJob && isQstashConfigured()`.

There is **no code change** to activate — it is purely environment config. Until
then the existing client-side poller remains the only completion path.

## Activation steps (owner-only)

1. **Create a QStash project.** In the [Upstash console](https://console.upstash.com)
   open the **QStash** tab. (QStash is separate from the Upstash Redis instance
   we already use for rate limiting — it does not reuse those credentials.)
2. **Copy the three credentials** from the QStash dashboard:
   - `QSTASH_TOKEN` — the publish token.
   - `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` — the two
     signing keys used to verify the `Upstash-Signature` on inbound callbacks.
3. **Set them in Vercel** (Production **and** Preview) for the `spawnforge`
   project — scope `tnolan`:
   ```bash
   vercel env add QSTASH_TOKEN production --scope tnolan
   vercel env add QSTASH_CURRENT_SIGNING_KEY production --scope tnolan
   vercel env add QSTASH_NEXT_SIGNING_KEY production --scope tnolan
   # repeat for `preview`
   ```
4. **Confirm `NEXT_PUBLIC_APP_URL` is your PUBLIC origin** (e.g.
   `https://spawnforge.ai`). QStash delivers the callback from its own infra, so
   the URL must be internet-reachable. If it resolves to a loopback host
   (`localhost` / `127.0.0.1` / `::1` / `*.localhost`) the publish is skipped and
   a Sentry **warning** ("generation-callback URL is unreachable") is emitted
   instead of silently black-holing the message.
5. **Redeploy.** `NEXT_PUBLIC_APP_URL` is build-time; a redeploy is required for
   a changed value to take effect.

## Verifying it is live

- Submit an async generation (e.g. a 3D model), then **close the tab** before it
  finishes. The job should still resolve server-side: a successful job lands as
  `completed`, a failed job is refunded.
- In Sentry, healthy callbacks are silent; look for `route:
  /api/webhooks/generation-complete` breadcrumbs only on the error paths
  (`update_job`, `refund`, `resolve_key`, `poll`).
- A misconfigured public origin surfaces as the "callback URL is unreachable"
  warning from step 4 — fix `NEXT_PUBLIC_APP_URL` and redeploy.

## Rolling back

Remove (or blank) `QSTASH_TOKEN` in Vercel and redeploy. The feature returns to
fully dormant immediately — the webhook 401s, nothing publishes, and the
client-side poller is again the only completion path. No data migration is
involved (the durable path writes the same `generation_jobs` rows the client
path does, guarded against clobbering a terminal status).

## Maintenance note

`web/src/lib/generate/pollProviderStatus.ts` hand-mirrors each
`/api/generate/<type>/status` route's terminal-state mapping. There is **no**
automated cross-test between the poller and the live routes, so if you change a
status-route mapping you must update the matching `poll<Type>` function (and its
test) or the durable callback will disagree with the client poller. See the
maintenance-contract comment at the top of that file.
