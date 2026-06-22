---
"web": patch
---

Bump `dompurify` to `>=3.4.10` (from `>=3.4.1`) via the repo-wide npm `overrides`
floor, picking up the upstream patch releases for the HTML sanitizer used on
user-supplied content. The root `package-lock.json` resolves `dompurify` to
`3.4.10`. Dependency hygiene — applied proactively rather than waiting for a
breaking advisory.
