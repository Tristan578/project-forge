---
"spawnforge": patch
---

Bump npm `overrides` pins to clear 10 medium-severity Dependabot alerts:

- `dompurify` → `>=3.4.1` (covers 8 XSS bypass alerts; was `>=3.3.2`)
- `uuid` → `>=14.0.0` (transitive via svix/Storybook; missing buffer bounds check in v3/v5/v6)
- `fast-xml-parser` → `>=5.7.2` (transitive via @aws-sdk/client-s3; CDATA injection)

Also pins `stripe` at `~22.0.1` to preserve the existing `2026-03-25.dahlia` API version (avoids accidental minor 22.1.0 bump that ships a newer required API version), and adds `ajv@^6.14.0` as an explicit `web` devDep so `contracts.test.ts` no longer relies on incidental hoisting of a transitive ESLint ajv.
