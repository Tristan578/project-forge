---
'web': patch
---

Validate the OpenAPI spec in CI and gate route drift; stop `GET /api/openapi` from leaking parse errors.

A trailing comma in `docs/api/openapi.json` made the public `/api-docs` reference return 500 in production — the spec is `JSON.parse`'d and served verbatim by `GET /api/openapi`. The new `openapi-route-sync` CI gate validates the spec is parseable (turning that prod-500 class into a red PR) and asserts every `web/src/app/api/**/route.ts` is either documented in the spec or allowlisted in `docs/api/openapi-internal-routes.json` (a ratchet — only NEW drift fails the build). The `/api/openapi` 500 branch now routes the raw parse error to Sentry and returns a fixed, generic body instead of leaking parse internals (a `SyntaxError` naming a byte offset in the spec) to unauthenticated callers.
