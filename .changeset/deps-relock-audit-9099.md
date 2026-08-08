---
"web": patch
"@project-forge/mcp-server": patch
---

chore(deps): relock `nanoid`, `js-yaml` and `dompurify` to clear three published advisories (#9099)

The `npm audit` gate was red on all three audited workspaces (`.`, `web`, `mcp-server`):

- **GHSA-2v37-7h3g-55p8** (high) — `nanoid`: a custom generator can loop indefinitely when `size` is zero. `3.3.16` → `3.3.18`.
- **GHSA-5p4m-2wfm-xmqj** (high) — `js-yaml`: quadratic CPU consumption resolving `!!omap`. `4.3.0` → `4.3.1` at the root, and the two nested `3.15.0` copies (under `gray-matter/` and `read-yaml-file/`) → `3.15.1`. A root-only bump would have left both nested copies vulnerable.
- **GHSA-55q2-fjhq-7xh7** (moderate) — `dompurify`: an `IN_PLACE` hook removal leaves a detached subtree executable (XSS). The existing root override was pinned `>=3.4.12`, one patch short of the fix, so it actively held the vulnerable version in place; tightened to `>=3.4.13` and relocked to `3.4.13`.

Every fix was already published, so no `ALLOWED_ADVISORIES` waiver was added — the allowlist stays empty, which is its correct steady state.

Relocked on the pinned Node 24 toolchain with a scoped `npm update … --package-lock-only`. The committed lockfile carries exactly five changed nodes (`version`/`resolved`/`integrity` only) with zero nodes added or removed; the `libc` metadata that `npm update` strips from 34 Linux-only optional native nodes was restored so the file round-trips through `npm install --package-lock-only` unchanged.
