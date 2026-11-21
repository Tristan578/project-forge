# @spawnforge/ui

## 0.2.0

### Minor Changes

- [#8163](https://github.com/Tristan578/project-forge/pull/8163) [`d9e0f22`](https://github.com/Tristan578/project-forge/commit/d9e0f22dddde2b733f0792ffef1077fa6932306b) Thanks [@Tristan578](https://github.com/Tristan578)! - Adopt Changesets for automated versioning, changelog generation, and release management across the monorepo.

- [#8166](https://github.com/Tristan578/project-forge/pull/8166) [`93caaa9`](https://github.com/Tristan578/project-forge/commit/93caaa9519a8c9ace393baf3b4d6f088e4a02016) Thanks [@Tristan578](https://github.com/Tristan578)! - Add axe-core accessibility testing for all 20 primitives across 7 themes, Chromatic visual regression CI, and token reference stories (Colors, Spacing, Typography, Radius)

- [#8167](https://github.com/Tristan578/project-forge/pull/8167) [`0b87885`](https://github.com/Tristan578/project-forge/commit/0b878859a7ed59a399aa14c23d783c2e3bd5e9aa) Thanks [@Tristan578](https://github.com/Tristan578)! - Add 7 remaining composites to complete the Tier 2 component library: Vec3Input, SliderInput, ColorPicker, TreeView, PropertyGrid, CollapsibleSection, KeyboardShortcutsPanel

### Patch Changes

- [#8324](https://github.com/Tristan578/project-forge/pull/8324) [`bf3bc88`](https://github.com/Tristan578/project-forge/commit/bf3bc889f97d10ed00567d060acc96b869e73d13) Thanks [@Tristan578](https://github.com/Tristan578)! - Use --sf-border-strong on interactive primitives (Avatar, Badge, Button outline, Input, Checkbox, Switch, Textarea, Select) and SettingsPanel checkbox for better border contrast across all themes. Add CI contrast audit (WCAG 1.4.11) to prevent silent regression. Fix light theme --sf-warning contrast (#ca8a04 -> #b8790a, 3.64:1).

- [#8672](https://github.com/Tristan578/project-forge/pull/8672) [`a195378`](https://github.com/Tristan578/project-forge/commit/a1953783e5f81b465b16028eb37638743ec98803) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(ci): align the Node runtime version across the whole monorepo on the canonical major 24.

  The Node version was declared in many drifting places — `.node-version` (24, used by Vercel) disagreed with `.nvmrc` (20), with `engines.node` (`>=20 <25`), and with 31 hardcoded `node-version: 20` inputs to `actions/setup-node` across every GitHub workflow. CI therefore ran on Node 20 while Vercel built on Node 24, the "green in CI, broken on Vercel" footgun (PF-841, [#8665](https://github.com/Tristan578/project-forge/issues/8665)).

  - `.node-version` is now the single source of truth; every `actions/setup-node` step reads it via `node-version-file: .node-version` instead of a hardcoded literal, so there is exactly one place to bump.
  - `.nvmrc` and `engines.node` (`>=24 <25`) now agree, and the previously engines-less workspaces (`apps/docs`, `apps/design`, `packages/ui`) declare `engines.node`.
  - Dropped the now-obsolete `dependabot.yml` ignore that blocked `portless >=0.13.1` "until we adopt Node 24" — that condition is satisfied.
  - A node-environment vitest guard (`web/src/lib/config/__tests__/nodeVersionConsistency.test.ts`) fails CI if any of these sources drift apart again.

- [#8330](https://github.com/Tristan578/project-forge/pull/8330) [`b17dfbc`](https://github.com/Tristan578/project-forge/commit/b17dfbcacdf5ab08abf00991fe30449ee6dd7af7) Thanks [@Tristan578](https://github.com/Tristan578)! - UX/DX audit fixes: tune accent injection percentages, remove duplicate Dialog Escape handler, add Popover aria-label prop, fix Select wrapper width, fix Tabs panel mounting, fix Avatar test fixture, strengthen theme personality across 20 primitives
