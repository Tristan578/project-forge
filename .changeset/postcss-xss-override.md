---
"web": patch
---

Add npm override pinning `postcss >=8.5.10` (top-level + nested under `next`) to mitigate Dependabot alert #76 (postcss XSS via unescaped `</style>` in stringify output, GHSA-qx2v-qp2m-jg93). Next 16.2.4 pins postcss at exactly `8.4.31`, so the override needs the nested form to take effect on the transitive dep.
