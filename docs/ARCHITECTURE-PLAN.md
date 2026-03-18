# SpawnForge — Technical Architecture Plan

> Generated: 2026-03-16 | 3 review passes across 58 tickets
> All tickets decorated with: component location, data flow, security, scalability, dependencies

---

## Shared Infrastructure (Build First)

### PF-586: AI Foundation Layer
Every AI vision feature depends on this shared backbone:

```
web/src/lib/ai/
├── client.ts           — Wrapped Claude API with budget/cache/validation
├── budgetManager.ts    — Per-feature token allocation, graceful degradation
├── promptCache.ts      — Reuse game context across features (30-50% savings)
├── schemaValidator.ts  — Type-safe validation of all AI structured outputs
├── types.ts            — Shared types: GDDSchema, BehaviorTreeJSON, etc.
├── rigging/            — Auto-rig, procedural animation
├── narrative/          — Story arc, character profiles, quest gen
├── behaviorTree/       — English→BT parser, compiler
├── artStyle/           — Palette engine, coherence validator
└── ...                 — Per-feature modules
```

---

## Implementation Waves (Parallelizable)

### Wave 1: No Dependencies (15 tickets, all parallel)
*Can start immediately. No blockers.*

| Ticket | Type | Effort |
|--------|------|--------|
| **PF-586** AI Infrastructure | Foundation | 3 days |
| PF-543 Physics Profiler | Quality | 3 days |
| PF-544 Gameplay Bot | Quality | 2 weeks |
| PF-551 Live Analytics | Platform | 2 weeks |
| PF-552 Dynamic Difficulty | Runtime | 1 week |
| PF-554 Instant Multiplayer | Feature | 2 weeks |
| PF-555 Game Remix | Platform | 1 week |
| PF-559 Accessibility | Polish | 1 week |
| PF-571 Social Features | Platform | 2 weeks |
| PF-574 Monetization | Publishing | 2 weeks |
| PF-579 Native App Wrapper | Publishing | 2 weeks |
| PF-581 Adaptive Music | Runtime | 2 weeks |
| PF-583 Cross-Game Universe | Platform | 2 weeks |
| PF-584 Game Portals | Platform | 1 week |
| PF-585 InitPromise Fix | Bugfix | 1 hour |

### Wave 2: Depends on Wave 1 (17 tickets)
*Start after PF-586 (AI Infrastructure) completes.*

| Ticket | Depends On | Effort |
|--------|-----------|--------|
| **PF-541** GDD Generator | PF-586 | 1 week |
| PF-545 Behavior Trees | PF-586 | 1 week |
| PF-546 Art Style | PF-586 | 1 week |
| PF-547 Event→Effect System | PF-586 | 1 week |
| PF-550 Auto-Rigging | PF-586 | 2 weeks |
| PF-557 Player UGC | PF-555 | 2 weeks |
| PF-560 Platform Learning | PF-551 | 3 weeks |
| PF-561 Localization | PF-586 | 3 days |
| PF-562 AI Reviewer | PF-544 | 1 week |
| PF-564 Texture Painter | PF-586 | 1 week |
| PF-565 Smart Camera | PF-586 | 1 week |
| PF-570 Cutscene Gen | PF-586 | 1 week |
| PF-572 Emotional Pacing | PF-544 | 1 week |
| PF-573 Idea Generator | PF-586 | 3 days |
| PF-576 Incremental Mod | PF-586 | 1 week |
| PF-577 Design Teacher | PF-586 | 3 days |
| PF-578 Auto-Trailer | PF-544 | 1 week |

### Wave 3: Depends on Wave 2 (8 tickets)
*Start after PF-541 (GDD) and PF-549 (Narrative) complete.*

| Ticket | Depends On | Effort |
|--------|-----------|--------|
| **PF-575** AI Game Studio | PF-586 + PF-541 | 2 weeks |
| PF-548 Level Generator | PF-586 + PF-541 | 2 weeks |
| PF-549 Narrative Arc | PF-586 + PF-541 | 1 week |
| PF-553 Auto-Iteration | PF-541 + PF-551 | 1 week |
| PF-563 Proc Animation | PF-550 | 2 weeks |
| PF-566 Economy Designer | PF-586 + PF-541 | 1 week |
| PF-567 World Builder | PF-586 + PF-541 | 1 week |
| PF-568 Auto-Save | PF-541 | 3 days |

### Wave 4: Depends on Wave 3 (4 tickets)
*Start after narrative + level gen + behavior trees all complete.*

| Ticket | Depends On | Effort |
|--------|-----------|--------|
| PF-558 Tutorial Generator | PF-541 + PF-548 | 3 days |
| PF-569 Quest Generator | PF-586 + PF-549 | 1 week |
| PF-580 Learning NPCs | PF-545 + PF-568 | 2 weeks |
| PF-582 Live Narrative | PF-549 + PF-586 | 2 weeks |

---

## Cross-Cutting Architectural Decisions

### 1. Claude API Cost Management
- **Budget Manager:** Per-feature allocation from user's tier token budget
- **Prompt Cache:** Game context reused across features (5-minute TTL)
- **Graceful Degradation:** Over-budget = cached/default result, not error
- **Cost Visibility:** Show estimated cost before generation

### 2. Database Strategy (Neon-HTTP)
- **No `db.transaction()`** — neon-http doesn't support interactive transactions
- **Atomic SQL:** Use WHERE guards for concurrent safety
- **Optimistic Concurrency:** Version columns for multi-table consistency
- **High-Write Features (analytics):** Offload to Cloudflare Analytics Engine

### 3. Export Bundle Size
- **Total Budget:** 100KB for all injected SDKs
- **Lazy Loading:** Only inject SDKs creator enables
- **Shared Event Bus:** 3KB runtime shared by analytics, social, monetization
- **Compression:** All SDKs gzipped (50-70% reduction)

### 4. Security Model
- **AI Outputs:** Schema-validated before MCP dispatch
- **Agent Scoping:** AI studio agents have permission boundaries
- **Analytics:** No PII, HMAC-signed events, rate-limited
- **UGC:** Sandboxed to game's existing assets only
- **Monetization:** Stripe Connect with server-side verification

---

## Dependency Graph

```
Wave 1 (parallel, no deps):
  PF-586, PF-543, PF-544, PF-551, PF-552, PF-554, PF-555,
  PF-559, PF-571, PF-574, PF-579, PF-581, PF-583, PF-584, PF-585

Wave 2 (after PF-586):
  PF-541, PF-545, PF-546, PF-547, PF-550, PF-557, PF-560,
  PF-561, PF-562, PF-564, PF-565, PF-570, PF-572, PF-573,
  PF-576, PF-577, PF-578

Wave 3 (after PF-541 + PF-549):
  PF-575, PF-548, PF-549, PF-553, PF-563, PF-566, PF-567, PF-568

Wave 4 (after Wave 3):
  PF-558, PF-569, PF-580, PF-582
```

No circular dependencies detected. All 44 vision tickets can be built in 4 waves.
