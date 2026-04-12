# SpawnForge Version Pins and Upgrade Blockers

Documenting why specific dependencies are pinned and what must be audited before upgrading.

---

## JavaScript / Node

### stripe — `22.0.1`, API version `2026-03-25.dahlia`

**Upgraded from** `^20.4.1` in PR #8136. v21 `decimal_string` changes and v22 callback/ES6 class changes were non-issues — all amounts use integer cents, no callbacks, ESM imports.

**Before future upgrades:**
1. Check for new `apiVersion` string — update `web/src/lib/billing/stripe-client.ts` (single source)
2. Test the full payment flow (checkout → subscription → invoice → refund) in staging
3. Verify webhook Dashboard endpoint API version matches the SDK version
4. Remove `invoice.subscription` backward-compat fallback in webhook route once Dashboard is on dahlia

---

### wasm-bindgen (Rust) — Pinned at `=0.2.108`

**Why pinned:** `wasm-bindgen` must match exactly between the Rust crate and the installed CLI tool (`wasm-bindgen-cli`). A mismatch causes the WASM build to fail with cryptic errors about missing exports.

**Before upgrading:**
1. Update `engine/Cargo.toml`: `wasm-bindgen = "=<new-version>"`
2. Update `engine/Cargo.lock` via `cargo update wasm-bindgen`
3. Update CLI: `cargo install wasm-bindgen-cli --version <new-version> --force`
4. Run full WASM build: `powershell -File build_wasm.ps1`
5. Test both WebGPU and WebGL2 variants in browser
6. Update CI workflow if it installs `wasm-bindgen-cli` explicitly

**This is a coordinated change — both Cargo.toml AND the installed CLI must match.**

---

### Next.js — Currently `16.x`

**Why constrained:** Next.js 16 introduced Turbopack as the default for builds. Major version upgrades often require:
- Route handler signature changes
- Middleware (now `proxy.ts`) rename
- `params` and `searchParams` async changes
- E2E test updates for hydration dialog selectors

**Before upgrading:**
1. Read the Next.js upgrade guide for the target version
2. Run `/changelog-review` to check for breaking changes
3. Test E2E with `npx playwright test` — hydration dialogs often change behavior
4. Check `web/src/proxy.ts` — middleware API may have changed
5. Verify `vercel.json` is still valid (no deprecated fields)

---

### Bevy — Currently `0.18`

**Why constrained:** Bevy is in active development and every minor version has breaking API changes. Upgrading requires:
- Updating all import paths (see `.claude/rules/bevy-api.md` for the 0.16→0.18 migration)
- Updating all event types (`MessageWriter`, `MessageReader`, `#[derive(Message)]`)
- Rebuilding WASM with matching bevy_rapier, bevy_hanabi versions
- Testing physics, rendering, particles, and animation

**Before upgrading:**
1. Read the Bevy migration guide for the target version
2. Update all library versions that depend on Bevy (bevy_rapier, bevy_hanabi, transform-gizmo-bevy, bevy_panorbit_camera)
3. Update import paths in all `engine/src/` files
4. Run `bash .claude/tools/validate-rust.sh full`
5. Full WASM build and browser test

---

### actions/upload-artifact + actions/download-artifact — Must Match Major Version

**Why constrained:** These GitHub Actions must always use the same major version. v4 changed artifact storage format — v3 artifacts cannot be downloaded by v4 and vice versa.

**Current version:** v4 (both)

**Rule:** Never upgrade one without upgrading the other in the same PR.

---

## Upgrade Decision Matrix

| Dependency | Current | Upgrade Risk | Recommended Action |
|-----------|---------|-------------|-------------------|
| `stripe` | 22.0.1 | LOW | Centralized in `stripe-client.ts`, check apiVersion string |
| `wasm-bindgen` | =0.2.108 | HIGH (CLI must match) | Only upgrade as a coordinated Rust+CLI change |
| `next` | 16.x | MEDIUM | Check migration guide, test E2E |
| `bevy` | 0.18 | HIGH (API churn) | Only on planned engine upgrade sprint |
| `@clerk/nextjs` | ^7.0.7 | LOW-MEDIUM | Check for auth() API changes |
| `drizzle-orm` | ^0.45.1 | LOW | Check migration query syntax |
| `vitest` | 4.1.1 | LOW | Check for workspace config changes |
| `zod` | ^4.3.6 | LOW | Already on v4 |

---

## How to Check for Breaking Changes Before Upgrading

```bash
# Check what the latest version is
npm view <package> version

# Read the changelog (use WebFetch or context7 MCP)
# GitHub releases page: https://github.com/<owner>/<repo>/releases

# Run /changelog-review skill for automated analysis
```
