# Health and documentation themes

Service cards use the shared surface and text tokens. Filled status banners keep their existing foreground/background pairs; unfilled card dots and labels use --sf-status-<status>-indicator. Built-in themes verify those indicators at a 4.5:1 contrast ratio on card surfaces, which also exceeds the 3:1 non-text floor.

Documentation buttons and search fields use @spawnforge/ui controls with visible keyboard focus. Category controls expose aria-expanded and current document links expose aria-current. Long titles wrap and mobile controls retain at least 44px height. Document text uses the primary foreground so elevated hover and code surfaces remain readable in rust and ice.

The health semanticColours unit guard rejects literal Tailwind palettes in both components. Token tests check all seven built-in themes; regenerate the flat Storybook vendored package whenever shared tokens change using apps/design/scripts/sync-vendored-ui.sh. Custom-theme imports allow the new indicator tokens, but custom colour choices remain user-defined.
