# PostHog Analytics Patterns

## Configuration
- SDK: `posthog-js` (client-side)
- Client wrapper: @web/src/lib/analytics/posthog.ts
- Provider: @web/src/components/providers/PostHogProvider.tsx
- Env: `NEXT_PUBLIC_POSTHOG_KEY` (client-safe, build-time)

## Event Tracking Pattern
```typescript
import { trackEvent, AnalyticsEvent } from '@/lib/analytics/posthog';

trackEvent(AnalyticsEvent.GAME_CREATED, { templateId: 'platformer' });
```

## Standard Events (AnalyticsEvent enum)
- `GAME_CREATED`, `AI_GENERATION_STARTED`, `AI_GENERATION_COMPLETED`
- `GAME_PUBLISHED`, `GAME_EXPORTED`, `TEMPLATE_USED`, `SUBSCRIPTION_STARTED`

## Gotchas
1. **Production only**: PostHog only initializes when `NODE_ENV === 'production'` AND key is set. No-op in dev/test.
2. **Cookie consent required**: Must gate tracking behind consent for GDPR (PF-668). Not yet implemented.
3. **Client-side only**: posthog-js runs in browser. Server-side events need separate PostHog Node SDK (not currently used).
4. **Feature flags**: PostHog supports feature flags. Not yet wired into the codebase but planned.

## Testing
- PostHog is a no-op in test environment (no key set)
- No need to mock unless testing tracking behavior specifically
