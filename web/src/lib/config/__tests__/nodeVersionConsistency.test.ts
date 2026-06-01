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
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// HERE = <repo>/web/src/lib/config/__tests__ → up 5 levels to repo root.
const REPO_ROOT = path.resolve(HERE, '../../../../..');

/** Canonical Node major the whole monorepo must agree on. */
const CANONICAL_MAJOR = 24;
/** Canonical `engines.node` range string every workspace must declare. */
const CANONICAL_ENGINES = '>=24 <25';

/** Every workspace package.json that must declare `engines.node`. */
const WORKSPACES = [
  'package.json',
  'web/package.json',
  'mcp-server/package.json',
  'apps/docs/package.json',
  'apps/design/package.json',
  'packages/ui/package.json',
];

function readRepoFile(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function majorOf(versionish: string): number {
  const m = versionish.trim().match(/(\d+)/);
  expect(m, `expected a numeric major in "${versionish}"`).not.toBeNull();
  return Number(m![1]);
}

function workflowFiles(): string[] {
  const dir = path.join(REPO_ROOT, '.github', 'workflows');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
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
    for (const ws of WORKSPACES) {
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
});
