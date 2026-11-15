import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Pins the output-file-tracing exclusion that keeps the four public engine WASM
 * packages out of every Vercel function bundle (#10069).
 *
 * Background: #9707 excluded `./public/engine-pkg-*` for
 * `/api/bridges/aseprite/execute` only. `/api/bridges/aseprite/status` imports
 * the same bridge manager, whose `existsSync`/`readFileSync` probes make Next's
 * tracer attach all four packages conservatively — 373 MB uncompressed against a
 * 250 MB limit — and three consecutive staging deploys failed at "Deploying
 * outputs" while production stayed on the previous commit. A per-route list
 * regresses the moment any new route reaches a dynamic filesystem call, so the
 * exclusion must be the wildcard entry.
 */
describe('next.config.ts output file tracing (#10069)', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'next.config.ts'), 'utf-8');

  function excludesBlock(): string {
    const start = source.indexOf('outputFileTracingExcludes:');
    expect(start, 'outputFileTracingExcludes must be configured').toBeGreaterThan(-1);
    const end = source.indexOf('},', start);
    expect(end, 'outputFileTracingExcludes block must close').toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it('excludes the engine packages from EVERY function trace, not a per-route list', () => {
    const block = excludesBlock();
    expect(block).toMatch(/'\*':\s*\[\s*'\.\/public\/engine-pkg-\*\/\*\*'\s*\]/);
  });

  it('does not reintroduce a route-scoped exclusion that a new bridge route would miss', () => {
    const block = excludesBlock();
    expect(block).not.toMatch(/'\/api\/bridges\/aseprite\/(execute|status)'/);
  });

  it('no server route reads an engine package from disk (the exclusion is safe)', () => {
    const appDir = path.resolve(process.cwd(), 'src/app/api');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf-8');
          if (/engine-pkg-/.test(text) && /\bfs\b|readFileSync|existsSync|readdirSync/.test(text)) {
            offenders.push(path.relative(process.cwd(), full));
          }
        }
      }
    };
    walk(appDir);
    expect(offenders, 'a route that reads engine-pkg from disk would break under the global exclusion').toEqual([]);
  });
});
