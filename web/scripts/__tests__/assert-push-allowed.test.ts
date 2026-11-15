import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { transformSync } from 'esbuild';

import { assertPushAllowed, PUSH_CONFIRM_FLAG } from '../assert-push-allowed';

/**
 * `drizzle-kit push` and `drizzle-kit migrate` are mutually exclusive ownership
 * models. Push diffs `schema.ts` straight onto the database and writes no
 * journal; migrate applies recorded migrations in order. A database that is
 * migrate-managed must never be pushed — doing so silently desynchronises the
 * schema from the migration history, which is #9969: production carried whatever
 * `schema.ts` looked like at the last successful push, four migrations' worth of
 * tables, columns and indexes absent, and no journal to reveal it.
 *
 * The journal is the signal. Its presence means "migrations own this database".
 */
describe('assertPushAllowed', () => {
  it('allows a push when the database has no journal (push-managed or fresh)', () => {
    expect(() => assertPushAllowed({ journalRowCount: null, confirmed: false })).not.toThrow();
  });

  it('allows a push when the journal exists but is empty', () => {
    // An empty journal table with no rows means no migration has been recorded,
    // so nothing is being desynchronised yet.
    expect(() => assertPushAllowed({ journalRowCount: 0, confirmed: false })).not.toThrow();
  });

  it('REFUSES a push when the database is migrate-managed', () => {
    expect(() => assertPushAllowed({ journalRowCount: 13, confirmed: false })).toThrow(
      /migrate-managed/i,
    );
  });

  it('names the override flag in the refusal, so the message is actionable', () => {
    expect(() => assertPushAllowed({ journalRowCount: 13, confirmed: false })).toThrow(
      new RegExp(PUSH_CONFIRM_FLAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  });

  it('allows a deliberate override when the confirm flag is passed', () => {
    expect(() => assertPushAllowed({ journalRowCount: 13, confirmed: true })).not.toThrow();
  });

  it('refuses on a single recorded migration, not just a full journal', () => {
    // Boundary: the guard must trip at the FIRST recorded migration. A check
    // written as `> 1`, or one comparing against the repo's migration count,
    // would let a partially-migrated database be pushed over.
    expect(() => assertPushAllowed({ journalRowCount: 1, confirmed: false })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// The script has to RUN, not just import (#10190)
// ---------------------------------------------------------------------------
//
// `npm run db:push` is `tsx scripts/assert-push-allowed.ts && drizzle-kit
// push`. `web/package.json` has no `"type": "module"`, so tsx compiles the
// file as CommonJS, and esbuild refuses a top-level `await` in that format:
// the guard died at transform time with exit 1 and `&&` never reached the
// push. Nothing noticed, because this suite imports the module through
// vitest, which runs ESM, where a top-level `await` is legal.

const web = resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);
const tsxCli = resolve(dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');

describe('assert-push-allowed as npm runs it (#10190)', () => {
  it('executes through tsx and fails on the missing DATABASE_URL, not on a transform error', () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    let status = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [tsxCli, resolve(web, 'scripts', 'assert-push-allowed.ts')], {
        cwd: web, env, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const failure = error as { status?: number | null; stderr?: string };
      status = failure.status ?? -1;
      stderr = failure.stderr ?? '';
    }
    expect(status).toBe(1);
    expect(stderr).toContain('DATABASE_URL is required');
    expect(stderr).not.toContain('Transform failed');
    expect(stderr).not.toContain('Top-level await');
  });

  it('every script an npm script runs through tsx compiles as CommonJS (no top-level await)', () => {
    const pkg = JSON.parse(readFileSync(resolve(web, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const scripts = new Set<string>();
    for (const command of Object.values(pkg.scripts)) {
      for (const match of command.matchAll(/\btsx\s+(scripts\/[^\s&|;]+\.ts)/g)) scripts.add(match[1]);
    }
    // Fails closed: a regex that stops matching would otherwise pass vacuously.
    expect(scripts.size).toBeGreaterThanOrEqual(5);
    expect(scripts.has('scripts/assert-push-allowed.ts')).toBe(true);

    const refused: string[] = [];
    for (const script of scripts) {
      const source = readFileSync(resolve(web, script), 'utf8');
      try {
        // The same transform tsx applies under this package (no "type":
        // "module"): CommonJS output, where esbuild rejects top-level await.
        transformSync(source, { loader: 'ts', format: 'cjs', logLevel: 'silent' });
      } catch (error) {
        refused.push(`${script}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
      }
    }
    expect(refused).toEqual([]);
  });
});
