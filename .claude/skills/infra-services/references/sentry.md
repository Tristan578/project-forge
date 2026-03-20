# Sentry Error Tracking Patterns

## Configuration
- Org: `tristan-nolan` (NOT `ember-l0`)
- Project: `spawnforge-ai`
- SDK: `@sentry/nextjs`
- Env: `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (server-only)

## Usage Pattern
```typescript
import * as Sentry from '@sentry/nextjs';

try {
  // risky operation
} catch (error) {
  Sentry.captureException(error, { extra: { context: 'relevant data' } });
  // handle gracefully
}
```

## Where Sentry Is Used
- API route error handling (chat, projects, generation routes)
- Token refund failures (catch block in generate routes)
- WASM initialization failures

## Gotchas
1. **Correct org name**: `tristan-nolan`, NOT `ember-l0`. This has caused configuration failures before.
2. **Source maps**: Configured for WASM debugging. Sentry needs source maps uploaded during build.
3. **Fingerprinting**: Configure alert rules to group related errors (PF-670).
4. **Rate limiting the reporter**: Add rate limiting to Sentry error reporting endpoint (PF-384, done).
5. **captureException in catch blocks**: Always include contextual `extra` data for debugging.

## Testing
- Mock `@sentry/nextjs` in tests: `vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))`
- Test that captureException is called with correct context
