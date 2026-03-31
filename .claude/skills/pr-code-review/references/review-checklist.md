# PR Review Checklist

Use this for every code review. Each section must be explicitly checked — do not skip sections that seem unrelated to the PR's stated purpose. A bug in "unrelated" code is still a bug you shipped.

---

## Architecture

- [ ] No imports outside `web/` in Next.js code (production builds hard-fail)
- [ ] Bridge isolation maintained: `engine/src/core/` has zero `web_sys`/`js_sys`/`wasm_bindgen` imports
- [ ] New ECS components registered in all 8 required locations (see component checklist in CLAUDE.md)
- [ ] `mcp-server/manifest/commands.json` and `web/src/data/commands.json` are in sync (run `scripts/check-manifest-sync.ts`)
- [ ] No `db.transaction()` usage with neon-http driver (use `getNeonSql()` → `neonSql.transaction([...])`)
- [ ] No `auth()` directly in Server Components (use `safeAuth()` from `@/lib/auth/safe-auth.ts`)
- [ ] New panels inserted correctly in `panelRegistry.ts` (read 10 lines before AND after insertion point)

## Security

- [ ] All async rate-limit calls have `await` (`rateLimitPublicRoute()` is async — missing await silently bypasses)
- [ ] User input validated before use in DB queries
- [ ] No environment secrets logged or returned in API responses
- [ ] Clerk auth checked on all new API routes that touch user data
- [ ] No `any` type that widens the attack surface (especially in request/response parsing)
- [ ] New API routes have rate limiting applied

## Developer Experience

- [ ] ESLint zero-warning policy maintained (CI runs `--max-warnings 0`)
- [ ] No unused imports or variables (use `_` prefix for intentional unused params)
- [ ] TypeScript `strict` mode compliant — no `@ts-ignore`, prefer `@ts-expect-error` with comment
- [ ] New functions exported from their module's index if they are public API
- [ ] Error messages are actionable (say what went wrong AND what to do)
- [ ] No hardcoded magic numbers — use named constants from `web/src/lib/constants/`

## UX / Frontend

- [ ] Color scale is `zinc-*` (not `gray-*`, not `slate-*`)
- [ ] All interactive elements keyboard-navigable with visible focus rings
- [ ] Icon-only buttons have `aria-label`
- [ ] Modal/dialog components trap focus
- [ ] Empty states show actionable guidance, not blank space
- [ ] Lists > 50 items use `useVirtualList` hook

## Testing

- [ ] Every new public function has at least one test
- [ ] Every bug fix has a regression test (if PR has `bug` label or `Closes #NNN`)
- [ ] Tests use `@/lib/...` aliases in `vi.mock()` — never relative paths from `__tests__/`
- [ ] No `it.skip` or `it.todo` without a PF ticket number comment
- [ ] Store slice tests use `createSliceStore()` + `createMockDispatch()` pattern
- [ ] E2E tests wait for WASM engine readiness before interacting with canvas
- [ ] Test names read as specifications: `it('returns NaN-safe default when tokenCount is undefined')`
