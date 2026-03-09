/**
 * Fixture recording utility — run against real Aseprite to capture responses.
 *
 * Usage:
 *   ASEPRITE_PATH=/path/to/aseprite npx tsx src/lib/bridges/__tests__/record-fixtures.ts
 *
 * Creates/updates fixture files in __tests__/fixtures/ with real Aseprite output.
 * These fixtures are used by unit tests in CI where Aseprite is not available.
 */

import { execFile } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const ASEPRITE_BIN = process.env.ASEPRITE_PATH
  || '/Applications/Aseprite.app/Contents/MacOS/aseprite';

interface FixtureRecord {
  operation: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  timestamp: string;
  asepriteVersion: string;
}

function runAndCapture(args: string[], operation: string): Promise<FixtureRecord> {
  return new Promise((resolve) => {
    execFile(ASEPRITE_BIN, args, { timeout: 15000 }, (err, stdout, stderr) => {
      resolve({
        operation,
        args,
        exitCode: err ? 1 : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        timestamp: new Date().toISOString(),
        asepriteVersion: '',
      });
    });
  });
}

async function main() {
  if (!existsSync(FIXTURES_DIR)) {
    mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  console.log('Recording Aseprite fixtures...');
  console.log(`Binary: ${ASEPRITE_BIN}`);

  // 1. Version check
  const version = await runAndCapture(['--version'], 'version');
  version.asepriteVersion = version.stdout.trim();
  writeFileSync(join(FIXTURES_DIR, 'version.json'), JSON.stringify(version, null, 2));
  console.log(`  Recorded: version (${version.stdout.trim()})`);

  // 2. Create sprite
  const createScript = 'local spr = Sprite(32, 32)\nspr:saveAs("/tmp/fixture_create.png")\nprint("OK:" .. spr.width .. "x" .. spr.height)\napp.exit()';
  writeFileSync('/tmp/fixture_create.lua', createScript);
  const create = await runAndCapture(['--batch', '--script', '/tmp/fixture_create.lua'], 'createSprite');
  writeFileSync(join(FIXTURES_DIR, 'createSprite.json'), JSON.stringify(create, null, 2));
  console.log(`  Recorded: createSprite (exit: ${create.exitCode})`);

  // 3. Bad script (error case)
  writeFileSync('/tmp/fixture_bad.lua', 'this is not valid lua');
  const bad = await runAndCapture(['--batch', '--script', '/tmp/fixture_bad.lua'], 'badScript');
  writeFileSync(join(FIXTURES_DIR, 'badScript.json'), JSON.stringify(bad, null, 2));
  console.log(`  Recorded: badScript (exit: ${bad.exitCode})`);

  // 4. Create animation
  const animScript = 'local spr = Sprite(32, 32)\nfor i = 2, 4 do spr:newFrame() end\nfor i = 1, #spr.frames do spr.frames[i].duration = 0.1 end\nspr:saveAs("/tmp/fixture_anim.png")\nprint("OK:animation:4frames")\napp.exit()';
  writeFileSync('/tmp/fixture_anim.lua', animScript);
  const anim = await runAndCapture(['--batch', '--script', '/tmp/fixture_anim.lua'], 'createAnimation');
  writeFileSync(join(FIXTURES_DIR, 'createAnimation.json'), JSON.stringify(anim, null, 2));
  console.log(`  Recorded: createAnimation (exit: ${anim.exitCode})`);

  console.log(`\nAll fixtures saved to ${FIXTURES_DIR}`);
}

main().catch(console.error);
