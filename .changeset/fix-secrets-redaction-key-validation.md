---
"web": patch
---

Harden secret handling and unauthenticated metadata exposure:

- **Structured logger redaction (#8642):** `logger.*` now redacts values under
  sensitive key names (apiKey, token, secret, password, authorization,
  encryptedKey, …) and scrubs secret-shaped substrings (Bearer tokens, Stripe
  `sk_/pk_/whsec_`, OpenAI `sk-`, `forge_`, JWTs) from log messages and nested
  context/Error objects before they reach stdout or aggregation. Depth- and
  cycle-bounded so a pathological context object can never hang the logger.
- **Encryption master key validation (#8641):** `ENCRYPTION_MASTER_KEY` is now
  validated as a 64-character hex string both at startup
  (`validateEnvironment()`) and in `getMasterKey()`, surfacing a clear error
  instead of a cryptic "Invalid key length" on the first BYOK encrypt/decrypt
  (`Buffer.from(hex)` silently truncates at the first non-hex char).
- **Health endpoint metadata (#8648):** the unauthenticated `/api/health`
  response no longer exposes the git branch ref (`VERCEL_GIT_COMMIT_REF`), which
  leaked internal branch naming and in-flight feature work. The short commit SHA
  is still returned for build identification.
