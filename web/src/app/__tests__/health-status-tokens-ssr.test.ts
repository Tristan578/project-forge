/**
 * SSR contract guard for the status-colour semantic (#10093 / #9108).
 *
 * The public `/health` page is themeless: `src/app/layout.tsx` mounts no
 * `useTheme`, so `applyThemeTokens` never writes the `--sf-status-*` custom
 * properties on that surface. The ONLY thing that makes its overall banner
 * render a coloured band during an incident is the static `:root` default in
 * `src/app/globals.css`. Delete those declarations and every existing gate
 * stays green while the banner fails open — `background-color:
 * var(--sf-status-healthy-bg)` becomes invalid-at-computed-value-time and the
 * band loses its background, so "All Systems Operational" turns
 * indistinguishable from the page.
 *
 * `packages/ui/src/tokens/themes.ts` is the single source of truth for these
 * values (the shared `STATUS_COLORS` block). This test asserts the SSR `:root`
 * default cannot drift from — or disappear behind — that source. It reads both
 * files as text (no `@spawnforge/ui` import) so it does not depend on the ui
 * package being built to `dist/` in CI, and runs identically in the node and
 * jsdom vitest projects. Sibling filesystem contracts: `dockviewCssContract`,
 * `public-scroll`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const GLOBALS_CSS = resolve(process.cwd(), 'src/app/globals.css');
const THEMES_TS = resolve(process.cwd(), '..', 'packages/ui/src/tokens/themes.ts');

/**
 * The `--sf-status-*` name→value pairs authored in themes.ts. They live once in
 * `STATUS_COLORS` as `'--sf-status-...': '#rrggbb'`, so a single lowercase-hex
 * regex captures the source of truth without importing the (built) package.
 */
function statusTokensFromSource(ts: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, key, value] of ts.matchAll(
    /'(--sf-status-[a-z-]+)'\s*:\s*'(#[0-9a-fA-F]{3,8})'/g,
  )) {
    map.set(key, value.toLowerCase());
  }
  return map;
}

/**
 * Declarations of the first top-level `:root { … }` block in globals.css — the
 * SSR default. `:root` carries no nested braces, so a single non-`}` capture is
 * exact; comments are stripped first so a commented-out declaration cannot
 * masquerade as a real one.
 */
function rootBlockDeclarations(css: string): Map<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const match = withoutComments.match(/:root\s*\{([^}]*)\}/);
  const decls = new Map<string, string>();
  if (!match) return decls;
  for (const decl of match[1].split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim();
    if (!prop.startsWith('--')) continue;
    decls.set(prop, decl.slice(idx + 1).trim().toLowerCase());
  }
  return decls;
}

describe('/health SSR status-token contract (#10093 / #9108)', () => {
  const sourceStatus = statusTokensFromSource(readFileSync(THEMES_TS, 'utf8'));
  const rootDecls = rootBlockDeclarations(readFileSync(GLOBALS_CSS, 'utf8'));

  it('reads the eight status tokens from the themes.ts source (guard is non-vacuous)', () => {
    // Four healthy/degraded/down/unknown × bg/fg pairs. A drop below eight means
    // the regex stopped matching the source — the it.each below would then guard
    // nothing.
    expect(sourceStatus.size).toBe(8);
  });

  it('locates the top-level :root block carrying SpawnForge SSR defaults', () => {
    // If this block ever fails to parse, every per-token assertion goes vacuous.
    expect(rootDecls.size).toBeGreaterThan(0);
    expect(rootDecls.has('--sf-bg-app')).toBe(true);
  });

  it.each([...sourceStatus])(
    'globals.css :root declares %s = %s (SSR default matches the TS token source)',
    (key, value) => {
      expect(
        rootDecls.get(key),
        `${key} is missing from or drifted in the globals.css :root SSR default — ` +
          `the themeless /health banner renders it invalid-at-computed-value-time`,
      ).toBe(value);
    },
  );
});
