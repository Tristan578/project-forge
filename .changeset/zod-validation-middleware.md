---
'web': patch
---

Migrate API routes to Zod validation via `withApiMiddleware(validate: schema)`. Replaces manual `parseJsonBody`/`requireString`/`requireObject` helpers in 8 routes (feedback, publish, projects/[id] PUT, marketplace/seller POST+PATCH, community comment, keys/[provider] PUT, user/profile PUT). Validation failures now return 422 `VALIDATION_ERROR` (standards-compliant) instead of 400. JSON parse errors remain 400. Lenient legacy behavior preserved in publish route (thumbnail/tags accept junk values via `z.unknown()` for backward compat).
