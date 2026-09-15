# Observatory — repository capability inventory scanner (core)

> Status: **proposed tooling, first slice.** This directory establishes the
> mechanism and the mapping-rule schema. It covers **two** domains end-to-end to
> prove the approach; every other domain in the epic is an explicit
> `notYetCovered` entry, not a silent omission. CI drift enforcement is
> deliberately **not** wired here — that requires the full domain set to avoid
> false positives and is tracked by a follow-up child issue.

The scanner answers one question deterministically: **is every git-tracked file
accounted for?** It takes `git ls-files -z` as the denominator and resolves each
tracked file into exactly one of four buckets.

| Bucket | Meaning |
| --- | --- |
| `owned` | A capability's primary attribution. Counted once. |
| `excluded` | A reasoned exclusion: `generated`, `vendored`, or `binary` — each with a required reason string. |
| `unmapped` | Inside a covered scope but matched by no rule. **A gap** — this is drift. |
| `notYetCovered` | Outside every covered scope. An explicit, expected gap for this slice. |

`owned + excluded + unmapped + notYetCovered === tracked` always holds
(`accounting.reconciles`). Secondary/cross-links never affect the denominator.

## Artifacts

Running the scanner produces two derived (uncommitted) files:

- `inventory.json` — machine-readable: capability id, domain, primary owner
  artifact, secondary links, confidence, planned requirements, exclusions, gaps,
  aliases, and the accounting summary. No timestamps, so two runs on the same
  commit tree are byte-identical.
- `unmapped-report.md` — human-readable: the coverage scope (covered vs
  not-yet-covered domains), the accounting table, every exclusion with its
  reason, in-scope gaps, extracted (candidate) mappings needing review, and a
  by-directory summary of what is not yet covered.

Both are git-ignored; a CI sync gate for them is deferred to a child issue.

## Running

From `tools/observatory/` (bins resolve from the repo-root install):

```bash
npm run observatory:scan            # writes inventory.json + unmapped-report.md here
OBSERVATORY_OUT_DIR=/tmp npm run observatory:scan   # redirect the outputs
npm test                            # vitest fixtures
```

Or from the repo root:

```bash
npx vitest run tools/observatory/__tests__/scan.test.ts
npx tsc --noEmit -p tools/observatory/tsconfig.json
```

## Mapping-rule schema

Rules live in `capabilityRules.ts`. The scanner core and its types live in
`scan.ts`.

### CapabilityRule

```ts
{
  capabilityId: string;      // stable ID, e.g. "shell-stores.chat"
  domain: string;            // e.g. "shell-stores" | "mcp"
  confidence: 'reviewed' | 'extracted';
  own: string[];             // globs whose files this capability OWNS (primary)
  primaryOwner?: string;     // the representative artifact (must be an owned file)
  crossLink?: string[];      // globs of files owned elsewhere that also link here
}
```

- **Order is precedence.** The first rule whose `own` globs match a file becomes
  that file's single owner. Put specific capabilities before directory
  catch-alls.
- **`reviewed`** means a human asserted the mapping is truth. **`extracted`** is
  a candidate (e.g. a directory sweep) still to be split — extracted capabilities
  are listed in `unmapped-report.md` so they stay visible for review.
- Importing a file or declaring a command is **not** proof of functional or
  telemetry coverage. A wildcard `own` is a denominator-accounting device, not a
  claim of completeness.

### Exclusions

`generated` / `vendored` / `binary`, each with a mandatory `reason`. Exclusions
are checked **after** ownership (`OWN > EXCLUDE`), so a broad exclusion glob can
never silently swallow a file an explicit rule maps.

### Planned capabilities

`PLANNED_CAPABILITIES` declares capabilities that must exist before any code
does. They own no files and are excused from the `capability-without-artifact`
gap. Contrast a **removed** primary owner (a declared `primaryOwner` absent from
the tracked set), which **is** a `missing-primary-owner` gap.

### Aliases

`aliases.json` keeps capability IDs stable across renames and moves:
`{ from, to }` maps a prior ID to its current one. Every `to` must resolve to a
declared capability, or the scan emits a `broken-alias` gap.

## Extending coverage to a new domain

1. Add the domain's path prefix(es) to `COVERED_SCOPES`.
2. Add reviewed `CapabilityRule`s for it (specific rules first; a domain
   catch-all last if you need 100% accounting immediately, at `extracted`
   confidence).
3. Add any reasoned exclusions and planned capabilities.
4. Move the domain from `COVERAGE_SCOPE.notYetCovered` to `.covered`.
5. Run `npm test` — the fixtures assert the accounting invariants the mechanism
   depends on, independent of your new rules.

## Out of scope for this slice (stated, not implied)

- **Dynamic/runtime dependency edges** (calls / emits / consumes / persists /
  serves). This slice is **static file mapping only**; typed dependency edges are
  a planned capability (`mcp.dependency-edges`), not delivered here.
- **CI drift enforcement.** Deferred to a child issue.
- **The full 394-operation-family registry** described in the issue's execution
  addendum. This is the first of several child slices; it does **not** close the
  parent epic.
