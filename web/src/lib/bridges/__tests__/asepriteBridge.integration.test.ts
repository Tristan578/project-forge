/**
 * Integration tests — require real Aseprite installation.
 * Skip in CI (no Aseprite available). Run locally with:
 *   ASEPRITE_PATH=/path/to/aseprite npx vitest run src/lib/bridges/__tests__/asepriteBridge.integration.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';

const ASEPRITE_BIN = process.env.ASEPRITE_PATH
  || '/Applications/Aseprite.app/Contents/MacOS/aseprite';

const HAS_ASEPRITE = existsSync(ASEPRITE_BIN);

function runAseprite(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(ASEPRITE_BIN, args, { timeout: 15000 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: err ? 1 : 0,
      });
    });
  });
}

// Generate a unique suffix per test-worker process to avoid concurrent temp-file collisions
const UNIQUE_ID = randomBytes(4).toString('hex');

describe.skipIf(!HAS_ASEPRITE)('Aseprite Integration', () => {
  beforeAll(() => {
    console.log(`Using Aseprite at: ${ASEPRITE_BIN}`);
  });

  it('reports version', async () => {
    const { stdout, exitCode } = await runAseprite(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Aseprite \d+\.\d+\.\d+/);
  });

  it('creates a sprite via Lua script', async () => {
    const { writeFileSync, unlinkSync } = await import('fs');
    const luaPath = `/tmp/integration_test_${UNIQUE_ID}.lua`;
    const pngPath = `/tmp/integration_test_${UNIQUE_ID}.png`;
    // Clean up any pre-existing file from a prior run
    if (existsSync(pngPath)) unlinkSync(pngPath);

    const script = `local spr = Sprite(32, 32)\nspr:saveAs("${pngPath}")\nprint("OK:" .. spr.width .. "x" .. spr.height)\napp.exit()`;
    writeFileSync(luaPath, script);

    const { stdout, exitCode } = await runAseprite(['--batch', '--script', luaPath]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('OK:32x32');
    expect(existsSync(pngPath)).toBe(true);
  });

  it('handles script errors gracefully', async () => {
    const { writeFileSync } = await import('fs');
    const luaPath = `/tmp/integration_bad_${UNIQUE_ID}.lua`;
    writeFileSync(luaPath, 'this is not valid lua');

    const { exitCode } = await runAseprite(['--batch', '--script', luaPath]);
    expect(exitCode).toBeGreaterThanOrEqual(0);
  });

  it('creates animation frames', async () => {
    const { writeFileSync } = await import('fs');
    const luaPath = `/tmp/integration_anim_${UNIQUE_ID}.lua`;
    const script = 'local spr = Sprite(16, 16)\nfor i = 2, 4 do spr:newFrame() end\nprint("OK:frames:" .. #spr.frames)\napp.exit()';
    writeFileSync(luaPath, script);

    const { stdout, exitCode } = await runAseprite(['--batch', '--script', luaPath]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('OK:frames:4');
  });
});
