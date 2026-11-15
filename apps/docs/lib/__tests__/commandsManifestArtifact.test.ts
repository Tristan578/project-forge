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

import shippedManifest from '../../data/commands.json';
import {
  commandsInCategory,
  readCommandsByCategory,
  readCommandsManifest,
  summarizeManifest,
  type CommandsManifest,
} from '../commands';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOADER_SOURCE = path.resolve(HERE, '../commands.ts');
const MANIFEST_ON_DISK = path.resolve(HERE, '../../data/commands.json');

// A command the public reference has carried since the manifest was first
// published. If it is ever renamed, update this AND the default in
// scripts/post-deploy-docs-check.sh (the deploy smoke test looks for the same
// name on the live page) in the same PR. `scripts/__tests__/post-deploy-docs-check.test.sh`
// extracts both pairs and fails CI when they differ, so the drift cannot wait
// for a red deploy to be noticed. Keep the two `const` lines in exactly this
// shape — that suite parses them.
const KNOWN_PUBLIC_COMMAND = 'spawn_entity';
const KNOWN_CATEGORY = 'scene';

// Same `unknown` hop as the loader, for the same reason (see commands.ts).
const MANIFEST = shippedManifest as unknown as CommandsManifest;

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

/**
 * The page-facing readers are thin wrappers over the pure functions and the
 * shipped manifest. `commands.test.ts` pins the pure functions on fixtures;
 * this pins that the wrappers return exactly what those functions return for
 * the real file, so they cannot drift into filtering differently from what
 * the logic tests cover. Stated as equality against the same input — not as a
 * property of the data (the sum of per-category counts, say), which the pure
 * functions do not guarantee and a legitimate manifest change could break.
 */
describe('readCommandsManifest / readCommandsByCategory agree with the pure functions', () => {
  it('readCommandsManifest() is summarizeManifest(<shipped manifest>)', async () => {
    expect(await readCommandsManifest()).toEqual(summarizeManifest(MANIFEST));
  });

  it('readCommandsByCategory(c) is commandsInCategory(<shipped manifest>, c) for every advertised category', async () => {
    const { categories } = summarizeManifest(MANIFEST);

    // Assert the walk is non-empty (lesson 11).
    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) {
      expect(await readCommandsByCategory(category), `category "${category}"`).toEqual(
        commandsInCategory(MANIFEST, category),
      );
    }
  });

  it('readCommandsByCategory returns an empty array for an unknown category', async () => {
    expect(await readCommandsByCategory('no-such-category')).toEqual([]);
  });
});

describe('the loader depends on the manifest in a way output file tracing can see', () => {
  const source = fs.readFileSync(LOADER_SOURCE, 'utf-8');
  // Every assertion below — positive and negative — runs on CODE, with
  // comments stripped. The loader's own doc comment legitimately names the two
  // loaders that preceded it (and what they called), so a prose mention must
  // not fail a negative pin, and a call hidden behind a comment must not pass
  // one; a commented-out import must not satisfy the positive pin either.
  // The strip is not quote-aware. That is exact today because the loader has
  // no string literal containing `/*` or `//`; if one ever appears, the strip
  // could eat real code, and the guard directly below (executable code
  // survived) plus the positive import pin are what would turn that into a
  // red test instead of a vacuous green one.
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
