---
description: ESLint zero-warning rules, React patterns, Next.js constraints, README update triggers
paths:
  - "web/**"
  - "packages/**"
  - "apps/**"
  - "mcp-server/**"
---

# Web Code Quality & Patterns

## ESLint (Zero Warnings Enforced)
CI runs `npx eslint --max-warnings 0`. Fix immediately, never defer.

### Rules in Effect
- **`@typescript-eslint/no-unused-vars`** — `_` prefix convention for intentionally unused: `argsIgnorePattern: ^_`, `varsIgnorePattern: ^_`, `destructuredArrayIgnorePattern: ^_`
- **`react-hooks/purity`** — No `Date.now()`, `performance.now()`, `Math.random()` during render. Use `useMemo` + targeted eslint-disable if unavoidable
- **`react-hooks/refs`** — No `useRef.current` during render. Use `useState` previous-value pattern instead
- **`react-hooks/set-state-in-effect`** — No synchronous `setState` in effect bodies. Use `useMemo` or `useState` prev-value pattern
- **`react-hooks/exhaustive-deps`** — All deps listed. Wrap handlers in `useCallback` for stability
- **`@next/next/no-img-element`** — Use `next/image`. Exception: dynamic data URLs with inline eslint-disable
- **`jsx-a11y/alt-text`** — Lucide `Image` icon: import as `ImageIcon` to avoid false positive

### When encountering warnings:
1. Unused imports/variables -> remove them
2. Unused function params -> prefix with `_`
3. Missing effect deps -> add them (wrap unstable handlers in `useCallback`)
4. Impure render -> move to `useEffect`/`useMemo`/event handler
5. Never add blanket `eslint-disable` at file level. Use `eslint-disable-next-line` on specific lines

## React Patterns
- **useState prev-value pattern:** `const [prev, setPrev] = useState(prop); if (prev !== prop) { setPrev(prop); setDerived(compute(prop)); }` — NOT useRef during render
- **No setState in effects** — Use `useMemo` or `useState` prev-value for derived state

## Next.js Constraints
- **Import boundary:** Production builds CANNOT import outside `web/`. Shared data must be copied into `web/src/data/`
- **MCP manifest dual location:** Source at `mcp-server/manifest/commands.json`, copy at `web/src/data/commands.json` — keep in sync
- **Turbopack:** Next.js 16 uses Turbopack by default for both dev and build. Dev uses `--webpack` flag for compatibility. Build uses Turbopack (default)
- **Proxy file:** Next.js 16 renames `middleware.ts` → `proxy.ts`. Export `proxy` function, not `middleware`
- **Root layout force-dynamic:** Root layout has `export const dynamic = "force-dynamic"` to prevent prerender failures when Clerk keys are missing in CI
- **Two files resolving to the same route silently drop one — including its layout.** Route groups are stripped from the URL, so `app/(marketing)/page.tsx` and `app/page.tsx` BOTH resolve to `/`. Next.js 16 compiles both (visible in `.next/server/app-paths-manifest.json`), picks one — `/page` won — and emits no error. The loser's `layout.tsx` never wraps anything, which is how the landing page lost its only scroll wrapper (PF-1017 / #9037). Before adding a route group whose index maps to an existing path, grep `web/src/app` for a colliding `page.*`. Guarded repo-wide by `web/src/app/__tests__/public-scroll.test.ts`, which walks every `page.{tsx,ts,jsx,js,mdx}` under `app/`, collapses route-group segments, and fails on any URL path claimed twice at any depth.

## README Update Guide
Update README.md when: phases completed, MCP command count changes, libraries added, prerequisites change, structure changes, build process changes. Commit alongside feature code.

| Section | Trigger |
|---------|---------|
| Features -> AI & Automation | MCP commands added/removed |
| Features -> Engine | New engine capability |
| Features -> Editor | New editor panel or workflow |
| Architecture diagram | MCP count change, new layer |
| Tech Stack | New library adopted |
