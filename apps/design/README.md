# SpawnForge Design Workbench

Storybook-based catalogue for `@spawnforge/ui` components, primitives, and theme ambient effects.

## Running Storybook

```bash
# From the monorepo root — install all dependencies:
npm ci

# Build the design system first (Storybook imports @spawnforge/ui):
cd packages/ui && npm run build

# Start Storybook dev server (port 6006):
cd apps/design && npm run storybook
```

## Vendored `@spawnforge/ui`

The design app uses a vendored copy of `@spawnforge/ui` at `vendored/spawnforge-ui/` because Vercel's per-app root directory scoping cannot access the monorepo's `packages/ui/` during remote builds.

**To update the vendored copy after changing `packages/ui/`:**

```bash
# From monorepo root:
cd packages/ui && npm run build
rm -rf apps/design/vendored/spawnforge-ui/dist
cp -r packages/ui/dist apps/design/vendored/spawnforge-ui/dist
cp packages/ui/src/effects/effects.css apps/design/vendored/spawnforge-ui/dist/effects/
cp packages/ui/src/tokens/theme.css apps/design/vendored/spawnforge-ui/dist/tokens/
```

Commit the updated `vendored/` directory alongside your `packages/ui/` changes.

## Theme Switcher

The Storybook toolbar includes a theme switcher addon. Click the palette icon in the toolbar to cycle through the seven SpawnForge themes: `dark`, `light`, `ember`, `ice`, `leaf`, `rust`, `mech`.

Themes are applied by setting `data-sf-theme` on the story container. The `ThemeAmbient` effect component is rendered in stories that explicitly include it.

## Accessibility Addon

The `@storybook/addon-a11y` addon is enabled. Open the **Accessibility** panel in the Storybook UI to see automated WCAG audit results for each story. All components must pass at the AA level.

Run a11y checks across all stories without a browser:

```bash
# Requires Storybook running on port 6006
npx storybook test --browsers chromium
```

## Chromatic

Visual regression tests run via [Chromatic](https://www.chromatic.com) on CI when `apps/design/**` or `packages/ui/**` files change.

| CI Check | Trigger |
|----------|---------|
| Storybook build + internal leak gate | Any PR touching design files |
| Chromatic visual diff (optional) | `CHROMATIC_PROJECT_TOKEN` secret set |

To run Chromatic manually:

```bash
npx chromatic --project-token=<token>
```

## Story Structure

```
apps/design/stories/
├── effects/     # ThemeAmbient effect stories (EmberGlow, IceFrost, …)
├── primitives/  # One story file per primitive component
└── internal/    # Internal-only stories (excluded from public Storybook build)
```

Stories in `stories/internal/` are gated by the `INCLUDE_INTERNAL` environment variable and must never appear in the public Storybook build. CI enforces this via the `storybook-internal-gate` job.
