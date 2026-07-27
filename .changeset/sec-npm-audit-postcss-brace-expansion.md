---
"web": patch
---

fix(deps): clear npm-audit gate — postcss floor 8.5.18 and brace-expansion 5.0.8; waive the un-relockable brace-expansion 1.x by id

Two source advisories were blocking the `Quality Gates / Rust Security Audit` npm-audit gate (`scripts/check-npm-audit.sh`) at high severity.

- **postcss**: override floor raised `>=8.5.10` → `>=8.5.18` (root + web manifests, including the `next`-scoped override); the lockfile resolves to 8.5.23. The already-pinned in-range 8.5.16 node does not move on a plain relock, so the bump is applied with `npm update postcss --package-lock-only` — the committed lockfile is a fixed point of the Lockfile Sync gate's regeneration.
- **brace-expansion** (GHSA-mh99-v99m-4gvg, unbounded-expansion OOM DoS): patched ONLY in 5.0.8 — no 1.x/2.x backport exists. The two relockable 5.0.7 copies (under `glob` and `@typescript-eslint/typescript-estree`) move to 5.0.8. The root 1.1.16 copy is dev-only and pinned `^1.1.7` by the minimatch@3/eslint-9 lint toolchain — un-relockable without an eslint-major migration and non-exploitable here (input is our own lint globs) — so it is waived by advisory id in `ALLOWED_ADVISORIES` with justification and removal path (eslint 10 or a 1.x backport).
- The two stale esbuild waivers (GHSA-gv7w-rqvm-qjhr, GHSA-g7r4-m6w7-qqqr) are pruned — the gate's anti-rot notes reported them gone from every workspace. The hermetic test suite (`scripts/__tests__/check-npm-audit.test.sh`) is migrated to the new allowlist occupant and now pins that the esbuild ids stay pruned.

Root lockfile relocked on Node 24; both audit gates (`web` and `mcp-server`) pass exit 0 with exactly one WAIVED line in `web`; `scripts/check-lockfile-sync.sh` passes against the committed lockfile; `npm ci` integrity verified under Node 24.
