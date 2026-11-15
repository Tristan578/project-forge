# ADR: Jev is not adopted as a production decision point

**Status:** Accepted
**Date:** 2026-09-24
**Tickets:** #10140 (this record); #10139 (the advisory-signal spike, out of scope here)
**Deciders:** Engineering
**Review condition:** see "What would change the answer" — this decision is
falsifiable, not permanent.

## Context

TypeSafe AI's `typesafe-ai/jev` is a non-generative decision model served
through the Vercel AI Gateway. We evaluated it as a cost-reduction lever: the
pitch is that classification-shaped decisions currently made by a language
model could be made faster and cheaper by a model that only answers typed
questions. The model is genuinely attractive on paper, and the reason it does
not help here is not obvious, so the evaluation is recorded to spare the next
person from redoing it and reaching a worse answer.

### What Jev is

Verified against primary sources at evaluation time, not inferred:

- `curl https://ai-gateway.vercel.sh/v1/models` lists it among the gateway's
  models as
  `{"id": "typesafe-ai/jev", "owned_by": "typesafe-ai", "type": "evaluation", "context_window": 32000, "max_tokens": 0, "pricing": {"input": "0.000000042", "output": "0"}}`.
- It is called via `experimental_evaluate` from the `ai` package. The call
  takes a `state` plus typed `questions` and returns `choice` (up to 255
  options), `score` (2 to 10 ordered levels) or `boolean` answers with
  probabilities, plus `providerMetadata.typesafe.confidence`.
- `max_tokens: 0`. It **cannot** emit prose: no text, no reasoning trace.
- Vendor-reported and not independently verified here: "up to 194x faster and
  445x cheaper than language models", sub-500 ms.
- Sources: `vercel.com/ai-gateway/models/jev`,
  `vercel.com/kb/guide/typesafe-jev-and-ai-sdk`,
  `vercel.com/i/jev-agent-control`,
  `vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway`.

### Current-state inventory: where this codebase makes decisions

Every decision point in the codebase is one of two things, and Jev improves the
cost of neither.

**1. Already free and synchronous.** These resolve with zero network I/O and no
model:

| Decision | Where | Mechanism |
|---|---|---|
| Deep-generation tier | `web/src/lib/ai/deepTier.ts` (`isDeepTierEnabled`, `getDeepGenerationModel`) | `getBooleanFlag()` over a cached in-memory PostHog flag snapshot |
| Provider kill switches | `web/src/lib/flags/posthogFlags.ts` (`getBooleanFlag`, `isProviderKilled`) | same cached lookup; returns the caller's default with no I/O when the evaluator is dormant |
| Prompt content safety | `web/src/lib/ai/contentSafety.ts` (`checkTextSafety`, `sanitizePrompt`) | pure regex over a blocked-term list and injection patterns |
| Community moderation | `web/src/lib/moderation/contentFilter.ts` (`moderateContent`, `shouldBlock`, `shouldFlag`) | pure regex (`BLOCK_PATTERNS`, `FLAG_PATTERNS`, `SPAM_PATTERNS`); the module has no imports at all |
| Premium gating, backend routing | tier and backend comparisons in the generation handler and model resolver | static comparisons |

**2. Genuinely generative.** These need free text that a `max_tokens: 0` model
structurally cannot produce:

- The system decomposer, `web/src/lib/game-creation/decomposerLlm.ts`
  (`generateDecomposition`), asks `AI_MODEL_PRIMARY` for a typed object via
  `generateText` + `Output.object`.
- The pacing and localize routes under `web/src/app/api/generate/` return
  authored text.

So there is **no existing per-request LLM classification call to replace**.
Introducing Jev anywhere today *adds* a network hop and a new cost line and
removes none. That inverts the premise the evaluation started from.

## Options

### A) Adopt Jev as a routing or gating decision point
- **Pros:** cheap per call; typed answers; confidence metadata
- **Cons:** there is no LLM call for it to displace, so it is net-new cost and
  latency; and a probabilistic model in an enforcement slot is a security
  regression (below)

### B) Do not adopt; record the reasoning (this ADR)
- **Pros:** no new cost line, no new hop, no new failure mode on the
  generation path; the reasoning survives for the next proposal
- **Cons:** none on cost; the possible quality-signal use is deferred, not lost

### C) Advisory-only quality signal, off the request path
- Tracked separately as #10139. It is not a cost argument and must not be
  presented as one. Out of scope for this record.

## Decision

**Option B. Jev is not adopted as a production decision point.** Nothing in
this codebase routes, gates, moderates or bills on a Jev answer.

### The security boundary (the part most likely to be re-proposed)

Jev must not sit in an enforcement slot. Vercel's own guidance says it cannot
replace permission enforcement and cannot execute tools. In this codebase the
relevant slot is `createGenerationHandler` (`web/src/lib/api/createGenerationHandler.ts`),
which is the documented single point of failure for every `/api/generate/*`
route. Its content-safety check (`sanitizePrompt`) runs synchronously
**before** the provider kill-switch check and before `resolveApiKey`, so
nothing has been charged when it rejects. A probabilistic model in that slot
would either:

- let unsafe content through while *looking* like a stronger gate, or
- false-positive and block paid generations.

Either outcome is the advisory-masquerading-as-enforcement failure recorded in
`.claude/rules/lessons-learned.md` #1 (a gate that checks the wrong property
passes while the artifact is broken) and #21 (a control belongs on the one
mandatory runtime path, and a heuristic is early feedback, never the
guarantee). The same applies to the moderation path
(`web/src/lib/moderation/contentFilter.ts`) and to any future "AI router" in
front of billing.

**Standing reason for reviewers:** a PR that places Jev, or any probabilistic
router, in front of a gate in `createGenerationHandler` or the moderation path
should be challenged on this ADR. Advisory is fine off the request path.
Enforcement stays deterministic.

## What would change the answer

The decision holds while its premise holds. The premise is that **no
per-request LLM call doing bounded classification exists in this codebase**.
The condition that falsifies it:

> A per-request call to a language model appears whose output is a bounded
> choice, score or boolean (for example an LLM-backed moderation verdict, an
> intent classifier in front of routing, or a quality-triage step that
> decides which pipeline a request enters).

When that call exists, Jev is a candidate to *replace* it, and the cost
comparison becomes real: measure the existing call's latency and cost, run
Jev on the same inputs off the request path first, and compare. Even then the
enforcement boundary above still applies: replacing an advisory LLM call is
in scope; putting the replacement in front of billing or safety is not.

Re-evaluate also if the gateway model's contract changes in a way that
matters here (non-zero `max_tokens`, or a documented enforcement-grade
guarantee from the vendor), and note it as an addendum to this record.

## Consequences

### Positive
- No new provider dependency, cost line, or latency on the generation path
- The evaluation is inherited by the next proposer instead of redone
- Reviewers have a citable boundary for "router in front of a gate" PRs

### Negative / accepted
- Any quality-signal value Jev might provide is deferred to #10139
- This record must be updated if the falsifying condition above appears

## Deliberately not a rule

This is a decisions-log entry, not a `.claude/rules/` entry, and the
distinction is deliberate. Rules are always-loaded operating constraints;
this is a recorded evaluation with a stated expiry condition. No rules file
changes with this ADR.
