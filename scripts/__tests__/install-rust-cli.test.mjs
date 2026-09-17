import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const root = resolve(import.meta.dirname, '../..');
const locked = readFileSync(join(root, 'engine/Cargo.lock'), 'utf8').match(/name = "wasm-bindgen"\s+version = "([^"]+)"/)[1];
const cases = [['cargo-audit', '0.22.2', 'install-cargo-audit.sh'], ['wasm-bindgen', locked, 'install-wasm-bindgen-cli.sh']];
for (const [binary, expected, script] of cases) {
  for (const state of ['cold', 'valid', 'wrong', 'corrupt']) {
    test(binary + ' repairs ' + state + ' cache and verifies exact executable', () => {
      const dir = mkdtempSync(join(tmpdir(), 'forge rust cli '));
      const slash = p => p.replaceAll('\\', '/');
      const log = join(dir, 'install.log');
      const executable = join(dir, binary);
      const cargo = join(dir, 'cargo');
      writeFileSync(cargo, [
        '#!/usr/bin/env bash', 'set -euo pipefail',
        'if [[ "$1" == audit ]]; then exec "$CARGO_TEST_BIN/cargo-audit" --version; fi',
        '[[ "$1" == install ]]', 'printf "%s\\n" "$*" >> "$CARGO_TEST_LOG"',
        'case "$*" in',
        '  *cargo-audit*) tool=cargo-audit; expected=0.22.2 ;;',
        '  *wasm-bindgen-cli*) tool=wasm-bindgen; expected="$CARGO_TEST_EXPECTED" ;;',
        '  *) exit 7 ;;', 'esac',
        'printf "#!/usr/bin/env bash\\necho \'%s %s\'\\n" "$tool" "$expected" > "$CARGO_TEST_BIN/$tool"',
        'chmod +x "$CARGO_TEST_BIN/$tool"',
      ].join('\n') + '\n');
      chmodSync(cargo, 0o755);
      if (state !== 'cold') {
        const prefix = binary === 'cargo-audit' ? 'cargo-audit ' : 'wasm-bindgen ';
        writeFileSync(executable, state === 'corrupt' ? '#!/usr/bin/env bash\nexit 12\n' : '#!/usr/bin/env bash\necho "' + prefix + (state === 'valid' ? expected : '0.0.1') + '"\n');
        chmodSync(executable, 0o755);
      }
      try {
        execFileSync(bash, [join(root, 'scripts', script)], { cwd: root, env: { ...process.env, PATH: slash(dir) + (process.platform === 'win32' ? ';' : ':') + process.env.PATH, CARGO_TEST_BIN: slash(dir), CARGO_TEST_LOG: slash(log), CARGO_TEST_EXPECTED: locked }, timeout: 30000, stdio: 'pipe' });
        assert.equal(existsSync(log), state !== 'valid');
        if (state !== 'valid') {
          const installed = readFileSync(log, 'utf8');
          assert.match(installed, /install --force --locked/);
          assert.ok(installed.includes('--version ' + expected));
          assert.equal(installed.trim().split('\n').length, 1);
        }
        const output = execFileSync(bash, [executable, '--version'], { encoding: 'utf8' }).trim();
        assert.equal(output, binary === 'cargo-audit' ? 'cargo-audit ' + expected : 'wasm-bindgen ' + expected);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
}
test('invalid lockfile refuses installation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge invalid lock '));
  try {
    const lock = join(dir, 'Cargo.lock'); writeFileSync(lock, 'name = "unrelated"\nversion = "1.0.0"\n');
    assert.throws(() => execFileSync(bash, [join(root, 'scripts/install-wasm-bindgen-cli.sh'), lock], { cwd: root, timeout: 30000, stdio: 'pipe' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
