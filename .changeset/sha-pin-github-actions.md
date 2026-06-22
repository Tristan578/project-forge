---
"web": patch
---

Pin all GitHub Actions in the hand-written workflows to immutable commit SHAs
(audit finding F35, #8627). Third-party actions (`chromaui/action`,
`Swatinem/rust-cache`, `changesets/action`, `dtolnay/rust-toolchain`) and
first-party `actions/*` were referenced by floating tags — and
`dtolnay/rust-toolchain@stable` by a mutable *branch* — so a re-tagged or
compromised upstream would run in CI with repository-token access. Each `uses:`
now carries a 40-char SHA plus a `# <version>` comment (Dependabot's
github-actions updater bumps both forward). The `dtolnay/rust-toolchain` steps
gained an explicit `toolchain: stable` input so SHA-pinning does not drop the
channel that the `@stable` ref previously selected. A new
`scripts/check-actions-pinned.sh` guard runs as the path-gated
`actions-pin-check` job inside `ci.yml` — wired into the required `CI Success`
aggregate (and its anti-tamper map) like the other self-defending gates — so
any future PR that reintroduces a mutable tag fails a required check rather than
a skippable advisory workflow.
