---
"web": patch
---

Guard the RSC boundary around `lib/chat/handlers/`.

Most chat handlers value-import a Zustand store. That is safe only because
nothing in the server graph can reach them — a property nothing checked. A new
test walks the real import graph outward from every shipped module under `app/`,
stopping where a module declares `'use client'`, and fails if any of them reaches
a handler at any depth. The day that stops being true it is a red test rather
than an opaque `next build` failure on a module that never mentions a store.

The comment stripper and type-only detector the existing `game-creation` scan
uses now live in `test/utils/importScanner.ts` and are shared by both, rather
than existing as two hand-rolled copies of the same subtle logic. The shared
extractor reads whole statements rather than physical lines, so a Prettier-wrapped
`await import(…)` — a form this repo already ships — is a module edge the scan
sees instead of a silent miss.
