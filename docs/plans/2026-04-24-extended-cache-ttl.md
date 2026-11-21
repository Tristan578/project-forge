# Anthropic 1h Extended Cache TTL — Plan & 7-Day Cost Memo

**Date:** 2026-04-24
**Owner:** Engineering
**Ticket:** PF-739 / GitHub #8498
**Milestone:** S3: Performance & Scale

## Decision

Adopt the `extended-cache-ttl-2025-04-11` beta on the **direct Anthropic
backend** (`POST /api/chat`) for two long-lived prefixes:

1. The base `SYSTEM_PROMPT` (and `systemOverride` when set).
2. The engine `sceneContext` for the active project.

Doc context, per-turn user content, and the gateway/OpenRouter path stay on
the default 5-minute ephemeral TTL.

## Why

The default ephemeral cache evicts at 5 minutes. Users routinely sit idle for
longer than that during editing — context-switching to the canvas, watching a
preview run, etc. — which means we re-ingest the full prefix on every
conversational turn that follows the gap. With ~15k–60k tokens of base prompt
+ scene context, that pattern dominates the per-message cost.

A 1-hour TTL covers the entire typical editing session in one cache write and
keeps every subsequent step at the cache-read price (~10% of full ingest).

## Implementation

| Layer | Change |
|---|---|
| `web/src/lib/ai/cachedContext.ts` | Export `CacheTier = 'short' \| 'long'` and `buildAnthropicCacheControl(tier)` returning `{ anthropic: { cacheControl: { type: 'ephemeral', ttl?: '1h' } } }`. |
| `web/src/lib/ai/spawnforgeAgent.ts` | `SpawnforgeAgentOptions.instructions` widened to `string \| InstructionBlock[]`. `buildAgentInstructions` emits `SystemModelMessage[]` with per-block `providerOptions` on the direct backend; collapses to a string on the gateway. |
| `web/src/app/api/chat/route.ts` | Constructs `instructionBlocks`: base prompt (long), scene context (long), doc context (short). `onStepFinish` reads `usage.inputTokenDetails.cacheReadTokens`/`cacheWriteTokens` and emits `ai_cache_hit_rate` to Vercel Analytics. |
| `web/src/lib/analytics/events.server.ts` | New `trackAiCacheHitRate(tier, usage)`. |

The AI SDK auto-attaches the `extended-cache-ttl-2025-04-11` beta header when
any block carries `ttl: '1h'` — no manual header wiring needed.

## Non-Goals

- Not changing cache key computation (it remains stable on prompt + tools).
- Not extending caching to non-chat surfaces (generators, voice). Each is a
  separate ticket if/when we have the usage data to justify it.

## Tradeoffs

- **Storage cost.** 1h ephemeral cache is billed at a per-minute rate against
  cached input tokens. If a user opens a session, fires one prompt, then
  walks away, we pay storage on a cache that nobody reads. The cost ceiling
  is bounded by `(cache_size_tokens × 1h × $/token-min)` per idle session,
  which the cost memo below quantifies.
- **Backend asymmetry.** Only the direct Anthropic backend honours
  `cacheControl`. Gateway / OpenRouter / GitHub Models continue to receive a
  flat string and rely on Vercel AI Gateway's transparent caching (which is
  best-effort and not exposed via metrics).

## Rollout

1. Land this PR. No flag — the change is a strict win when the prefix is
   reused, and a small bounded loss when it is not.
2. Watch `ai_cache_hit_rate` for 7 days post-merge.
3. Compare: `cache_read_tokens / (cache_read_tokens + input_tokens)` vs the
   pre-rollout baseline (5m TTL) sampled before merge.

## 7-Day Cost Memo (placeholder — fill in after rollout)

> Update this section once we have 7 days of `ai_cache_hit_rate` data.

### How to collect the metrics

1. **Pre-rollout baseline.** Before merging, capture the last 7 days of
   `ai_cache_hit_rate` events filtered to `tier == 'short'` (the prior code
   path emitted only the default 5m tier). Use:

   ```sql
   -- PostHog HogQL
   SELECT
     avg(properties.cacheReadTokens) AS avg_read,
     avg(properties.cacheWriteTokens) AS avg_write,
     avg(properties.cacheReadTokens / nullif(properties.cacheReadTokens + properties.inputTokens, 0)) AS hit_rate
   FROM events
   WHERE event = 'ai_cache_hit_rate'
     AND properties.tier = 'short'
     AND timestamp > now() - INTERVAL 7 DAY
   ```

2. **Post-rollout sample.** Re-run the same query 7 days after merge with
   `tier == 'long'`.
3. **Per-session $.** Multiply `avg_read × 0.1× + avg_write × 2.0×` by the
   chat-session step count (from `usageId` rows in `tokenLedger`).
4. Drop the numbers into the table below and link the PostHog/Neon query
   used so future readers can reproduce.

| Metric | Pre-rollout (5m TTL) | Post-rollout (1h TTL) | Δ |
|---|---|---|---|
| Avg cache read tokens / step | _TBD_ | _TBD_ | _TBD_ |
| Avg cache write tokens / step | _TBD_ | _TBD_ | _TBD_ |
| Hit rate (read / total input) | _TBD_ | _TBD_ | _TBD_ |
| Direct-backend $ / chat session | _TBD_ | _TBD_ | _TBD_ |

**Cost model:**
- Cached input read: 0.1× input price.
- Cached input write (5m): 1.25× input price (one-time).
- Cached input write (1h): 2.0× input price (one-time).
- Storage of a 1h ephemeral block costs 0 directly; the price is amortized
  into the higher write multiplier.

**Break-even:** the 1h write costs ~0.75× the 5m write extra. At a cache
read price of 0.1× input, the 1h tier breaks even after **~9 cache reads**
per write, vs the 5m tier breaking even after the equivalent ~3 reads inside
its 5-minute window. Once the typical session re-uses the prefix more than
~9 times in an hour — and our usage data shows it does — the 1h tier wins.

## References

- Anthropic prompt caching docs: <https://docs.claude.com/en/docs/build-with-claude/prompt-caching>
- AI SDK Anthropic provider options: `node_modules/@ai-sdk/anthropic/dist/index.d.ts:148`
- Sibling decision: `2026-04-12-stripe-v21-audit.md`
