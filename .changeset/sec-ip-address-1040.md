---
"web": patch
---

fix(deps): relock ip-address to 10.4.0 — clears GHSA-mwp4-54f8-5fhr (SSRF / trust-boundary bypass)

`GHSA-mwp4-54f8-5fhr` (high) was published while #9073 was in flight and immediately re-reddened the `Quality Gates / Rust Security Audit` gate, this time in the `mcp-server` workspace: `ip-address`'s `Address4` decodes leading-zero octets as decimal while OS resolvers decode them as octal, so a value like `0177.0.0.1` can be validated as one address and resolved as another — an SSRF and trust-boundary bypass. Vulnerable at `<= 10.3.0`, patched at 10.3.1.

Scoped relock under Node 24 (`npm update ip-address --package-lock-only`): the single node moves 10.2.0 → 10.4.0 inside its existing range. Three lines, one node, no platform-native entries dropped.

This is the fourth high advisory to fire in a single afternoon (after `GHSA-rgw5-rvv9-x895` and `GHSA-mh99-v99m-4gvg` on brace-expansion and `GHSA-7p8r-x3mc-p8w7` on fast-uri, all fixed in #9073). The gate evaluates the advisory database at run time, so a green `Rust Security Audit` only certifies the moment it ran — it is not a durable property of the commit. A PR whose checks predate a publication is not "still green"; it is unverified against the current database.

Verified: `scripts/check-npm-audit.sh` exits 0 for `web`, `mcp-server`, and the repo root; `scripts/check-lockfile-sync.sh` passes against the committed lockfile; `npm ci` and `scripts/check-native-bindings.sh` verified under Node 24.
