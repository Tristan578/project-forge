---
"web": patch
"@project-forge/mcp-server": patch
---

fix(deps): relock `js-yaml` and `nanoid` past two new high advisories

Two upstream high advisories landed and started failing the `npm audit` gate on everything built from `main`:

- **GHSA-5p4m-2wfm-xmqj** — `js-yaml` quadratic CPU consumption resolving `!!omap` (affects `3.0.0 - 3.15.0` and `4.0.0 - 4.3.0`). Three nodes in the tree: the root `4.3.0` plus nested `3.15.0` copies under `gray-matter/` and `read-yaml-file/`.
- **GHSA-2v37-7h3g-55p8** — `nanoid` infinite loop in a custom generator when `size` is zero (`< 3.3.17`).

Both were relockable, so no allowlist waiver was added — `ALLOWED_ADVISORIES` stays empty. Scoped `npm update js-yaml nanoid --package-lock-only` on Node 24; the diff is exactly four nodes (`js-yaml` 3.15.0→3.15.1 ×2, 4.3.0→4.3.1, `nanoid` 3.3.16→3.3.18), version/resolved/integrity only, with no platform-native entries dropped.
