---
"web": patch
---

Add a strict interactive-journey CI gate that proves the core new-user journey (generated scene → entities spawn → Play → winnable → exportable) survives on the real `next build` + `next start` server. Editor/chat store hooks are now exposed on `window` behind a build-time `NEXT_PUBLIC_E2E_HOOKS` flag (defaults off; never set by any real deploy), and a new required `test-e2e-journey` job runs the curated `@journey` spec with `E2E_STRICT_STORES=true` so a broken stage fails the build instead of silently skipping.
