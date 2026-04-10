---
'web': patch
---

Migrate 21 API routes from inline typeof/manual validation to Zod schemas via `withApiMiddleware({ validate: schema })`. Schema validation failures now return HTTP 422 `{ error: 'Validation failed', code: 'VALIDATION_ERROR', details }` instead of ad-hoc 400 messages. Business-logic 400s (conflicting constraints, route-param regex checks, malformed JSON) are unchanged.
