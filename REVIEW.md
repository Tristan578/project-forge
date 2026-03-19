# SpawnForge Code Review Guidelines

## Always check
- New API routes have authentication (authenticateRequest or explicit auth:none comment)
- Rate limiting present on all public-facing endpoints (await rateLimitPublicRoute)
- AI generation routes track usageId for token refunds on failure
- Token refund (refundTokens) called in ALL error paths after deduction — not just streaming catch
- Request body validated before destructuring: guard null, array, non-object with 400
- Zustand selectors return primitive values, not functions (prevents unnecessary re-renders)
- All imports are used (ESLint --max-warnings 0 enforced in CI)
- Sentry captureException includes route context in extras
- Engine commands go through handle_command(), never direct DOM manipulation
- New workspace panels registered in panelRegistry.ts AND WorkspaceProvider.tsx
- New commands added to BOTH route_domain() match table AND domain dispatcher

## Security
- No raw SQL — all queries through Drizzle ORM
- Clerk webhook signatures verified via Svix
- Stripe webhook events claimed via claimEvent() for idempotency
- Content safety (sanitizePrompt) called before AI provider calls
- No secrets in client-side code (check for NEXT_PUBLIC_ prefix usage)
- CSP headers not weakened by new routes

## Performance
- No O(N^2) entity lookups — use entityIndex for scene queries
- Play-tick serialization uses delta encoding (not full scene)
- React components in editor panels should be lazy-loaded
- WASM calls batched where possible (avoid 100+ individual dispatches)

## Testing
- Every deferred Sentry finding MUST have a PF ticket number
- Mock chains must match production call depth (e.g., db.update().set().where().returning())
- No setTimeout in tests — use vi.waitFor() or fake timers
- After refactors, check for stale @ts-expect-error directives

## Skip
- Generated files under web/public/engine-pkg-*
- Drizzle migration files under web/drizzle/
- Lock files (package-lock.json)
- The .transform-gizmo-fork/ directory (local Bevy plugin fork)
