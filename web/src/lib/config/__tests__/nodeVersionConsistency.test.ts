/**
 * Node version consistency guard (PF-841, #8665).
 *
 * The Node runtime version is declared in many places across the monorepo:
 *   - `.node-version` (read by Vercel + `actions/setup-node` node-version-file)
 *   - `.nvmrc` (read by `nvm`)
 *   - `engines.node` in every workspace `package.json`
 *   - `node-version` inputs to `actions/setup-node` in every GitHub workflow
 *
 * When these drift, CI runs on a different Node than Vercel builds on, and
 * local `nvm use` lands somewhere else again — the class of bug that produced
 * "works in CI, fails on Vercel" footguns. This guard asserts a single
 * canonical major across all of them so the drift can never silently return.
 *
 * Mechanism (the chosen alignment, see PR for #8665):
 *   - `.node-version` is the single source of truth (major 24).
 *   - `.nvmrc` agrees (major 24).
 *   - Every `actions/setup-node` step uses `node-version-file: .node-version`
 *     rather than a hardcoded `node-version:` literal, so there is exactly one
 *     place to bump.
 *   - Every workspace `package.json` pins `engines.node` to the canonical range.
 *
 * Scope: authored workflows only — generated gh-aw `*.lock.yml` files are
 * exempt (see workflowFiles() below for why), and the exemption is itself
 * guarded: every exempted lock must carry the gh-aw generated-file marker.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// HERE = <repo>/web/src/lib/config/__tests__ → up 5 levels to repo root.
const REPO_ROOT = path.resolve(HERE, '../../../../..');

/** Canonical Node major the whole monorepo must agree on. */
const CANONICAL_MAJOR = 24;
/** Canonical `engines.node` range string every workspace must declare. */
const CANONICAL_ENGINES = '>=24.15 <25';

function readRepoFile(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

/**
 * Discover every npm workspace package.json the monorepo declares, derived from
 * the root `package.json` `workspaces` field (this repo uses `dir/*` globs and
 * literal dirs) plus the root package.json itself. Deriving instead of
 * hardcoding means the guard self-heals: a workspace added later is checked
 * automatically, closing the "new package escapes the engines check" gap.
 */
function discoverWorkspaces(): string[] {
  const rootPkg = JSON.parse(readRepoFile('package.json')) as { workspaces?: string[] };
  const dirs = new Set<string>(['.']); // root package.json always counts
  for (const pattern of rootPkg.workspaces ?? []) {
    if (pattern.endsWith('/*')) {
      const parent = pattern.slice(0, -2);
      const parentAbs = path.join(REPO_ROOT, parent);
      if (!existsSync(parentAbs)) continue;
      for (const entry of readdirSync(parentAbs, { withFileTypes: true })) {
        if (entry.isDirectory() && existsSync(path.join(parentAbs, entry.name, 'package.json'))) {
          dirs.add(`${parent}/${entry.name}`);
        }
      }
    } else if (existsSync(path.join(REPO_ROOT, pattern, 'package.json'))) {
      dirs.add(pattern);
    }
  }
  return [...dirs].map((d) => (d === '.' ? 'package.json' : `${d}/package.json`));
}

function majorOf(versionish: string): number {
  const m = versionish.trim().match(/(\d+)/);
  expect(m, `expected a numeric major in "${versionish}"`).not.toBeNull();
  return Number(m![1]);
}

/**
 * Authored workflows only. Generated gh-aw `*.lock.yml` files are exempt:
 * they must stay byte-identical to `gh aw compile` output (the gh-aw Lock
 * Sync gate recompiles and fails the PR on any diff), and the v0.77.5+
 * compiler injects its own `actions/setup-node` step — the agent runtime
 * that installs the Copilot CLI — with a literal `node-version`. The
 * compiler's `runtimes:` frontmatter override accepts only literal versions
 * (no version-file mode), so the literal cannot be repointed at
 * `.node-version`; nor should it be — the agent runtime is pinned to the
 * Node the gh-aw compiler is tested against, not the app toolchain this
 * guard keeps consistent. The exemption is verified below: every excluded
 * lock must carry the gh-aw generated-file marker.
 */
function workflowFiles(): string[] {
  const dir = path.join(REPO_ROOT, '.github', 'workflows');
  return readdirSync(dir)
    .filter((f) => (f.endsWith('.yml') || f.endsWith('.yaml')) && !f.endsWith('.lock.yml'))
    .map((f) => path.join('.github', 'workflows', f));
}

function generatedLockFiles(): string[] {
  const dir = path.join(REPO_ROOT, '.github', 'workflows');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.lock.yml'))
    .map((f) => path.join('.github', 'workflows', f));
}

describe('Node version consistency (PF-841)', () => {
  it('.node-version pins the canonical major', () => {
    expect(majorOf(readRepoFile('.node-version'))).toBe(CANONICAL_MAJOR);
  });

  it('.nvmrc agrees with the canonical major', () => {
    expect(majorOf(readRepoFile('.nvmrc'))).toBe(CANONICAL_MAJOR);
  });

  it('every workspace declares the canonical engines.node range', () => {
    const workspaces = discoverWorkspaces();
    // Floor: discovery must surface the known workspaces. Without this, a broken
    // glob expansion returning an empty set would make the engines loop below
    // pass vacuously. The completeness check itself is dynamic (any new
    // workspace is picked up automatically); this floor only guards discovery.
    expect(workspaces).toEqual(
      expect.arrayContaining([
        'package.json',
        'web/package.json',
        'mcp-server/package.json',
        'apps/docs/package.json',
        'apps/design/package.json',
        'packages/ui/package.json',
      ]),
    );
    for (const ws of workspaces) {
      const pkg = JSON.parse(readRepoFile(ws)) as { engines?: { node?: string } };
      expect(pkg.engines?.node, `${ws} must declare engines.node`).toBe(CANONICAL_ENGINES);
    }
  });

  it('no workflow hardcodes a node-version literal', () => {
    const offenders: string[] = [];
    for (const wf of workflowFiles()) {
      const lines = readRepoFile(wf).split('\n');
      lines.forEach((line, i) => {
        // Bare `node-version:` (with a value) is forbidden; `node-version-file:`
        // is the sanctioned form and must not be flagged.
        if (/^\s*node-version:\s*\S/.test(line) && !/node-version-file:/.test(line)) {
          offenders.push(`${wf}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders, `hardcoded node-version literals found:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('every actions/setup-node step pins node-version-file: .node-version', () => {
    for (const wf of workflowFiles()) {
      const content = readRepoFile(wf);
      const setupNodeSteps = (content.match(/actions\/setup-node/g) ?? []).length;
      const fileRefs = (content.match(/node-version-file:\s*\.node-version\b/g) ?? []).length;
      expect(
        fileRefs,
        `${wf}: ${setupNodeSteps} setup-node step(s) but ${fileRefs} node-version-file ref(s)`,
      ).toBe(setupNodeSteps);
    }
  });

  it('every workflow exempted as a generated gh-aw lock really is one', () => {
    const locks = generatedLockFiles();
    // Floor: the exemption is live (this repo carries gh-aw locks). If the
    // locks ever go away, delete generatedLockFiles() and this test together.
    expect(locks.length).toBeGreaterThanOrEqual(1);
    for (const lock of locks) {
      expect(
        readRepoFile(lock).slice(0, 4096),
        `${lock} is exempt from the node-version guard as a generated gh-aw lock, ` +
          `but lacks the gh-aw-metadata marker — an authored workflow must not ` +
          `hide behind the .lock.yml suffix`,
      ).toContain('gh-aw-metadata');
    }
  });
});
