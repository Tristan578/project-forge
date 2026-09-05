/**
 * @vitest-environment node
 *
 * The manifest loader against the REAL `data/commands.json` — no mocked `fs`,
 * no fixture manifest.
 *
 * WHY THIS FILE EXISTS
 *
 * `commands.test.ts` stubs the manifest contents so it can pin the filtering
 * and sorting logic. That is the right tool for logic and the wrong tool for
 * the artifact: PR #9065 shipped a loader whose path resolved locally and did
 * not exist inside the Vercel serverless function, and its unit test could not
 * see that because it had replaced the only thing that would have noticed.
 * docs.spawnforge.ai/mcp returned 500 in production for weeks with every test
 * green (#9718; lessons 1 and 14 in `.claude/rules/lessons-learned.md`).
 *
 * The loader now owns the manifest through a static import, so the bundler
 * traces it into the function like any other module. This suite pins BOTH
 * halves of that fix:
 *
 *   1. the module really loads the real file and yields real commands, and
 *   2. the module loads it in the way that survives output file tracing.
 *
 * (2) is a source-shape assertion, and it is the one that fails first. A
 * runtime read of `../data/commands.json` passes (1) on every developer
 * machine and in every CI runner — the file is right there — which is exactly
 * how the regression stayed invisible. Nothing short of a Vercel deploy can
 * observe tracing at runtime, so the shape that tracing depends on is pinned
 * here and the deploy is verified by `scripts/post-deploy-docs-check.sh`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readCommandsByCategory, readCommandsManifest } from '../commands';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOADER_SOURCE = path.resolve(HERE, '../commands.ts');
const MANIFEST_ON_DISK = path.resolve(HERE, '../../data/commands.json');

// A command the public reference has carried since the manifest was first
// published. If it is ever renamed, update this AND the default in
// scripts/post-deploy-docs-check.sh (the deploy smoke test looks for the same
// name on the live page) in the same PR.
const KNOWN_PUBLIC_COMMAND = 'spawn_entity';
const KNOWN_CATEGORY = 'scene';

describe('the manifest loader against the real data/commands.json', () => {
  it('the in-root manifest exists where the loader imports it from', () => {
    expect(fs.existsSync(MANIFEST_ON_DISK)).toBe(true);
  });

  it('yields more than zero public commands and at least one category', async () => {
    const { publicCount, categories } = await readCommandsManifest();

    expect(publicCount).toBeGreaterThan(0);
    expect(categories.length).toBeGreaterThanOrEqual(1);
  });

  it('every advertised category resolves to at least one command', async () => {
    const { categories } = await readCommandsManifest();

    // Assert the walk is non-empty; a loop over zero categories inspects
    // nothing and would read as coverage (lesson 11).
    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) {
      const commands = await readCommandsByCategory(category);
      expect(commands.length, `category "${category}" has no public commands`).toBeGreaterThan(0);
    }
  });

  it(`lists ${KNOWN_PUBLIC_COMMAND} under ${KNOWN_CATEGORY} — the name the deploy smoke test looks for`, async () => {
    const names = (await readCommandsByCategory(KNOWN_CATEGORY)).map((cmd) => cmd.name);

    expect(names).toContain(KNOWN_PUBLIC_COMMAND);
  });

  it('agrees with a direct parse of the file — the loader is not reading a different manifest', async () => {
    const raw = JSON.parse(fs.readFileSync(MANIFEST_ON_DISK, 'utf-8')) as {
      commands: { visibility?: string }[];
    };
    const expectedPublic = raw.commands.filter((cmd) => cmd.visibility === 'public').length;

    expect(expectedPublic).toBeGreaterThan(0);
    expect((await readCommandsManifest()).publicCount).toBe(expectedPublic);
  });
});

describe('the loader depends on the manifest in a way output file tracing can see', () => {
  const source = fs.readFileSync(LOADER_SOURCE, 'utf-8');
  // The negative assertions below are about CODE. The loader's own doc comment
  // legitimately names the two loaders that preceded it (and what they called),
  // so scan with comments stripped — a prose mention must not fail the pin, and
  // a call hidden behind one must not pass it. The loader has no string
  // literal containing `/*` or `//`, so a non-quote-aware strip is exact here;
  // the positive assertion below is made on the FULL source and would still
  // hold if that ever changed.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  it('the comment strip left executable code behind (the checks below scan something)', () => {
    expect(code).toMatch(/export (async )?function /);
  });

  it('imports data/commands.json statically', () => {
    // A static import is a module edge; Next.js bundles it into the server
    // function. A path built at runtime is invisible to tracing and is what
    // produced `ENOENT ... /var/task/apps/docs/data/commands.json` (#9718).
    expect(code).toMatch(/^import\s+\w+\s+from\s+'\.\.\/data\/commands\.json';?$/m);
  });

  it('does not read the manifest from the filesystem at runtime', () => {
    expect(code).not.toMatch(/readFileSync|readFile\(|createReadStream/);
    expect(code).not.toMatch(/from\s+['"](node:)?fs['"]/);
    expect(code).not.toMatch(/MANIFEST_PATH/);
  });
});
