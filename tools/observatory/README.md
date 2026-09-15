# Observatory repository inventory

This internal tool inventories tracked source files. The initial rules cover
`web/src/stores/`, `web/src/lib/workspace/`, and `mcp-server/manifest/`.
Other areas remain explicitly uncovered under [#9752](https://github.com/Tristan578/project-forge/issues/9752).

File attribution does not establish that a feature works, has runtime evidence,
or meets its acceptance criteria.

## Accounting

The CLI uses `git ls-files -z`, including staged paths and excluding untracked
files. Every unique path belongs to one bucket:

| Bucket | Meaning |
| --- | --- |
| `owned` | Attributed to one capability. |
| `excluded` | Matched by a generated, vendored, or binary exclusion with a nonblank reason. |
| `unmapped` | Inside a covered scope without an ownership or exclusion rule. |
| `notYetCovered` | Unowned and non-excluded, outside all covered scopes. |

The bucket counts sum to the tracked-file count. Secondary links never add to
that denominator. A reconciled count proves complete classification, not complete
capability coverage.

## Run and validate

Install dependencies at the repository root with `npm ci`, then:

```sh
cd tools/observatory
npm run observatory:scan
npm test
npm run typecheck
```

The scanner writes `inventory.json` and `unmapped-report.md` in this directory.
Both are ignored by this package's committed `.gitignore`. Set
`OBSERVATORY_OUT_DIR` to an existing directory to redirect them. A Git, input-file,
or output-write error exits unsuccessfully. Reported inventory gaps are data;
the CLI does not yet enforce a repository-wide drift policy.

From the repository root, CI runs:

```sh
npx tsc --noEmit -p tools/observatory/tsconfig.json
npx vitest run --config tools/observatory/vitest.config.ts
```

The Observatory Tests job runs for scanner, CI, or dependency changes and is
required by CI Success. Unit and CLI tests are enforced separately from the
deferred inventory-drift policy.

## Rules

`capabilityRules.ts` defines the coverage scopes, ownership rules, exclusions,
planned capabilities, and domain labels.

```ts
interface CapabilityRule {
  capabilityId: string;
  domain: string;
  confidence: 'reviewed' | 'extracted';
  own: string[];
  primaryOwner?: string;
  crossLink?: string[];
}
```

- Declaration order determines ownership: the first matching `own` rule wins.
  Other matching capabilities receive secondary links. Explicit `crossLink`
  patterns add links to files owned elsewhere.
- Ownership takes precedence over exclusions. Exclusions require a nonblank
  reason even if they match no current file.
- A declared `primaryOwner` must be owned by that capability. Missing or
  incorrectly attributed representatives produce structural gaps.
- `reviewed` and `extracted` are declared mapping-confidence labels.
  Directory catch-alls can establish accounting while remaining extracted
  candidates; they do not prove functional completeness.
- Planned capabilities represent requirements before implementation. They do
  not need an artifact merely to appear in the inventory.

`aliases.json` requires an `aliases` array with nonblank string `from` and `to`
fields; use an empty array for an explicitly empty history. Invalid structure
fails before any artifacts are written. The mappings connect prior capability
IDs to current IDs. Valid chains resolve
to their terminal target. Missing targets, cycles, and conflicting targets
produce diagnostics. The exported `resolveCapabilityId` throws on cyclic or
ambiguous resolution instead of returning an arbitrary ID.

## Artifacts

`inventory.json` contains the schema version, coverage scopes, accounting,
capabilities, exclusions, uncovered paths, structural gaps, and aliases.
`unmapped-report.md` summarizes those findings for review, including missing
or incorrectly attributed primary owners and alias problems.

Reports render filenames and configuration strings as literal text so unusual
names cannot introduce Markdown headings or table columns. Output ordering is
stable and contains no timestamps; identical inputs produce identical artifacts.

To add a domain, update its path scopes, ordered ownership rules, reasoned
exclusions, planned requirements, and coverage labels together, then run the
tests and inspect both artifacts.

## Remaining work

Dynamic dependency edges, the complete operation-family registry, other domain
mappings, and repository-wide inventory-drift enforcement remain outside this
initial slice. They remain part of #9752.
