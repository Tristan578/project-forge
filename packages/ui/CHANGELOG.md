# @spawnforge/ui

## 0.3.1

### Patch Changes

- [#10113](https://github.com/Tristan578/project-forge/pull/10113) [`d0f8cbc`](https://github.com/Tristan578/project-forge/commit/d0f8cbc915e7ffc579e09fbf03a88bacf435cf67) Thanks [@Tristan578](https://github.com/Tristan578)! - Use semantic theme colours for health status cards and documentation, with readable status indicators and accessible shared controls.

## 0.3.0

### Minor Changes

- [#10068](https://github.com/Tristan578/project-forge/pull/10068) [`e70fe56`](https://github.com/Tristan578/project-forge/commit/e70fe5603bfe01be687965f4692e790be9457bee) Thanks [@Tristan578](https://github.com/Tristan578)! - Add a token-driven `InlineAlert` primitive to `@spawnforge/ui` (warning / error / info variants, optional `id`, `role="alert"` for errors and `role="status"` for warnings and info) and migrate the editor's bespoke inline notice boxes to use it: the generation-unavailable notice, the feedback dialog error, the GDD panel error, the procedural-animation default-bones warning, and the engine init overlay's timeout and failure boxes. Notice colours now come from the shared theme tokens, so light/dark theming is handled once instead of per hardcoded amber/yellow Tailwind literal.

### Patch Changes

- [#10003](https://github.com/Tristan578/project-forge/pull/10003) [`27d81a8`](https://github.com/Tristan578/project-forge/commit/27d81a838d1aede06cd5ef58606f86745b782d55) Thanks [@dependabot](https://github.com/apps/dependabot)! - Update the editor and documentation site to React 19.3.0 and Next.js 16.3.5, keeping React DOM and Next.js tooling aligned. Refresh the editor's docking, icons, translations and S3 dependencies, and the documentation site's Fumadocs dependencies. The shared UI package now requires React 19.3 or later within React 19.

- [#10081](https://github.com/Tristan578/project-forge/pull/10081) [`5b2029b`](https://github.com/Tristan578/project-forge/commit/5b2029b37cde2bef16abc31e8ae00129d4ccdbf6) Thanks [@Tristan578](https://github.com/Tristan578)! - Add a status-colour semantic (healthy / degraded / down / unknown) to the design-system tokens as verified foreground/background pairs, and migrate the public `/health` dashboard onto them. The overall-status banner and its Refresh/Retry actions now use `@spawnforge/ui` tokens and the `Button` primitive instead of raw Tailwind palette literals, so the status page participates in the theme system and both action buttons show a visible keyboard focus ring (WCAG 2.4.7). Every status variant clears the WCAG AA 4.5:1 contrast floor for normal text (healthy 5.02:1, degraded 10.95:1, down 6.47:1, unknown 7.73:1), verified per theme in the token tests.

- [#10078](https://github.com/Tristan578/project-forge/pull/10078) [`9787c0c`](https://github.com/Tristan578/project-forge/commit/9787c0cc449fb07ed0e73fc646637000031f4521) Thanks [@Tristan578](https://github.com/Tristan578)! - Reverb Zone and Audio inspector controls now use the shared `@spawnforge/ui` design-library composites instead of bespoke local copies. The slider, vector-axis and numeric-field controls each carry a properly associated accessible name, so screen-reader users hear a distinct label for every control. A new `NumberField` composite replaces the duplicated `NumberInputRow` that both inspectors carried verbatim, and the Audio inspector's Loop, Spatial and Autoplay checkboxes gain the same label association the Reverb Zone inspector already had.

- [#10051](https://github.com/Tristan578/project-forge/pull/10051) [`841f21a`](https://github.com/Tristan578/project-forge/commit/841f21ab7a5b90ffce197864e3220425ae7d82fc) Thanks [@Tristan578](https://github.com/Tristan578)! - Preserve saved prefab link metadata and its source definitions during scene changes, saves, recovery, and game export. Reject cyclic or incomplete imported graphs before writing them, retain stable nesting ids on scene reopen, and keep rejected scene switches attached to the original scene.
  
  The Prefabs panel can inspect saved links and overridden field names. Linked scene placement, nested entity creation, and propagation are unavailable; their controls are disabled and compatibility commands return explicit errors. Existing flat prefab copies remain available. This change does not complete the linked prefab engine workflow tracked in [#9811](https://github.com/Tristan578/project-forge/issues/9811).
  
  Tab navigation now moves keyboard focus with Arrow, Home, and End keys while preventing page scrolling. The Prefabs panel uses labeled, themed controls with readable tab states and mobile touch targets.
  
  A scene the editor cannot open now says so instead of leaving a blank editor, and every save path — manual save, cloud save, autosave, checkpoints, scene switch and duplicate, and game export — refuses while that rejection stands, so an empty editor can no longer overwrite the project it failed to open.

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
