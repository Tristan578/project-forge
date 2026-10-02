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

## TypeScript: `exactOptionalPropertyTypes`
- **On in:** `apps/docs`, `mcp-server`, `packages/ui`, `web` (each package's own `tsconfig.json`; CI type-checks each with `npx tsc --noEmit`). #7592 covered the first three, #10230 `web`. `scripts/__tests__/exact-optional-property-types.test.mjs` pins the flag in all four, because deleting it changes nothing else CI can see.
- **What it rejects:** assigning `undefined` to a property declared `prop?: T`. Under the flag "key absent" and "key present, value `undefined`" are different types, so forwarding a maybe-undefined value (`<TreeItem onSelect={onSelect} />`, `{ min: opts.min }`) no longer compiles.
- **Pattern — omit the key instead of passing `undefined`:** `...(x !== undefined && { x })`, in JSX props or object literals (e.g. `packages/ui/src/composites/TreeView.tsx`, `Vec3Input.tsx`, `mcp-server/src/docs/search.ts`). Compare against `undefined`, not truthiness, so `0`, `''` and `false` still forward.
- **When widening to `prop?: T | undefined` is allowed:** widening switches the check off for that field, so it needs a reason. It is fine where `undefined` and an absent key already mean the same thing to every consumer: each read goes through `??`, `?.`, `!== undefined` or a destructuring default. That covers a type that really carries `undefined`, such as a test double mirroring Node's `socket.remoteAddress`, and most of the optional fields `web/` widened in #10230 (including `@spawnforge/ui`'s `NumberField` `min`/`max`, `Input` `error` and `Button` `variant`). Check the consumers before you widen, not after.
- **Never widen a merge target.** A type that is merged with a bare spread (`{ ...existing, ...patch }`) must not admit `undefined`: an explicit `undefined` key overwrites the real value. Strip the keys instead with `omitUndefinedValues` (`web/src/lib/utils/omitUndefined.ts`), e.g. a zod-parsed partial in `web/src/lib/chat/handlers/handlers2d.ts`. Use `LoosePartial<T>` (`web/src/lib/types/looseOptional.ts`) only for a patch parameter whose function already checks each key with `!== undefined`. It is never right for a bare spread.
- **Casts:** don't cast with `as` to silence the flag in our own code. Casts are sanctioned only for third-party type variance that neither side owns, with a comment saying why:
  - the MCP SDK `Transport` in `mcp-server/src/transport/http.ts`, tracked for removal in #10278;
  - Clerk's `dark` theme in `web/src/app/layout.tsx`: `@clerk/themes` (2.4.57) types `cssLayerName?: string | undefined`, while the `appearance.theme` prop it is passed to types the field as plain `string`.
- **Vendored copy:** after changing `packages/ui/src/`, run `bash apps/design/scripts/sync-vendored-ui.sh` and commit the regenerated `apps/design/vendored/spawnforge-ui/` files.

## Next.js Constraints
- **Import boundary:** A production build CANNOT import above its Vercel `rootDirectory` (`web/` for the app, `apps/docs/` for the docs site). Shared data must be copied inside each deploy root
- **MCP manifest — THREE copies:** source at `mcp-server/manifest/commands.json`, copies at `web/src/data/commands.json` and `apps/docs/data/commands.json` (one per deploy root). All three must stay identical; `apps/docs/scripts/check-manifest-sync.ts` enforces it in CI and `bash .claude/tools/validate-mcp.sh sync` checks it locally
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
