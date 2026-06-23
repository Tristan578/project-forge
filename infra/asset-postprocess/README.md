# Asset Post-Processing Worker (Cloudflare Queue consumer)

Validates generated SpawnForge assets (GLB / image maps / audio) after they land
in the `spawnforge-assets` R2 bucket.

```
R2 object-create on spawnforge-assets
  → R2 event notification
  → Cloudflare Queue (spawnforge-asset-postprocess)
  → this Worker (queue consumer)
  → validates the artifact, writes <key>.status.json sidecar back to R2
```

## Why

A generation provider (Meshy / Replicate / Suno) can report success yet upload an
empty or malformed artifact (a 0-byte GLB, a `{}` texture-map set, no audio). The
web status routes already guard this on the read path
(`web/src/app/api/generate/<type>/status/route.ts` →
`provider-success-with-no-artifact must map to failed`). This Worker adds a
second, upload-time check so a bad artifact is flagged the moment it lands,
independent of whether a client is polling.

## Files

| File | Purpose |
|------|---------|
| `worker.mjs` | Queue consumer entrypoint (`queue()` handler) + R2 read/write |
| `validate.mjs` | Pure, dependency-free artifact validation (magic bytes + non-empty floors). Shared by the Worker and the tests |
| `wrangler.toml` | Worker config: R2 binding + Queue consumer binding |
| `*.test.mjs` | Vitest suites (43 cases) for the pure logic + the queue handler |
| `vitest.config.mjs` | Standalone vitest config (node env, no web/jsdom deps) |

## Safety / env guard

Every binding is optional. If `ASSET_BUCKET` is not bound (misconfigured deploy,
or `wrangler dev` without R2) the consumer ACKs every message as an inert no-op
and logs once — it never throws in a way that wedges the queue. The Worker is
completely inert until the user provisions the bucket + queue (see below), so it
cannot break prod or CI before then.

A "failed"-validation message is ACKed (the failure is recorded in the sidecar) —
only an unexpected/transient error (e.g. an R2 fetch hiccup) is `retry()`d, so
Cloudflare redelivers and eventually dead-letters.

## Tests

The Worker lives outside `web/src`, so it is NOT covered by
`web/vitest.config.node.ts`. Run its suites with the standalone config:

```bash
cd infra/asset-postprocess
npx vitest run --config vitest.config.mjs
```

(43 tests: artifact classification, GLB/image/audio/binary validation,
truncated-upload + empty-artifact failure paths, message-key extraction,
sidecar/delete skipping, and the queue handler's ACK/retry/no-op branches.)

## Local `wrangler dev` smoke test

You can exercise the consumer locally with Miniflare's queue + R2 emulation —
no Cloudflare account or network needed:

```bash
cd infra/asset-postprocess

# 1. Start the Worker locally. --local uses Miniflare; R2 + Queue are emulated.
npx wrangler dev --local

# 2. In a second shell, put a (valid) GLB into the emulated R2 bucket, then a
#    deliberately-empty one, so you can see both a "valid" and a "failed" path.
#    (printf builds a 20-byte GLB header: "glTF" + version 2 + length 20.)
printf 'glTF\x02\x00\x00\x00\x14\x00\x00\x00\x00\x00\x00\x00' \
  | npx wrangler r2 object put spawnforge-assets/assets/dev/m1/file/model.glb --local --pipe
printf '' \
  | npx wrangler r2 object put spawnforge-assets/assets/dev/m2/file/empty.glb --local --pipe

# 3. Enqueue R2-event-shaped messages to drive the consumer:
npx wrangler queues consumer ...   # or use the dashboard "Send message" tester
#    body: {"object":{"key":"assets/dev/m1/file/model.glb"},"action":"PutObject"}
#    body: {"object":{"key":"assets/dev/m2/file/empty.glb"},"action":"PutObject"}

# 4. Read back the status sidecars the Worker wrote:
npx wrangler r2 object get spawnforge-assets/assets/dev/m1/file/model.glb.status.json --local --pipe
#   → {"key":"...model.glb","status":"valid","kind":"glb",...}
npx wrangler r2 object get spawnforge-assets/assets/dev/m2/file/empty.glb.status.json --local --pipe
#   → {"key":"...empty.glb","status":"failed","kind":"glb","reason":"GLB too small or empty",...}
```

The pure validation logic is also fully unit-tested above; `wrangler dev` is for
verifying the R2/Queue wiring end to end.

## Provisioning (user-side, one time)

Cloudflare account `0b949ff499d179e24dde841f71d6134f`. Cost: ~$0 within the
existing Workers Paid plan.

```bash
cd infra/asset-postprocess

# 1. Create the queue + a dead-letter queue.
npx wrangler queues create spawnforge-asset-postprocess
npx wrangler queues create spawnforge-asset-postprocess-dlq

# 2. Deploy the consumer Worker (registers the queue-consumer binding).
npx wrangler deploy

# 3. Enable R2 event notifications: route object-create events on the
#    spawnforge-assets bucket to the queue.
npx wrangler r2 bucket notification create spawnforge-assets \
  --event-type object-create \
  --queue spawnforge-asset-postprocess
```

After step 3, every new upload to `spawnforge-assets` is validated automatically.
Until then the Worker is inert (no events delivered) and nothing changes.
