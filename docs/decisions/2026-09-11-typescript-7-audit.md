# TypeScript 7 audit: adopt the config changes now, defer the compiler

- **Date:** 2026-09-11
- **Status:** Accepted
- **Context:** #9975 (audit), surfaced by the changelog review on 2026-09-10

## Decision

**Land the two configuration changes TypeScript 7 requires, under TypeScript 6, now.**
They are proven no-ops on the current compiler.

**Do not adopt the TypeScript 7 compiler yet.** Revisit when 7.1 ships a stable
programmatic API.

## What TypeScript 7 is

7.0.2 shipped 2026-08-20 — the native Go port, 8–12× faster compiles, from the
`microsoft/typescript-go` repository. It is structurally compatible with the JavaScript
implementation and is not a language change.

## Measured blast radius

Every removal in 7.0, checked against every `tsconfig.json` in this repository rather than
reasoned about:

| Removed / changed in 7.0 | Our state | Verdict |
|---|---|---|
| ES5 target removed | `web` is `ES2017`; the rest `ES2022` | safe |
| `downlevelIteration` removed | set nowhere | safe |
| `moduleResolution: node` / `node10` removed | every config uses `bundler` | safe |
| AMD / UMD / SystemJS / none modules | every config is `esnext` / `ESNext` | safe |
| `esModuleInterop: false` forbidden | `true` wherever set | safe |
| `moduleResolution: classic` removed | unused | safe |
| new default `strict: true` | already `true` everywhere | no-op |
| `module` keyword in namespaces | unused | safe |
| `asserts` on imports | unused | safe |
| **`baseUrl` removed** | root `tsconfig.json` set it | **fixed here** |
| **new default `types: []`** (was `["*"]`) | only `autoforge` set it explicitly | **fixed here** |
| new default `rootDir: "./"` | `web`, `apps/docs` leave it unset | see below |

### `baseUrl` — removed, and it cost nothing

The root `tsconfig.json` contained only `baseUrl` and a `paths` entry, and **nothing
extends it** — every workspace carries its own config. TypeScript 5+ resolves `paths`
relative to the config file without `baseUrl`, so dropping it is inert.

Verified under TypeScript 6: `tsc --noEmit` passes in `web`, `packages/ui`, `mcp-server`
and `apps/docs`.

### `types: []` — the one I expected to hurt, and it did not

This was the change to be careful with. Turning off `@types` auto-discovery is exactly the
class of failure behind #9968, where a type shim resolved from the workspace root and
vanished in the deploy root, breaking the production docs deploy across four commits.

Measured, with `"types": []` added to all four configs under TypeScript 6:

```
web              0 errors
packages/ui      0 errors
mcp-server       0 errors
apps/docs        0 errors
```

Zero. Next.js declares what it needs through `next-env.d.ts`, and the hand-written shims
(`jest-axe.d.ts` in both `apps/docs` and `packages/ui`) were made self-contained by #9968
precisely so they borrow nothing from outside their directory. That earlier fix is what
makes this one free.

`apps/docs` was additionally verified with a real `next build` in its own deploy root, not
just `tsc --noEmit` — a local typecheck cannot see the failure mode #9968 was made of.

### `rootDir`

`web` and `apps/docs` do not set it, so 7.0's `./` default would apply. Both are Next.js
apps whose `tsconfig.json` sits at the app root, which is what the new default resolves to,
so no change is expected. **Not verified** — it cannot be, without the 7.0 compiler. Flagged
for whoever does the upgrade.

## Why the compiler is deferred

**TypeScript 7.0 ships no stable programmatic API.** Anything embedding the compiler can
only use 6.x — including `typescript-eslint`, which reaches us through `eslint-config-next`
(`^16.3.4`). The API is expected in 7.1.

The vendor's workaround is running both compilers side by side:

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

So adopting 7.0 today means carrying two TypeScript installs, and every tool that touches
the compiler has to be checked for which one it resolves. That is a real maintenance
surface bought for a compile-speed win on a codebase whose `tsc --noEmit` is not currently
a bottleneck.

**Go/no-go: no-go on the compiler, go on the config.** The config changes are the entire
migration risk we can retire early, and retiring them now means the eventual bump is a
version change rather than a version change *plus* four config edits whose blast radius is
unknown at that moment.

## What this changes today

- `tsconfig.json` (root): `baseUrl` removed.
- `web`, `packages/ui`, `mcp-server`, `apps/docs`: explicit `"types": []`.

Both are correct under TypeScript 6 and required under 7. Nothing about the compiler moves.

Making `types` explicit is also an improvement independent of TypeScript 7: auto-discovery
silently pulls in every `@types/*` package anywhere in `node_modules`, which is how a
transitive dependency's globals leak into a workspace's type surface. Stating the empty set
means a future global dependency has to be declared where it is used.

## Residual risk

- **`rootDir` is unverified**, as above.
- **A future dependency needing a global type will now fail loudly** rather than resolving
  by discovery. That is the intended trade; the fix is to add it to the workspace's `types`
  array, not to delete the array.
- `typescript-eslint`'s resolution under a dual install is unexamined, because we are not
  doing the dual install.

## Revisit when

- TypeScript **7.1** ships the programmatic API — then re-run this audit against the
  `rootDir` default and the lint toolchain, and the upgrade should be a version bump.
- `eslint-config-next` bundles a `typescript-eslint` that supports 7.x directly.

## Sources (fetched 2026-09-10 / 2026-09-11)

- Release: https://github.com/microsoft/TypeScript/releases (7.0.2, 2026-08-20)
- Announcement, with the breaking-change list and the dual-install recipe:
  https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
