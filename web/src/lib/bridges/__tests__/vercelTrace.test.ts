import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Aseprite Vercel function trace', () => {
  it('excludes public engine bundles without excluding them from deployment', () => {
    const config = readFileSync(resolve(process.cwd(), 'next.config.ts'), 'utf8');
    const deployIgnore = readFileSync(resolve(process.cwd(), '../.vercelignore'), 'utf8');

    // The exclusion moved from a per-route entry to the wildcard '*' key in
    // #10069 (next-config-tracing.test.ts pins the full contract) because
    // /api/bridges/aseprite/status shares the same bridge manager and hit the
    // same 250 MB trace limit that /execute alone used to guard against.
    expect(config).toContain("'*': ['./public/engine-pkg-*/**']");
    expect(deployIgnore).not.toMatch(/^web\/public\/engine-pkg-/m);
  });
});
