---
"web": patch
---

Minor and patch dependency bundle — 41 bumps across five workspaces (#9961).

Runtime dependencies move here, not just tooling: `next` 16.3.3 → 16.3.4, `@sentry/nextjs` and `@sentry/profiling-node` 10.72.0 → 10.73.0 (kept on the same version, which `sentry-regressions.test.ts` pins), `@clerk/nextjs` 7.8.4 → 7.9.1, `stripe` 22.6.0 → 22.6.1, `posthog-js` 1.422.5 → 1.427.2, `@upstash/redis` 1.38.3 → 1.38.4, `@xyflow/react` 12.11.5 → 12.11.6 and the `@ai-sdk/*` family. No source change accompanies them.

One transitive move is worth recording because it broke a test without changing any declared range: `lucide-react` re-resolved 1.37.0 → 1.43.0 inside its unchanged `^1.33.0`, and Lucide now emits `lucide-sidebar` as an alias class on every `PanelLeft` icon. Three E2E specs were selecting the sidebar with `[class*="sidebar"]` — a selector for the word rather than the element — and now target `data-testid="editor-sidebar"` instead.
