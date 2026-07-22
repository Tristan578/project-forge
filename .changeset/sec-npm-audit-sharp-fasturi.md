---
"web": patch
---

fix(deps): clear npm-audit gate — sharp 0.34→0.35 (CVE) and fast-uri 3.1.3→3.1.4

Two source advisories were blocking the `Quality Gates / Rust Security Audit` npm-audit gate (`scripts/check-npm-audit.sh`) at high severity, which in turn blocks the merge train.

- **sharp**: next's optional transitive was pinned at 0.34.5 (vulnerable). `overrides` alone cannot bump it — npm drops an optional dep to `undefined` when an override forces a range its parent doesn't satisfy. Fix: declare `sharp: ^0.35.0` as a direct root **devDependency** (forces 0.35.x into the tree, reproducible via `--package-lock-only`) plus an `overrides.next.sharp: ^0.35.0` so next's optional range realigns and dedupes to the single hoisted 0.35.3 node instead of keeping a stray 0.34.5 copy. devDependency is semantically correct: on Vercel, next image optimization runs Vercel-side, so sharp is build/dev-time only and `npm ci --omit=dev` pruning it in prod is harmless. Verified: sharp → 0.35.3, zero stray 0.34.x nodes; sharp ships prebuilt `@img/sharp-<platform>` binaries so this adds no compile step.
- **fast-uri**: overridden to `^3.1.4` (NOT `>=3.1.4`, which overshoots to 4.1.1 and violates ajv's `^3.0.1`). Resolves to 3.1.4.

Root lockfile relocked on Node 24 with the CI-exact `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` (idempotent; the diff touches only sharp/@img/fast-uri nodes — no unrelated drift). Both audit gates (`web` and `mcp-server`) now pass exit 0; `npm ci` integrity verified under Node 24.
