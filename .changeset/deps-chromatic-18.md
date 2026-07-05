---
"web": patch
---

chore(deps-dev): bump chromatic from 11.29.0 to 18.0.1 in apps/design (#8916)

Dev-toolchain-only update: bumps the `chromatic` CLI devDependency range in `apps/design` (`^11` → `^18`). The CLI is only invoked by the Chromatic Visual Regression job in `quality-gates.yml`, which already pins `chromaui/action` v18.0.1 — this aligns the local CLI with the action. CLI 18 renames its bin entry to `dist/bin.cjs`, requires Node >= 22 (we run Node 24), and adds an optional `@chromatic-com/vitest` peer (unused). No runtime or published-artifact changes. The root lockfile was regenerated on Node 24 (`npm install --package-lock-only`) from main's lockfile as base. Note: Dependabot-authored CI runs skip the Chromatic project token, so the first token-bearing run after merge is the real CLI-18 smoke test.
