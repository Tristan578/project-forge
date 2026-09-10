#!/usr/bin/env node
// Node is a SpawnForge prerequisite; Python executable names differ by OS.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./taskboard_runtime.py', import.meta.url));
const candidates = [...new Set([process.env.PYTHON, 'python3', 'python', 'py'].filter(Boolean))];
let python;
for (const candidate of candidates) {
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (probe.status === 0 && /Python 3\./.test(probe.stdout + probe.stderr)) { python = candidate; break; }
}
if (!python) {
  console.error('Taskboard requires Python 3 on PATH, or set PYTHON to its executable.');
  process.exit(1);
}
const result = spawnSync(python, [script, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
