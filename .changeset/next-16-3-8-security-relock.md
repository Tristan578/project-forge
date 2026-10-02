---
"web": patch
"@spawnforge/docs": patch
---

Security update: Next.js moves from 16.3.5 to 16.3.8 in the editor and the documentation site. It fixes a critical vulnerability in social-preview image generation (the share cards for published games and marketing pages) plus several smaller hardening fixes. Nothing about the editor, published games or the docs site looks or behaves differently.

Details for maintainers: the Next.js advisory is GHSA-vcvr-r3jv-pc5j (`next/og` ImageResponse). The Next.js ESLint config and bundle analyzer move to the same version. The lockfile also relocks two transitive packages to their patched releases: `undici` 8.11.2 (GHSA-rfgv-xxqx-mfg5, GHSA-w293-vg96-wgc3) and `brace-expansion` 1.1.21 / 5.0.12 (GHSA-6j4f-fj2g-mc7p, GHSA-qhr7-859c-m2p7). No application code changes.
