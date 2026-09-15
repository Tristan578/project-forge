---
"web": minor
---

Add the observatory inventory scanner core (`tools/observatory/`): a deterministic, read-only tool that walks `git ls-files -z` as the tracked-file denominator and maps every tracked file to a stable capability ID, a reasoned exclusion (generated/vendored/binary), an in-scope gap, or an explicit "not yet covered" bucket. It emits a machine-readable `inventory.json` and a human-readable unmapped/excluded report, with primary-ownership dedup so shared files are counted once, alias-based stable IDs across renames, and planned capabilities that exist before code does. This first slice covers the web shell/stores and mcp-server manifest domains to prove the mechanism end-to-end; remaining domains and CI drift enforcement follow in child issues.
