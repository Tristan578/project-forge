# @spawnforge/ui

SpawnForge design system — shared primitives, design tokens, and theme ambient effects.

## Exports

### Primitives

Headless, unstyled base components: `Accordion`, `Avatar`, `Badge`, `Button`, `Card`, `Checkbox`, `Dialog`, `Input`, `Label`, `Popover`, `Progress`, `ScrollArea`, `Select`, `Separator`, `Skeleton`, `Switch`, `Tabs`, `Textarea`, `Toast`, `Tooltip`.

### Design Tokens

Import tokens from `@spawnforge/ui/tokens`:

```ts
import { COLORS, SPACING, RADIUS, TYPOGRAPHY, Z_INDEX, THEMES } from '@spawnforge/ui/tokens';
```

Token shape:

- `COLORS` — semantic palette keyed by theme name (`ember`, `ice`, `leaf`, `rust`, `mech`, `light`, `dark`)
- `SPACING` — 4 px-grid scale (`SPACING[1]` = 4 px, `SPACING[2]` = 8 px, …)
- `RADIUS` — border-radius constants (`sm`, `md`, `lg`, `full`)
- `TYPOGRAPHY` — font size, weight, and line-height scale
- `Z_INDEX` — named z-index slots (`Z_INDEX.effects = 5`, `Z_INDEX.modal = 50`, …)
- `THEMES` — `ThemeName` union type and display metadata per theme

### Effects

Theme ambient visual effects (CSS animations):

```tsx
import dynamic from 'next/dynamic';
const ThemeAmbient = dynamic(() => import('@spawnforge/ui').then(m => m.ThemeAmbient), { ssr: false });
```

`ThemeAmbient` reads `data-sf-theme` and `data-sf-effects` from `document.documentElement` via `MutationObserver` and renders the matching effect component. The `dark` theme has no effect. Must be imported with `next/dynamic({ ssr: false })`.

## Applying Themes

Set the `data-sf-theme` attribute on `<html>` to switch theme:

```ts
document.documentElement.setAttribute('data-sf-theme', 'ember');
```

Enable effects:

```ts
document.documentElement.setAttribute('data-sf-effects', 'true');
```

Or use the `useTheme` hook:

```ts
import { useTheme } from '@spawnforge/ui';
const { theme, setTheme } = useTheme();
```

## Running Tests

```bash
cd packages/ui
npm run test        # vitest run (unit tests for all primitives, hooks, utils)
npm run test:watch  # vitest watch mode
```

Tests are co-located with components in `__tests__/` directories. The vitest config uses jsdom for component tests.

## Building

```bash
cd packages/ui
npm run build   # Compiles to dist/
```
