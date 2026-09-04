import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Aseprite Vercel function trace', () => {
  it('excludes public engine bundles without excluding them from deployment', () => {
    const config = readFileSync(resolve(process.cwd(), 'next.config.ts'), 'utf8');
    const deployIgnore = readFileSync(resolve(process.cwd(), '../.vercelignore'), 'utf8');

    expect(config).toContain("'/api/bridges/aseprite/execute': ['./public/engine-pkg-*/**']");
    expect(deployIgnore).not.toMatch(/^web\/public\/engine-pkg-/m);
  });
});
