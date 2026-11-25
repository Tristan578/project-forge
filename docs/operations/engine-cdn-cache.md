# Engine CDN cache verification

> **Last updated:** 2026-09-16

The engine worker binds only the public spawnforge-engine R2 bucket. SHA-addressed known engine artifacts advertise a one-year immutable lifetime; mutable aliases, root paths and other files use no-store. Workers Cache is enabled in Wrangler ahead of the handler. The compatibility date is pinned to 2026-07-30 without Node compatibility flags.

Run npm ci --prefix infra/engine-cdn --workspaces=false --ignore-scripts, then npm test --prefix infra/engine-cdn. The unit suite proves the handler does not list or mutate R2. The workerd suite reads the actual Wrangler configuration, validates the exact bucket binding and seeds real local R2 objects. It checks WASM bytes/MIME, JavaScript metadata, HEAD, cross-origin isolation, mutable alias replacement and rejected methods. Local tests do not prove a production edge cache hit.

Before deployment, obtain authenticated access to the engine-cdn worker in account 0b949ff499d179e24dde841f71d6134f. Export its currently deployed source and settings, and compare them with this reconstructed source and Wrangler configuration. Stop if the live source or bindings differ unexpectedly; preserve any live behavior before deploying. Never bind the signed-URL asset bucket to this public worker.

After deploying the reviewed revision, request both WebGPU and WebGL2 SHA-addressed artifacts twice from the same location. Record the deployed worker version, asset SHA, cache status and response headers; confirm a warm edge response and application/wasm, permissive public CORS and cross-origin CORP. Request a mutable alias after replacement and confirm fresh bytes. Open an editor using each rendering path and confirm the engine loads. Retain the previous worker version for rollback if engine loading or isolation fails.

The implementation was exercised in local workerd. Live-source comparison, production cache status and real editor GPU loading remain deployment acceptance checks and must be attached to PF-217 before it is closed.
