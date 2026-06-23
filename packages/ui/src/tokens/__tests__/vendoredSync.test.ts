import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard for #8742 / the Sentry vendored-staleness finding.
 *
 * apps/design (Storybook) consumes @spawnforge/ui via `file:./vendored/spawnforge-ui`,
 * whose package.json `exports` resolve to the FLAT compiled files (./tokens/...,
 * ./utils/...). Those files are a build artifact of packages/ui/src and must be kept
 * in sync via apps/design/scripts/sync-vendored-ui.sh. The old sync script wrote to a
 * `dist/` subdir nothing imports, so the flat files silently drifted from source —
 * shipping a Storybook that lacked new tokens (e.g. --sf-accent-active) and an old
 * themeValidator that stripped them from custom themes.
 *
 * This test fails the moment the vendored token surface drifts behind source, forcing
 * a re-run of the sync script before the PR can merge. vitest's cwd is packages/ui.
 */

const REPO_ROOT = resolve(process.cwd(), '..', '..');
const SOURCE_VALIDATOR = resolve(process.cwd(), 'src/utils/themeValidator.ts');
const VENDORED_VALIDATOR = resolve(
  REPO_ROOT,
  'apps/design/vendored/spawnforge-ui/utils/themeValidator.js',
);
const VENDORED_THEMES = resolve(
  REPO_ROOT,
  'apps/design/vendored/spawnforge-ui/tokens/themes.js',
);

/** Every distinct `--sf-*` custom-property name referenced in a file. */
function sfTokens(contents: string): Set<string> {
  return new Set(contents.match(/--sf-[a-z-]+/g) ?? []);
}

describe('vendored @spawnforge/ui is in sync with source tokens', () => {
  it('vendored themeValidator knows every --sf-* token the source validator does', () => {
    const sourceTokens = sfTokens(readFileSync(SOURCE_VALIDATOR, 'utf8'));
    const vendoredTokens = sfTokens(readFileSync(VENDORED_VALIDATOR, 'utf8'));

    expect(sourceTokens.size).toBeGreaterThan(0);
    const missing = [...sourceTokens].filter((t) => !vendoredTokens.has(t));
    expect(
      missing,
      `Vendored themeValidator is STALE — missing tokens: ${missing.join(', ')}. ` +
        'Re-run: bash apps/design/scripts/sync-vendored-ui.sh',
    ).toEqual([]);
  });

  it('vendored themes carry the WCAG --sf-accent-active token (#8742)', () => {
    const validator = sfTokens(readFileSync(VENDORED_VALIDATOR, 'utf8'));
    const themes = readFileSync(VENDORED_THEMES, 'utf8');
    expect(validator.has('--sf-accent-active')).toBe(true);
    expect(themes).toContain('--sf-accent-active');
  });
});
