import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');
const temporaryRepos: string[] = [];

afterEach(() => {
  for (const repo of temporaryRepos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'observatory-cli-'));
  temporaryRepos.push(repo);
  const tool = join(repo, 'tools', 'observatory');
  const out = join(repo, 'reports');
  mkdirSync(tool, { recursive: true });
  mkdirSync(out);
  copyFileSync(join(packageDir, 'scan.ts'), join(tool, 'scan.ts'));
  writeFileSync(join(tool, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(tool, 'capabilityRules.ts'), [
    'export const CAPABILITY_RULES = [{ capabilityId: "current", domain: "test",',
    '  confidence: "reviewed", own: ["src/owned/**"], primaryOwner: "src/owned/a file.ts" }];',
    'export const EXCLUSION_RULES = [{ category: "generated", reason: "Fixture output", patterns: ["generated/**"] }];',
    'export const PLANNED_CAPABILITIES = [];',
    'export const COVERED_SCOPES = ["src/"];',
    'export const COVERAGE_SCOPE = { covered: ["test"], notYetCovered: ["other"] };',
    '',
  ].join('\n'));
  writeFileSync(join(tool, 'aliases.json'), JSON.stringify({ aliases: [{ from: 'old', to: 'current' }] }));
  execFileSync('git', ['init', '--quiet'], { cwd: repo });
  for (const name of ['src/owned/a file.ts', 'src/new.ts', 'generated/output.ts', 'other/out.ts', 'src/untracked.ts']) {
    const file = join(repo, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '// fixture\n');
  }
  execFileSync('git', ['add', '--', 'src/owned/a file.ts', 'src/new.ts', 'generated/output.ts', 'other/out.ts'], { cwd: repo });
  return { repo, tool, out };
}

function runCli(f: ReturnType<typeof fixture>, outDir = f.out) {
  return spawnSync(process.execPath, ['--import', tsxLoader, join(f.tool, 'scan.ts')], {
    cwd: f.repo,
    env: { ...process.env, OBSERVATORY_OUT_DIR: outDir },
    encoding: 'utf8',
    timeout: 15_000,
  });
}

describe('observatory CLI', () => {
  it('uses the Git index, reads aliases, and writes deterministic nonempty artifacts', () => {
    const f = fixture();
    const first = runCli(f);
    expect(first.error).toBeUndefined();
    expect(first.status, first.stderr).toBe(0);
    const json = readFileSync(join(f.out, 'inventory.json'), 'utf8');
    const report = readFileSync(join(f.out, 'unmapped-report.md'), 'utf8');
    const inventory = JSON.parse(json);
    expect(inventory.schemaVersion).toBe(1);
    expect(inventory.accounting).toEqual({
      trackedTotal: 4, ownedTotal: 1, excludedTotal: 1, unmappedTotal: 1,
      notYetCoveredTotal: 1, reconciles: true,
    });
    expect(inventory.capabilities).toEqual([expect.objectContaining({
      capabilityId: 'current', primaryOwner: 'src/owned/a file.ts', members: ['src/owned/a file.ts'],
    })]);
    expect(inventory.aliases).toEqual([{ from: 'old', to: 'current' }]);
    expect(inventory.exclusions).toEqual([{ path: 'generated/output.ts', category: 'generated', reason: 'Fixture output' }]);
    expect(inventory.unmapped).toEqual(['src/new.ts']);
    expect(inventory.notYetCovered).toEqual(['other/out.ts']);
    expect(inventory.gaps).toContainEqual({ type: 'unmapped-in-covered-scope', path: 'src/new.ts' });
    expect(json).not.toContain('untracked.ts');
    expect(report).toContain('Tracked (denominator) | 4');
    expect(report).toContain('generated/output\\.ts');
    expect(report).toContain('Fixture output');
    expect(report).toContain('src/new\\.ts');
    expect(first.stdout).toContain('tracked=4 owned=1 excluded=1 unmapped=1 notYetCovered=1 reconciles=true gaps=1');
    const second = runCli(f);
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(join(f.out, 'inventory.json'), 'utf8')).toBe(json);
    expect(readFileSync(join(f.out, 'unmapped-report.md'), 'utf8')).toBe(report);
  });

  it('fails when Git cannot identify the repository', () => {
    const f = fixture();
    rmSync(join(f.repo, '.git'), { recursive: true, force: true });
    const result = runCli(f);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('observatory:');
    expect(result.stderr).toContain('git rev-parse');
  });

  it.each(['missing', 'malformed'])('fails when the alias file is %s', (mode) => {
    const f = fixture();
    const aliases = join(f.tool, 'aliases.json');
    if (mode === 'missing') rmSync(aliases);
    else writeFileSync(aliases, '{ invalid json');
    const result = runCli(f);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('observatory:');
    expect(result.stdout).not.toContain('observatory: wrote');
  });

  it('fails when the requested output directory does not exist', () => {
    const f = fixture();
    const result = runCli(f, join(f.out, 'missing'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ENOENT');
    expect(result.stdout).not.toContain('observatory: wrote');
  });

  it('keeps default generated artifacts out of the tracked denominator', () => {
    const names = ['inventory.json', 'unmapped-report.md'];
    const result = spawnSync('git', ['check-ignore', '--', ...names], {
      cwd: packageDir, encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/)).toEqual(names);
  });
});
