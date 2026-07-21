# Graph + RAG Retrieval over Entities, Scenes, and Assets

- **Ticket:** PF-965 / #8958
- **Milestone:** E5: AI Generation Quality (candidate) — confirm at approval
- **Status:** DRAFT — Awaiting Approval
- **Author:** Engineering (Architecture)
- **Date:** 2026-07-20
- **Scope:** A relationship graph across game projects (entities / scenes / assets / scripts / generations) combined with embedding retrieval, **graph-first with embeddings as one signal**. Retrieval is entirely JS/DB-side; the engine `core/` is untouched.

## Problem

Pure vector search treats a game project as a bag of text. But a SpawnForge game is a *composition of related systems*: scene hierarchies (`parent_id`), asset references (`AssetRef`), script→entity bindings (`ScriptData` on an entity), and generation lineage (paid prompt → provider asset → placement in a scene). Retrieval that understands those relationships can:

1. **Dedupe paid generations** — tell a user "you already generated something like this" *before* spending tokens, with far better precision than cosine similarity over prompt text alone (a prompt is short and ambiguous; the graph knows whether the resulting asset is still in the scene, what type it was, and whether it succeeded).
2. **Ground AI-chat context** in what is actually connected to the selected entity — the graph neighborhood — instead of stuffing the entire scene JSON into the prompt.
3. **Power user-facing similar-asset search** ranked by structural co-occurrence, not just text similarity.

The direction is deliberately **graph-first**: the graph is the primary index and embeddings rank *within* a graph-filtered candidate set — not a vector index with a few metadata columns bolted on. That distinction drives the storage decision (see below).

## What already exists (the data reality)

The spec is grounded in what the codebase persists **today**, not an idealized model. Key finding: **most of the graph is already derivable from data we store**, and generation lineage — the highest-value edge — is captured almost in full.

| Source of truth (persisted today) | Location | What it gives the graph |
|---|---|---|
| `projects.sceneData` (jsonb) | `web/src/lib/db/schema.ts:172` | The entire `.forge` `SceneFile` per project: entities, assets, hierarchy. Per-user (`userId` FK). |
| `SceneFile` | `engine/src/core/scene_file.rs` | `entities: Vec<EntitySnapshot>`, `assets: HashMap<String, AssetMetadata>`. `formatVersion: 3`. |
| `EntitySnapshot` | `engine/src/core/history.rs:68` | `entity_id`, `entity_type`, `name`, `parent_id` (hierarchy), `asset_ref`, `script_data`, `material_data`, `game_components`, `csg_mesh_data`, … |
| `AssetRef` / `AssetMetadata` / `AssetSource` | `engine/src/core/asset_manager.rs` | Entity→asset reference; asset kind (`GltfModel`/`Texture`/`Audio`); **`AssetSource::Generated { provider, prompt }`** — asset knows its generating prompt. |
| `ScriptData` | `engine/src/core/scripting.rs:11` | `source`, `enabled`, `template` — lives **on** the entity snapshot (1:1 script↔entity). |
| `generationJobs` (table) | `web/src/lib/db/schema.ts:515` | **The generation-lineage anchor:** `userId`, `projectId`, `provider`, `type`, `prompt`, `parameters`, `status`, `resultUrl`, `resultMeta`, `tokenCost`, `tokenUsageId`, **`entityId`**, timestamps. |
| `tokenUsage` (table) | `web/src/lib/db/schema.ts:116` | Per-operation token spend; `metadata` jsonb; joins generations to cost for the eval labeled set. |

Because the full scene serializes into `projects.sceneData` on the existing save path, **graph extraction is a server-side parse of jsonb we already have** — no engine change, no new client capture for the core graph.

## Solution

### The graph model

**Node types** (each row carries `user_id` and `project_id` for tenancy):

| Node | Source of truth | Derivable today? |
|---|---|---|
| `project` | `projects` row | Yes. |
| `scene` | `projects.sceneData.metadata` | Yes. One scene per project today; modeled as a distinct node so multi-scene projects are a data change, not a schema change. |
| `entity` | `sceneData.entities[]` (`EntitySnapshot`) | Yes. |
| `asset` | `sceneData.assets{}` (`AssetMetadata`) + `generationJobs.resultUrl` | Yes. |
| `script` | `EntitySnapshot.script_data` | Yes (1:1 with an entity). |
| `generation` (prompt) | `generationJobs` row | Yes — already a table. |
| `material` | `EntitySnapshot.material_data` | Yes, but **not a first-class node in v1** — materials are inlined on the entity and embedded as part of the entity's text. Promote later only if similar-material search proves valuable. |
| `prefab` | — | **Needs new capture.** Prefab *instances* are spawned but prefab identity is not persisted as a first-class record. Out of scope until prefabs get a stored definition. |

**Edge types** (directed, typed, `user_id`-scoped):

| Edge | Meaning | Source of truth | Derivable today? |
|---|---|---|---|
| `contains` | scene→entity, entity→entity | `sceneData.entities[].parent_id` (null parent ⇒ scene root) | **Yes** — parse jsonb. |
| `references` | entity→asset | `EntitySnapshot.asset_ref.asset_id` | **Yes** — parse jsonb. |
| `script_bound_to` | script→entity | `EntitySnapshot.script_data` present | **Yes** — 1:1, trivial. |
| `spawned_from_prompt` | entity→generation, asset→generation | `generationJobs.entityId` (job→entity) **and** `AssetSource::Generated { provider, prompt }` (asset→prompt text) | **Partial.** `generationJobs.entityId` already links a job to the entity it produced. The asset→prompt link exists only as *prompt text* on `AssetSource::Generated`, with **no stable `asset_id ↔ generationJobs.id` crosswalk**. **New capture (small):** when a generation completes and is imported, write the `generationJobs.id` into the imported asset's metadata (web/DB-side, at the import handler — not engine `core/`). |
| `derived_from` (CSG / combine lineage) | result entity→operand entities | — | **Needs new capture.** `csg_mesh_data` stores the *result* vertex/index data; the operand `entity_id`s are consumed and not recorded. Capture the operand ids at CSG/combine command dispatch (web dispatch layer already knows them) into an edge row. Deferred past v1. |

**Design-framework check — this is a JS/DB feature.** The graph is extracted by parsing `projects.sceneData` (jsonb) in TypeScript. The two "needs new capture" edges (`spawned_from_prompt` asset crosswalk, `derived_from`) are captured in the **web command/import handlers**, not in the engine. Engine `core/` and `bridge/` are **untouched**. The sandwich holds: core Rust stays pure, no new command surface, no WASM rebuild required for any phase.

### Storage decision

**Decision: graph edges as rows in Neon Postgres (traversed with recursive CTEs) + embeddings in the same Neon Postgres via `pgvector`. One database. No Upstash Vector, no dedicated graph store.**

The graph-first requirement is the deciding factor. The core query is *"traverse the graph, then rank the candidates by embedding similarity."* If vectors live in a separate store you cannot push a graph traversal into it — you would traverse in Postgres, pull candidate ids, round-trip to the vector store to rank, then join back in app code. That two-store dance **is** the "vector index with metadata bolted on" pattern the ticket explicitly rejects. Co-locating vectors with the graph makes a hybrid query a single SQL statement: a recursive CTE produces the candidate set, and `ORDER BY embedding <=> $queryVector` ranks it — server-side, one round-trip, transactionally consistent, and tenancy-filtered by the same `WHERE user_id = $u` that every other query already uses.

#### Trade-off table

| | **pgvector on Neon (chosen)** | Upstash Vector (vectors) + Neon (edges) | Both (pgvector + Upstash) |
|---|---|---|---|
| Graph-filtered ranking in one query | **Yes** — CTE + `<=>` in one statement | No — traverse in PG, rank in Upstash, join in app | No |
| Consistency of edge + embedding writes | **Atomic** via one `neonSql.transaction([...])` batch | Two stores, two failure modes, drift on partial write | Worst — three-way |
| Tenancy model | **One** `WHERE user_id` everywhere | Two (PG rows + Upstash namespace/metadata filter) | Two |
| Round-trips per hybrid query | **1** | ≥ 2 | ≥ 2 |
| ANN index | HNSW in-DB (Neon supports `CREATE EXTENSION vector`) | Managed HNSW | Both |
| New infra / accounts | **None** — extension on existing Neon; same AI Gateway credentials | New Upstash Vector store | New store + extension |
| Incremental cost | **~$0** — pgvector is a free extension, no add-on | Free ≤ 10K ops/day, then $0.40/100K | Sum of both |
| Scale ceiling | Fine at our scale (per-user, thousands of nodes/user — not billions) | Higher raw ANN ceiling we do not need | — |
| neon-http compatibility | **Yes** — pgvector is a column type + operators over stateless HTTP; no session state | N/A | N/A |

**Addressing the one-database argument head-on:** the ticket flags "keeps graph + vectors in ONE database" as a strong default. It is not just operational tidiness — for a graph-*first* retrieval design it is a correctness/latency property. Upstash Vector's advantages (serverless, generous free tier, purpose-built ANN) matter when the vector index is the *primary* index queried standalone at very large scale. Here the graph is primary and the vector is a *ranking signal on a graph-filtered set*, at per-user scale. pgvector wins decisively.

**Why recursive CTEs, not a dedicated graph DB (Neo4j etc.):** every retrieval query shape below is a **bounded-depth** neighborhood (k ≤ 3) or a filtered lookup — not unbounded variable-length path search or global graph analytics. Postgres recursive CTEs serve bounded traversal well, and neon-http supports them (they are a single statement, no session/transaction gymnastics). A dedicated graph store would add a second operational store, a second consistency boundary, and — fatally for this design — could not co-locate with the vectors. Justify a graph DB only if a future query needs unbounded pathfinding or cross-project graph analytics; nothing in the ranked patterns does.

**pgvector specifics / constraint:** `gemini-embedding-2-preview` (our `AI_MODELS.gatewayEmbedding`, `GATEWAY_MODEL_EMBEDDING` in `web/src/lib/ai/models.ts`) emits high-dimensional vectors. pgvector's HNSW index supports up to 2000 dims for the `vector` type. **Mitigation:** request a reduced output dimensionality (Matryoshka truncation, e.g. 1536) at embed time, or store as `halfvec` for larger dims. Confirm the live dimensionality and the model's supported reduced sizes at implementation (do not hard-code from memory). Index: `USING hnsw (embedding vector_cosine_ops)`; distance operator `<=>` (cosine).

#### Proposed Drizzle schema (edges + embeddings)

Two tables, both `user_id`-scoped. `db:push` in dev; a real `ALTER TABLE` migration for prod (schema changes need migrations). pgvector requires `CREATE EXTENSION IF NOT EXISTS vector` in a migration.

```
graph_nodes
  id           uuid pk
  user_id      uuid  not null  (FK users.id)
  project_id   uuid  not null  (FK projects.id)
  kind         enum('project','scene','entity','asset','script','generation')
  ref_id       text  not null   -- entity_id / asset_id / generationJobs.id / …
  content_hash text  not null   -- sha256 of normalized embeddable text
  embedding    vector(1536)     -- PROVISIONAL dim: confirm live model output size before migrating (see Embeddings section); null until embedded (see cost controls)
  text         text             -- the embeddable text (for re-embed / debug)
  updated_at   timestamptz
  UNIQUE (user_id, project_id, kind, ref_id)
  INDEX (user_id, project_id, kind)
  HNSW INDEX (embedding vector_cosine_ops)

graph_edges
  id           uuid pk
  user_id      uuid  not null
  project_id   uuid  not null
  type         enum('contains','references','script_bound_to','spawned_from_prompt','derived_from')
  src_node_id  uuid  not null  (FK graph_nodes.id)
  dst_node_id  uuid  not null  (FK graph_nodes.id)
  UNIQUE (user_id, type, src_node_id, dst_node_id)
  INDEX (user_id, src_node_id)
  INDEX (user_id, dst_node_id)
```

Writes go through `getNeonSql()` → `neonSql.transaction([...statements])` (never `db.transaction()`, which throws on neon-http). Delete-children-before-insert on re-ingest of a project (delete this project's nodes/edges, then insert the fresh set) inside one transaction batch.

### Ingestion, backfill, invalidation, cost control

**When written:**
- **On project save/export** (`POST/PATCH /api/projects`): parse the new `sceneData`, diff against stored `graph_nodes` for that project, and re-ingest edges + node text. Because a save already writes `sceneData`, we piggyback in the same request path (or an async QStash callback for large scenes — reuse the PF-906 durable-callback pattern rather than blocking the save).
- **On generation-complete** (the `/api/generate/*/status` → completed path, and the import handler): upsert a `generation` node with the prompt text and, on import, the `spawned_from_prompt` edge to the produced entity/asset (this is where the new asset↔job crosswalk is written).

**Embed-once-per-content-hash (cost control):** each node's embeddable text is normalized (lowercased, whitespace-collapsed, stable field order) and hashed (`sha256`). Before embedding, compare to the stored `content_hash`; embed **only** on miss. A re-save that doesn't change an entity's embeddable text costs zero embedding calls. Prompts are short (dozens of tokens), so even a miss is a fraction of a cent. Batch all misses for a project into one `embedMany` call (auto-chunks, `maxParallelCalls`).

**Backfill for existing projects:** a one-off script iterates `projects` and `generationJobs`, extracts nodes/edges, and embeds by content hash. Idempotent (hash-guarded), resumable, throttled. Order-of-magnitude: embedding one prompt or entity ≈ tens of tokens; the entire historical `generationJobs` backfill is a fraction of a dollar (see cost model). Run it behind a flag, in shadow mode, before any user-facing path.

**Invalidation on edit/delete:** deleting a project cascades its nodes/edges (`ON DELETE CASCADE` on `project_id`). Editing an entity out of a scene removes its node/edges on the next save re-ingest (diff drops the missing `ref_id`). Deleting a generation job removes its `generation` node. No stale vectors survive a save.

### Embeddings via the existing AI Gateway

Use `embedMany` from `ai` (v7, already a dependency: `"ai": "^7.0.11"`), routed through the Vercel AI Gateway (`web/src/lib/providers/backends/vercelGateway.ts`, capability `embedding`) with the model id string `google/gemini-embedding-2-preview` (`GATEWAY_MODEL_EMBEDDING`). The Gateway adds **zero markup** over provider list price and uses the **same credentials we already have** — no new provider account. Verified `embedMany` shape (ai-sdk docs, fetched 2026-07-20):

```ts
import { embedMany } from 'ai';

const { embeddings, usage } = await embedMany({
  model: 'google/gemini-embedding-2-preview', // AI_MODELS.gatewayEmbedding — routes via Gateway
  values: nodesToEmbed.map((n) => n.text),
  maxParallelCalls: 4,
});
// embeddings: number[][] aligned to `values`; usage: token count for the cost log
```

`embedMany` returns `{ embeddings: number[][], values, usage, providerMetadata? }` and auto-splits large batches. Confirm the model's reduced-dimensionality option (Matryoshka) at implementation to fit the pgvector HNSW 2000-dim ceiling; do not assume a dimension from memory.

### Retrieval patterns (ranked by product value)

**(1) Generation dedupe — highest value, direct token-cost savings.** Before a paid generation runs, embed the incoming prompt and ANN-search the user's prior `generation` nodes of the **same `type`** with a **completed** job, threshold `cosine ≥ τ`. If a hit clears τ, return the prior `resultUrl` + `entityId` so the client can offer "reuse this instead of spending tokens?" Graph re-rank: prefer prior generations whose produced asset is **still referenced** in the current project (`references` edge live) — a reusable, in-scene asset beats an orphaned one.

**(2) AI-chat context grounding.** Given the selected entity, walk the graph neighborhood (recursive CTE over `contains`/`references`/`script_bound_to`, depth ≤ 2) to get structurally-related nodes, then union with the top-k embedding-similar entities in the same project, and inject *that* bounded set into the chat context — instead of stuffing the whole scene. Cheaper prompt, better grounding.

**(3) User-facing similar-asset search.** "Find assets like this one" — ANN over the user's `asset` nodes, graph re-ranked by co-occurrence (assets that appear together in scenes via shared `contains` roots).

**(4) MCP command/docs retrieval — stays separate (for now).** The existing BM25/TF-IDF search in `mcp-server/src/docs/search.ts` indexes **static, global, per-build** documentation with **no per-user data, no DB, no graph edges** — it ships in-process in `mcp-server` with zero infrastructure. It has a fundamentally different lifecycle (build-time static vs runtime per-user) and tenancy (global vs `user_id`-scoped) from this system. **Decision: do not converge in v1.** A future convergence path exists — embed docs into the same `graph_nodes` table with `kind='doc'` and `user_id = NULL` (global) for semantic doc search — but it is a separate, later decision, not a dependency of this spec.

### Query shapes (concrete, hybrid graph-then-vector)

**Generation dedupe** (pattern 1) — pure ANN over the user's completed generations of a type, graph-aware re-rank:

```sql
-- $u = current user, $p = current project, $q = query embedding, $tau = threshold
-- still_referenced is CORRELATED to the candidate generation n: it walks the
-- spawned_from_prompt edge (produced entity/asset -> generation, dst = n.id) to THIS
-- generation's produced node, then checks that specific node is still live in the
-- current project — either a produced entity that is itself in $p, or a produced
-- asset referenced by an entity in $p. An uncorrelated EXISTS would be a per-project
-- constant and defeat the re-rank.
SELECT n.ref_id AS job_id,
       n.embedding <=> $q AS distance,
       EXISTS (
         SELECT 1
         FROM graph_edges sp
         JOIN graph_nodes produced ON produced.id = sp.src_node_id
         WHERE sp.user_id = $u AND sp.type = 'spawned_from_prompt'
           AND sp.dst_node_id = n.id
           AND (
             (produced.kind = 'entity' AND produced.project_id = $p)
             OR EXISTS (
               SELECT 1 FROM graph_edges r
               JOIN graph_nodes ent ON ent.id = r.src_node_id
               WHERE r.user_id = $u AND r.type = 'references'
                 AND r.dst_node_id = produced.id
                 AND ent.project_id = $p AND ent.kind = 'entity'
             )
           )
       ) AS still_referenced
FROM graph_nodes n
WHERE n.user_id = $u AND n.kind = 'generation'
  AND n.embedding IS NOT NULL
  AND (n.embedding <=> $q) < (1 - $tau)
ORDER BY still_referenced DESC, distance ASC
LIMIT 5;
-- (Same-type + completed-job filtering from the pattern-1 prose applies via the
-- generation node's stored attributes at implementation; elided in this sketch.)
```

**Chat context grounding** (pattern 2) — recursive CTE neighborhood of the selected entity, then vector-rank the frontier. Traversal is **bidirectional**: edges are directed (`contains` points parent→child, `script_bound_to` points script→entity), so a forward-only walk from a selected entity would never surface its parent scene or the scripts bound to it. The recursion therefore has two branches — one following outgoing edges (`src → dst`) and one following incoming edges (`dst → src`):

```sql
WITH RECURSIVE neighborhood AS (
  SELECT n.id, 0 AS depth
  FROM graph_nodes n
  WHERE n.user_id = $u AND n.project_id = $p AND n.kind = 'entity' AND n.ref_id = $selectedEntityId
  UNION ALL
  SELECT e.dst_node_id, nb.depth + 1
  FROM neighborhood nb
  JOIN graph_edges e ON e.src_node_id = nb.id AND e.user_id = $u
  WHERE nb.depth < 2 AND e.type IN ('contains','references','script_bound_to')
  UNION ALL
  SELECT e.src_node_id, nb.depth + 1
  FROM neighborhood nb
  JOIN graph_edges e ON e.dst_node_id = nb.id AND e.user_id = $u
  WHERE nb.depth < 2 AND e.type IN ('contains','references','script_bound_to')
)
SELECT DISTINCT n.kind, n.ref_id, n.text, n.embedding <=> $selectedEmbedding AS distance
FROM neighborhood nb
JOIN graph_nodes n ON n.id = nb.id
ORDER BY distance ASC
LIMIT 20;
```

The reverse branch makes the walk revisit-prone (A→B then B→A), but the `depth < 2` cap bounds the bounce-back to the two-hop neighborhood and the outer `SELECT DISTINCT` dedupes any node reached by multiple paths, so termination and result-set size are unaffected.

All queries carry `WHERE user_id = $u`. All run over `getNeonSql()` tagged templates (recursive CTEs are a single statement — neon-http compatible).

### Privacy / tenancy

- **Every** `graph_nodes` and `graph_edges` row has `user_id NOT NULL`; **every** query filters `WHERE user_id = $current`. Composite indexes lead with `user_id`.
- Generation dedupe searches **only the requesting user's** prior generations — no cross-user recall, ever.
- The ANN index is global (one HNSW over the table) but is never queried without the `user_id` predicate; pgvector applies the filter and ranks within it. (If we later want hard isolation, partition by `user_id` or add Postgres RLS — noted, not required for v1 since the app is the only DB client and the predicate is unconditional.)
- Marketplace/shared/forked assets are **explicitly out of scope for v1** — retrieval sees only the requesting user's own projects. Cross-user similarity (e.g. "assets like this from the marketplace") is a separate future design with its own consent/tenancy model.

### Evaluation (before wiring into any paid path)

- **Labeled set from existing data:** mine `generationJobs` for known-duplicate pairs — same `user_id` + same `type` + (near-identical `prompt` OR reused `resultUrl`) = positive pairs; random cross-type/cross-intent pairs = negatives. `tokenUsage` joins spend for context.
- **Metrics:** precision@k and recall@k for dedupe. **Primary target: dedupe precision@1 ≥ 0.90** at the tuned threshold τ — a false "you already have this" that blocks a wanted generation is the costly error, so precision is weighted over recall. Report recall at that τ so we know the coverage we trade away.
- **Shadow mode:** run dedupe in the generation path logging what it *would* have suggested, **without** showing the user, for a fixed window. Measure real-world hit rate and would-be false positives on live traffic before flipping it user-visible.
- **Harness:** an offline eval script (vitest/node) that loads the labeled set, embeds, runs the query shapes, and prints precision@k / recall@k. This is a Phase 0 deliverable and the gate for Phase 1.

### Cost model

- **Embedding generation:** `gemini-embedding-2-preview` via Gateway at provider list price (zero markup). A prompt or entity embeddable text is tens of tokens. Confirm the exact per-token rate on the live models table (`https://vercel.com/ai-gateway/models`) at implementation. Order of magnitude: a full backfill of all historical `generationJobs` prompts + current-project entities is a **fraction of a dollar**; steady-state (hash-gated, embed-on-change only) is **fractions of a cent per active user per session**.
- **Storage:** pgvector is a free Postgres extension — **~$0 incremental** on Neon beyond the row/vector bytes (1536 × 4 bytes ≈ 6 KB/vector, or ~3 KB as `halfvec`). No add-on fee, no second store.
- **Query:** ANN over per-user candidate sets is sub-millisecond-to-low-ms at our scale; well within the command-latency and frame budgets since retrieval is off the render path.
- **Token savings (the payoff):** each successful dedupe hit avoids one paid generation — the direct ROI that makes Phase 1 the first slice.

### Rust Changes (engine/)

**None.** The engine `core/` and `bridge/` are untouched. The `.forge` `SceneFile` already serializes into `projects.sceneData` on the existing save path; the graph is extracted server-side. No new command, no WASM rebuild, no change to `handle_command()`. (Sandwich preserved — see the design-framework check above.)

### Web Changes (web/src/)

- `web/src/lib/db/schema.ts` — add `graphNodes`, `graphEdges` tables + `pgvector` extension migration.
- `web/src/lib/retrieval/` (new) — `graphExtract.ts` (parse `sceneData` → nodes/edges), `embed.ts` (`embedMany` wrapper, content-hash gate), `ingest.ts` (`neonSql.transaction` writers), `dedupe.ts` (pattern-1 query), `groundContext.ts` (pattern-2 query).
- `web/src/app/api/projects/route.ts` + `[id]/route.ts` — trigger ingest on save (inline or QStash callback for large scenes).
- Generate route completion/import handlers — upsert `generation` node + `spawned_from_prompt` edge (the new asset↔job crosswalk write).
- `web/src/lib/chat/context.ts` — optionally source grounded context from `groundContext.ts` (Phase 2).
- Backfill + eval scripts under `web/scripts/` (node vitest env).

### MCP Changes

**None in v1.** The existing docs BM25 (`mcp-server/src/docs/`) stays as-is (see pattern 4). Convergence is a deferred, separate decision.

### Test Plan

- **Unit (vitest, node):** `graphExtract` produces correct nodes/edges from fixture `sceneData` (hierarchy via `parent_id`, `references` via `asset_ref`, `script_bound_to`, `spawned_from_prompt`); content-hash gate skips re-embed on unchanged text; tenancy predicate present on every query builder.
- **DB tests (pglite harness, `*.db.test.ts`):** ingest writes nodes/edges in one transaction; delete-children-before-insert on re-ingest; recursive-CTE neighborhood returns expected depth-bounded set; cross-user query returns zero rows for a foreign `user_id`.
- **Eval harness:** precision@k / recall@k on the labeled generation-dedupe set meets the ≥ 0.90 precision@1 gate.
- **Mocks:** `embedMany` mocked via `@/lib/...` alias (never relative paths); deterministic fake vectors for query-shape tests.

## Acceptance Criteria

- **Given** a saved project with a scene hierarchy, referenced assets, and a scripted entity, **When** the project is ingested, **Then** `graph_nodes` and `graph_edges` contain the `contains`, `references`, and `script_bound_to` edges reconstructed from `sceneData`, all rows scoped to the owning `user_id`.
- **Given** a user who previously generated an asset from prompt P, **When** they submit a near-identical prompt of the same type, **Then** dedupe returns the prior `resultUrl` + `entityId` above the tuned threshold, ranked ahead of orphaned prior generations.
- **Given** two users with similar prompts, **When** user A runs dedupe, **Then** user B's generations are never returned (zero cross-user recall).
- **Given** a re-save that does not change an entity's embeddable text, **When** ingest runs, **Then** zero embedding calls are made for that entity (content-hash gate holds).
- **Given** the offline eval harness on the labeled set, **When** run at threshold τ, **Then** dedupe precision@1 ≥ 0.90 with recall reported.
- **Given** the whole feature, **When** built, **Then** the engine `core/`/`bridge/` and `handle_command()` surface are unchanged and no WASM rebuild is required.

## Constraints

- **Sandwich:** engine `core/` pure Rust, untouched; all retrieval is JS/DB-side. No new MCP command surface in v1.
- **Render backends / exported games:** retrieval is server-side and off the render path — orthogonal to WebGPU/WebGL2 and to the `runtime` feature (exported games do not carry the editor DB).
- **neon-http:** never `db.transaction()`; use `getNeonSql()` → `neonSql.transaction([...])`. Recursive CTEs are single statements and neon-http-safe. INSERT-then-UPDATE ordering within a batch.
- **pgvector:** HNSW ≤ 2000 dims for `vector` — reduce embedding dimensionality (Matryoshka, e.g. 1536) or use `halfvec`. `CREATE EXTENSION vector` needs a prod migration (`db:push` is dev-only).
- **Performance budgets:** retrieval off the 16 ms frame path; per-query latency low-ms at per-user scale; command latency budget (< 1 ms) unaffected (retrieval is not a command).
- **Versions:** `ai` ^7.0.11, `@ai-sdk/gateway` ^4, Drizzle + Neon, TypeScript 5. Embeddings via `AI_MODELS.gatewayEmbedding` (`google/gemini-embedding-2-preview`) — confirm live dimensionality/rate at implementation, no training-data recall for API signatures.
- **No AI/tool attribution** anywhere in shipped output.

## Phased rollout (smallest slice first)

- **Phase 0 — Foundation, no user-facing behavior.** Schema + pgvector migration; `graphExtract` + `embed` (hash-gated) + `ingest`; ingest `generation` nodes only; backfill script; **eval harness**. Ship dark. Gate: precision@1 ≥ 0.90 offline.
- **Phase 1 — Generation dedupe (the payoff slice).** Wire dedupe into the generate path in **shadow mode** first (log would-be suggestions), then flip to a non-blocking "reuse this?" response. Direct token savings, **no new UI surface beyond the reuse prompt**.
- **Phase 2 — Graph edges + chat grounding.** Extract `contains`/`references`/`script_bound_to` on save; embed entities; source chat context from the graph neighborhood instead of scene-stuffing.
- **Phase 3 — User-facing similar-asset search.** ANN + co-occurrence re-rank, with UI.
- **Phase 4 (optional/deferred).** CSG/`derived_from` lineage capture; docs BM25 → semantic convergence; cross-project/marketplace similarity with its own tenancy/consent design.

## Follow-up implementation tickets (titles + one-liners — NOT created here)

1. **Graph retrieval: schema + pgvector migration** — Add `graph_nodes`/`graph_edges` Drizzle tables and the `CREATE EXTENSION vector` prod migration.
2. **Graph extraction from `sceneData`** — Parse `.forge` jsonb into nodes/edges (`contains`/`references`/`script_bound_to`) with fixtures.
3. **Embedding pipeline with content-hash gate** — `embedMany` wrapper via Gateway; hash-gated embed-once; batch on save.
4. **Ingest writers (neon-http transactions)** — `neonSql.transaction` upserts with delete-children-before-insert; project-scoped invalidation.
5. **Generation-node ingest + backfill script** — Upsert `generation` nodes from `generationJobs`; idempotent historical backfill.
6. **Dedupe eval harness + labeled set** — Mine known-duplicate generation pairs; precision@k/recall@k report; the Phase-0 gate.
7. **Generation dedupe (shadow → live)** — Wire dedupe into the generate path, shadow-log first, then non-blocking reuse suggestion.
8. **Asset↔job crosswalk capture** — Write `generationJobs.id` into imported-asset metadata to complete the `spawned_from_prompt` asset edge.
9. **Chat context grounding via graph neighborhood** — Recursive-CTE neighborhood + vector rank feeding `chat/context.ts`.
10. **User-facing similar-asset search** — ANN + co-occurrence re-rank with UI (Phase 3).
11. **(Deferred) CSG/combine `derived_from` lineage capture** — Record operand entity ids at command dispatch.
12. **(Deferred) Docs BM25 → semantic convergence evaluation** — Decide whether to fold `mcp-server/src/docs` into the shared vector table.
