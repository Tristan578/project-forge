# @spawnforge/ui

## 0.2.0

### Minor Changes

- [#8163](https://github.com/Tristan578/project-forge/pull/8163) [`d9e0f22`](https://github.com/Tristan578/project-forge/commit/d9e0f22dddde2b733f0792ffef1077fa6932306b) Thanks [@Tristan578](https://github.com/Tristan578)! - Adopt Changesets for automated versioning, changelog generation, and release management across the monorepo.

- [#8166](https://github.com/Tristan578/project-forge/pull/8166) [`93caaa9`](https://github.com/Tristan578/project-forge/commit/93caaa9519a8c9ace393baf3b4d6f088e4a02016) Thanks [@Tristan578](https://github.com/Tristan578)! - Add axe-core accessibility testing for all 20 primitives across 7 themes, Chromatic visual regression CI, and token reference stories (Colors, Spacing, Typography, Radius)

- [#8167](https://github.com/Tristan578/project-forge/pull/8167) [`0b87885`](https://github.com/Tristan578/project-forge/commit/0b878859a7ed59a399aa14c23d783c2e3bd5e9aa) Thanks [@Tristan578](https://github.com/Tristan578)! - Add 7 remaining composites to complete the Tier 2 component library: Vec3Input, SliderInput, ColorPicker, TreeView, PropertyGrid, CollapsibleSection, KeyboardShortcutsPanel

### Patch Changes

- [#8324](https://github.com/Tristan578/project-forge/pull/8324) [`bf3bc88`](https://github.com/Tristan578/project-forge/commit/bf3bc889f97d10ed00567d060acc96b869e73d13) Thanks [@Tristan578](https://github.com/Tristan578)! - Use --sf-border-strong on interactive primitives (Avatar, Badge, Button outline, Input, Checkbox, Switch, Textarea, Select) and SettingsPanel checkbox for better border contrast across all themes. Add CI contrast audit (WCAG 1.4.11) to prevent silent regression. Fix light theme --sf-warning contrast (#ca8a04 -> #b8790a, 3.64:1).

- [#8330](https://github.com/Tristan578/project-forge/pull/8330) [`b17dfbc`](https://github.com/Tristan578/project-forge/commit/b17dfbcacdf5ab08abf00991fe30449ee6dd7af7) Thanks [@Tristan578](https://github.com/Tristan578)! - UX/DX audit fixes: tune accent injection percentages, remove duplicate Dialog Escape handler, add Popover aria-label prop, fix Select wrapper width, fix Tabs panel mounting, fix Avatar test fixture, strengthen theme personality across 20 primitives
