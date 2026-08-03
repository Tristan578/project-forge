---
"web": patch
---

fix(deps): relock brace-expansion to 1.1.18 / 5.0.9 and fast-uri to 3.1.5 — clears three high advisories and retires the last npm-audit waiver's premise

The `Quality Gates / Rust Security Audit` npm-audit gate (`scripts/check-npm-audit.sh`) went red repo-wide. This was not caused by any PR's diff — the advisory database is evaluated at run time, so every open PR fails the same gate on re-run while their existing greens predate the publication.

Two advisories fired on `brace-expansion`:

- **GHSA-rgw5-rvv9-x895** (high, newly published, NOT allowlisted): DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation. Patched at 1.1.18 / 2.1.4 / 3.0.6 / 5.0.9.
- **GHSA-mh99-v99m-4gvg** (high, allowlisted) reported outside its pinned location — the #9016 regression class the location pinning from PF-1009 exists to catch. Patched at 1.1.17 / 5.0.8.

A third advisory published while this fix was being verified, on a different package — the same live-database class, and the reason the gate went red again on a re-run with no diff change:

- **GHSA-7p8r-x3mc-p8w7** (high, newly published, NOT allowlisted): `fast-uri` host confusion via a backslash authority introducer. Patched at 2.4.4 / 3.1.5 / 4.1.2. The tree carries exactly one node at 3.1.4; it relocks to 3.1.5 inside its existing range (three lines, one node).

Fixed with a scoped relock under Node 24 (`npm update brace-expansion --package-lock-only`): the root copy moves 1.1.16 → 1.1.18 and both nested copies (under `glob/` and `@typescript-eslint/typescript-estree/`) move 5.0.8 → 5.0.9. Nine insertions and nine deletions, touching only those three nodes — no platform-native entries dropped and no pinned roots floated.

The relock also invalidates the premise of the gate's sole remaining waiver. Its justification claimed the advisory was "patched ONLY in 5.0.8 (no 1.x/2.x backport exists)", which made the root `brace-expansion@1.1.x` under the minimatch@3 / eslint-9 lint toolchain un-relockable. Upstream shipped 1.1.17, so that is no longer true: the root copy relocks inside its existing `^1.1.7` range with no eslint-major migration. The waiver's comment is corrected in place to record this — the entry now waives nothing and the gate emits its anti-rot note for it in every workspace. Deleting the entry is deliberately left to a follow-up (PF-1046) because the hardened self-defense suite pins the id as present, sed-anchors its variant harness on the exact entry literal, and would need empty-array guards for bash 3.2 on macOS.

Verified after both relocks: `npm audit --json` reports zero vulnerabilities at every severity across the whole graph; `scripts/check-npm-audit.sh` exits 0 for `web`, `mcp-server`, and the repo root, each printing the anti-rot note; `scripts/__tests__/check-npm-audit.test.sh` passes in full; `scripts/check-lockfile-sync.sh` passes against the committed lockfile; `npm ci` and `scripts/check-native-bindings.sh` verified under Node 24.
